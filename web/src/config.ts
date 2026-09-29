import { defineChain, encodeAbiParameters, getAddress, isAddress, keccak256, stringToHex, zeroAddress, type Abi, type Address, type Chain, type Hex } from 'viem'
import poolSettings from './generated/pool.json'
import { poolKeyParameters } from './protocol'

export interface NetworkConfig {
  chainId: number
  name: string
  testnet: boolean
  rpcUrls: string[]
  explorer: string
  nativeCurrency: { name: string; symbol: string; decimals: number }
  faucets: string[]
  uniswapV4: { poolManager: Address; universalRouter: Address; quoter: Address; stateView: Address; positionManager: Address; permit2: Address }
}
export interface ContractConfig { name: string; address: Address; abiHash: string; abiPath: string }
export interface DeploymentManifest {
  version: 1
  launchId: string
  chainId: number
  sourceCommit: string
  attestationHash: string
  contracts: ContractConfig[]
  assets: { path: string; sha256: string }[]
  network: NetworkConfig
  walletAddChain?: {
    chainId: Hex; chainName: string; rpcUrls: string[]
    nativeCurrency: NetworkConfig['nativeCurrency']; blockExplorerUrls: string[]
  }
}
export interface PoolKey { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }
export interface RuntimeConfig {
  deployment: DeploymentManifest
  network: NetworkConfig
  contracts: (ContractConfig & { abi: Abi })[]
  token: ContractConfig & { abi: Abi }
  pool: PoolKey
  poolId: Hex
  chain: Chain
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function relativePath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !/[\\:%?#\u0000-\u0020]/.test(path) && !path.split('/').some(segment => segment === '..' || segment === '.' || !segment)
}
function httpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password } catch { return false }
}
function validManifest(value: unknown): asserts value is DeploymentManifest {
  if (!value || typeof value !== 'object') throw new Error('Deployment configuration is missing.')
  const config = value as DeploymentManifest
  const allowedKeys = new Set(['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets', 'network', 'walletAddChain'])
  if (Object.keys(config).some(key => !allowedKeys.has(key))) throw new Error('Deployment configuration contains unsupported fields.')
  if (config.version !== 1 || !Number.isSafeInteger(config.chainId) || config.chainId <= 0 || typeof config.launchId !== 'string' || !/^[0-9a-f]{40}$/.test(config.sourceCommit) || !/^[0-9a-f]{64}$/.test(config.attestationHash)) throw new Error('Deployment identity is invalid.')
  if (!Array.isArray(config.contracts) || !config.contracts.length || config.contracts.some(contract => !contract.name || !isAddress(contract.address) || !/^[0-9a-f]{64}$/.test(contract.abiHash) || !relativePath(contract.abiPath))) throw new Error('Contract configuration is invalid.')
  if (new Set(config.contracts.map(contract => contract.name)).size !== config.contracts.length) throw new Error('Duplicate contracts in deployment configuration.')
  if (!Array.isArray(config.assets) || config.assets.length > 128 || config.assets.some(asset => !relativePath(asset.path) || asset.path === 'imd-deployment.json' || !/^[0-9a-f]{64}$/.test(asset.sha256))) throw new Error('Deployment asset inventory is invalid.')
  const network = config.network
  if (!network || network.chainId !== config.chainId || !network.rpcUrls?.length || !network.rpcUrls.every(httpsUrl) || !httpsUrl(network.explorer)) throw new Error('A matching vetted network is required. Swaps are unavailable.')
  if (!network.nativeCurrency || !Number.isInteger(network.nativeCurrency.decimals) || network.nativeCurrency.decimals < 0 || network.nativeCurrency.decimals > 36 || typeof network.name !== 'string') throw new Error('Network currency configuration is invalid.')
  const protocolKeys = ['poolManager', 'universalRouter', 'quoter', 'stateView', 'positionManager', 'permit2'] as const
  if (!network.uniswapV4 || protocolKeys.some(key => !isAddress(network.uniswapV4[key]) || network.uniswapV4[key] === zeroAddress)) throw new Error('The vetted Uniswap configuration is incomplete.')
  if (config.walletAddChain && Number(config.walletAddChain.chainId) !== config.chainId) throw new Error('Wallet network configuration does not match deployment.')
}

export async function loadConfig(): Promise<RuntimeConfig> {
  const base = new URL('./', document.baseURI)
  const response = await fetch(new URL('imd-deployment.json', base), { cache: 'no-cache' })
  if (!response.ok) throw new Error('Could not load deployment configuration. Reload to try again.')
  const deployment: unknown = await response.json()
  validManifest(deployment)
  const contracts = await Promise.all(deployment.contracts.map(async contract => {
    const result = await fetch(new URL(contract.abiPath, base))
    if (!result.ok) throw new Error(`Could not load the verified ${contract.name} interface.`)
    const abi: unknown = await result.json()
    if (!Array.isArray(abi) || keccak256(stringToHex(canonicalJson(abi))).slice(2) !== contract.abiHash) throw new Error(`${contract.name} interface failed its deployment hash check. Transactions are disabled.`)
    return { ...contract, address: getAddress(contract.address), abi: abi as Abi }
  }))
  const token = contracts.find(contract => contract.name === poolSettings.tokenContract)
  if (!token) throw new Error('The deployment does not contain the launch token.')
  if (!isAddress(poolSettings.pairedCurrency)) throw new Error('Invalid attested paired currency.')
  const pairedCurrency = getAddress(poolSettings.pairedCurrency)
  const currencies = [pairedCurrency, token.address].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1)
  const hooks = poolSettings.hookContract ? contracts.find(contract => contract.name === poolSettings.hookContract)?.address : zeroAddress
  if (!hooks || currencies[0] === currencies[1]) throw new Error('The attested pool configuration is incomplete.')
  const pool: PoolKey = { currency0: currencies[0], currency1: currencies[1], fee: poolSettings.fee, tickSpacing: poolSettings.tickSpacing, hooks }
  const network = deployment.network
  const chain = defineChain({ id: deployment.chainId, name: network.name, nativeCurrency: network.nativeCurrency, rpcUrls: { default: { http: network.rpcUrls } }, blockExplorers: { default: { name: `${network.name} Explorer`, url: network.explorer } }, testnet: network.testnet })
  return { deployment, network, contracts, token, pool, poolId: keccak256(encodeAbiParameters(poolKeyParameters, [pool])), chain }
}
