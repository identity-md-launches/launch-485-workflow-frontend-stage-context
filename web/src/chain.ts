import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, decodeErrorResult,
  encodeAbiParameters, fallback, formatUnits, getAddress, http, parseUnits, toHex, zeroAddress,
  type Address, type EIP1193Provider, type Hash, type Hex,
} from 'viem'
import type { RuntimeConfig } from './config'
import { actionParameters, currencyAmountParameters, permit2Abi, quoterAbi, routerAbi, stateViewAbi, swapParameters } from './protocol'

export type Direction = 'buy' | 'sell'
export interface WalletProvider {
  request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown>
  on?(event: string, callback: (...args: unknown[]) => void): void
  removeListener?(event: string, callback: (...args: unknown[]) => void): void
}
declare global { interface Window { ethereum?: WalletProvider } }
export interface WalletState { account?: Address; chainId?: number }
export interface ChainSnapshot {
  name: string; symbol: string; decimals: number; totalSupply: bigint
  tokenBalance: bigint; nativeBalance: bigint; tokenAllowance: bigint
  routerAllowance: bigint; routerExpiration: number
  sqrtPriceX96: bigint; liquidity: bigint; tick: number; lpFee: number
  blockNumber: bigint; updatedAt: number; poolError?: string
}
export interface Quote {
  direction: Direction; amountIn: bigint; amountOut: bigint; minimumOut: bigint
  slippageBps: number; createdAt: number; expiresAt: number; gasEstimate: bigint
}
export type ApprovalStep = 'token' | 'permit2' | 'ready'
const UINT128_MAX = (1n << 128n) - 1n
const QUOTE_LIFETIME_MS = 60_000
const VERIFICATION_LIFETIME_MS = 5 * 60_000
export const PERMIT_LIFETIME_SECONDS = 30 * 60

function retryableReceiptError(error: unknown): boolean {
  const transient = (value: unknown) => {
    const detail = value as { name?: string; status?: number; code?: number; message?: string }
    if (['WaitForTransactionReceiptTimeoutError', 'TransactionNotFoundError', 'TransactionReceiptNotFoundError', 'TimeoutError', 'LimitExceededRpcError', 'ResourceNotFoundRpcError', 'ResourceUnavailableRpcError', 'InternalRpcError'].includes(detail?.name ?? '')) return true
    if (detail?.name === 'HttpRequestError') return !detail.status || detail.status === 408 || detail.status === 429 || detail.status >= 500
    if (detail?.name === 'RpcRequestError') return [-32000, -32001, -32002, -32005, -32603].includes(detail.code ?? 0)
    return value instanceof TypeError && /fetch|network/i.test(value.message)
  }
  return transient(error) || (error instanceof BaseError && transient(error.walk(transient)))
}

export function shortAddress(address: string): string { return `${address.slice(0, 6)}…${address.slice(-4)}` }
export function parseAmount(value: string, decimals: number): bigint {
  const clean = value.trim()
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean)) throw new Error('Enter a positive amount using numbers and a decimal point.')
  if ((clean.split('.')[1]?.length ?? 0) > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`)
  return parseUnits(clean, decimals)
}
export function formatAmount(value: bigint, decimals: number, precision = 6): string {
  const formatted = formatUnits(value, decimals)
  const [whole, fraction = ''] = formatted.split('.')
  const visible = fraction.slice(0, precision).replace(/0+$/, '')
  if (value > 0n && whole === '0' && !visible) return `<${precision > 0 ? `0.${'0'.repeat(precision - 1)}1` : '1'}`
  return visible ? `${whole}.${visible}` : whole
}

export function humanError(error: unknown): string {
  const object = error as { code?: number; message?: string; shortMessage?: string; cause?: unknown }
  const message = typeof object?.message === 'string' ? object.message : String(error ?? '')
  if (object?.code === 4001 || /user rejected|user denied|rejected the request/i.test(message)) return 'Request cancelled in your wallet. Nothing was submitted.'
  if (object?.code === -32002 || /already pending/i.test(message)) return 'A request is already open in your wallet. Complete or dismiss it first.'
  if (/insufficient funds|exceeds the balance|insufficient balance|ERC20InsufficientBalance/i.test(message)) return 'Your balance is too low. Leave enough ETH for the network fee.'
  if (error instanceof BaseError) {
    const reverted = error.walk(item => item instanceof ContractFunctionRevertedError)
    if (reverted instanceof ContractFunctionRevertedError) {
      let name = reverted.data?.errorName
      let args = reverted.data?.args
      // Both the quoter and router wrap inner custom errors in bytes.
      // Decode known protocol errors so one-sided liquidity has a useful explanation.
      for (let depth = 0; depth < 3; depth++) {
        const inner = name === 'UnexpectedRevertBytes' ? args?.[0] : name === 'ExecutionFailed' ? args?.[1] : undefined
        if (typeof inner !== 'string' || !inner.startsWith('0x')) break
        try {
          const decoded = decodeErrorResult({ abi: [...quoterAbi, ...routerAbi, ...permit2Abi], data: inner as Hex })
          name = decoded.errorName
          args = decoded.args
        } catch { break }
      }
      const errors: Record<string, string> = {
        ERC20InsufficientAllowance: 'The token allowance is too low. Refresh and approve the amount again.',
        ERC20InsufficientBalance: 'Your token balance is too low for this amount.',
        AllowanceExpired: 'The router permission has expired. Approve the router again.',
        InsufficientAllowance: 'The router permission is too low. Approve the amount again.',
        TransactionDeadlinePassed: 'This swap has expired. Request a fresh quote.',
        V4TooLittleReceived: 'The price moved beyond your slippage limit. Request a fresh quote.',
        V4TooMuchRequested: 'The swap exceeds its spending limit. Request a fresh quote.',
        PoolNotInitialized: 'The pool is not initialized yet. Swaps are unavailable.',
        NotEnoughLiquidity: 'The pool does not have enough liquidity for this swap.',
        ExecutionFailed: 'The router simulation reverted. Refresh the quote and permissions; no swap was submitted.',
      }
      if (name && errors[name]) return errors[name]
      if (reverted.reason && !/^0x/.test(reverted.reason)) return `The contract refused this action: ${reverted.reason.slice(0, 200)}`
      return 'The contract simulation reverted. Refresh the quote and check your balance and permissions.'
    }
  }
  if (error instanceof Error && !(error instanceof BaseError) && !(error instanceof TypeError)) return error.message.slice(0, 260)
  if (/fetch|network|http|timeout|timed out|429|503|rpc request|failed to get/i.test(message)) return 'The network could not be reached. Please wait a moment and try again.'
  if (/revert|execution failed|0x[0-9a-f]{8,}/i.test(message) && error instanceof BaseError) return 'The contract simulation failed. Check the pool, amount and allowances, then request a fresh quote.'
  if (error instanceof Error && !(error instanceof BaseError)) return error.message.slice(0, 260)
  return 'This request could not be completed. Refresh and try again.'
}

export class ChainService {
  readonly config: RuntimeConfig
  readonly publicClient
  private provider?: WalletProvider
  private listeningProvider?: WalletProvider
  private walletSubscribers = new Set<() => void>()
  private walletChanged = () => { this.walletSubscribers.forEach(callback => callback()) }
  private verifiedAt = 0
  private verification?: Promise<void>
  private sending = false
  verified = false

  constructor(config: RuntimeConfig, provider?: WalletProvider) {
    this.config = config
    this.provider = provider ?? window.ethereum
    this.publicClient = createPublicClient({
      chain: config.chain,
      transport: fallback(config.network.rpcUrls.map(url => http(url, { timeout: 8_000, retryCount: 0 })), { rank: false, retryCount: 1 }),
      pollingInterval: 4_000,
      batch: { multicall: false },
    })
  }

  private wallet(): WalletProvider {
    this.attachWalletEvents()
    if (!this.provider) throw new Error('No browser wallet was found. Install an Ethereum wallet or open this page in your wallet browser.')
    return this.provider
  }

  async walletState(): Promise<WalletState> {
    this.attachWalletEvents()
    if (!this.provider) return {}
    const [accounts, chainId] = await Promise.all([
      this.provider.request({ method: 'eth_accounts' }),
      this.provider.request({ method: 'eth_chainId' }),
    ])
    return { account: (accounts as string[])[0] ? getAddress((accounts as string[])[0]) : undefined, chainId: Number(chainId) }
  }

  async connect(): Promise<WalletState> {
    await this.wallet().request({ method: 'eth_requestAccounts' })
    return this.walletState()
  }

  async switchChain(): Promise<void> {
    const provider = this.wallet()
    const params = [{ chainId: toHex(this.config.deployment.chainId) }]
    try { await provider.request({ method: 'wallet_switchEthereumChain', params }) }
    catch (error) {
      const detail = error as { code?: number; message?: string; data?: { originalError?: { code?: number } } }
      const unknownChain = detail.code === 4902 || detail.data?.originalError?.code === 4902 || /unrecognized chain|unknown chain|chain.*not.*added/i.test(detail.message ?? '')
      if (!unknownChain) throw error
      if (!this.config.deployment.walletAddChain) throw new Error('Your wallet does not know this network and no vetted add-network configuration is available.')
      await provider.request({ method: 'wallet_addEthereumChain', params: [this.config.deployment.walletAddChain] })
      await provider.request({ method: 'wallet_switchEthereumChain', params })
    }
    const state = await this.walletState()
    if (state.chainId !== this.config.deployment.chainId) throw new Error(`Switch your wallet to ${this.config.network.name} before continuing.`)
  }

  subscribeWallet(callback: () => void): () => void {
    this.walletSubscribers.add(callback)
    this.attachWalletEvents()
    return () => {
      this.walletSubscribers.delete(callback)
      this.attachWalletEvents()
    }
  }

  private attachWalletEvents(): void {
    this.provider ??= window.ethereum
    if (this.listeningProvider && (this.listeningProvider !== this.provider || this.walletSubscribers.size === 0)) {
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) this.listeningProvider.removeListener?.(event, this.walletChanged)
      this.listeningProvider = undefined
    }
    if (this.provider && this.walletSubscribers.size > 0 && !this.listeningProvider) {
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) this.provider.on?.(event, this.walletChanged)
      this.listeningProvider = this.provider
    }
  }

  async verify(): Promise<void> {
    if (this.verified && Date.now() - this.verifiedAt < VERIFICATION_LIFETIME_MS) return
    if (this.verification) return this.verification
    this.verification = this.verifyContracts()
    try { await this.verification } finally { this.verification = undefined }
  }

  private async verifyContracts(): Promise<void> {
    this.verified = false
    if (await this.publicClient.getChainId() !== this.config.deployment.chainId) throw new Error('The RPC returned the wrong chain. Transactions are disabled.')
    const contracts = [
      ...this.config.contracts.map(contract => ({ name: contract.name, address: contract.address })),
      ...Object.entries(this.config.network.uniswapV4).map(([name, address]) => ({ name, address })),
    ]
    await Promise.all(contracts.map(async contract => {
      const code = await this.publicClient.getCode({ address: contract.address })
      if (!code || code === '0x') throw new Error(`No deployed code was found for ${contract.name}. Transactions are disabled.`)
    }))
    this.verified = true
    this.verifiedAt = Date.now()
  }

  async read(account?: Address): Promise<ChainSnapshot> {
    const { token, network, poolId } = this.config
    const blockNumber = await this.publicClient.getBlockNumber({ cacheTime: 0 })
    const tokenRead = (functionName: string, args?: readonly unknown[]) => this.publicClient.readContract({ address: token.address, abi: token.abi, functionName, args, blockNumber })
    const poolRead = Promise.all([
      this.publicClient.readContract({ address: network.uniswapV4.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId], blockNumber }),
      this.publicClient.readContract({ address: network.uniswapV4.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId], blockNumber }),
    ]).then(([slot, liquidity]) => ({ sqrtPriceX96: slot[0], tick: slot[1], lpFee: slot[3], liquidity, poolError: slot[0] === 0n ? 'This pool has not been initialized yet.' : liquidity === 0n ? 'This pool has no active liquidity.' : undefined }))
      .catch(() => ({ sqrtPriceX96: 0n, tick: 0, lpFee: this.config.pool.fee, liquidity: 0n, poolError: 'Pool state is unavailable. Swaps are disabled until it can be read.' }))
    const [name, symbol, decimals, totalSupply, tokenBalance, nativeBalance, tokenAllowance, router, pool] = await Promise.all([
      tokenRead('name'), tokenRead('symbol'), tokenRead('decimals'), tokenRead('totalSupply'),
      account ? tokenRead('balanceOf', [account]) : 0n,
      account ? this.publicClient.getBalance({ address: account, blockNumber }) : 0n,
      account ? tokenRead('allowance', [account, network.uniswapV4.permit2]) : 0n,
      account ? this.publicClient.readContract({ address: network.uniswapV4.permit2, abi: permit2Abi, functionName: 'allowance', args: [account, token.address, network.uniswapV4.universalRouter], blockNumber }) : [0n, 0, 0] as const,
      poolRead,
    ])
    return { name: name as string, symbol: symbol as string, decimals: Number(decimals), totalSupply: totalSupply as bigint, tokenBalance: tokenBalance as bigint, nativeBalance, tokenAllowance: tokenAllowance as bigint, routerAllowance: router[0], routerExpiration: router[1], ...pool, blockNumber, updatedAt: Date.now() }
  }

  async quote(direction: Direction, amountIn: bigint, slippageBps: number): Promise<Quote> {
    this.validateAmount(amountIn)
    if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 500) throw new Error('Choose a slippage limit between 0% and 5%.')
    await this.verify()
    const { pool, poolId, network } = this.config
    const slot = await this.publicClient.readContract({ address: network.uniswapV4.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] })
    if (slot[0] === 0n) throw new Error('The pool has not been initialized yet. A swap cannot be quoted.')
    // An initialized pool may cross an empty tick range to reach liquidity.
    // The quoter decides whether this direction and amount can execute.
    const { input } = this.currencies(direction)
    const result = await this.publicClient.simulateContract({ address: network.uniswapV4.quoter, abi: quoterAbi, functionName: 'quoteExactInputSingle', args: [{ poolKey: pool, zeroForOne: input.toLowerCase() === pool.currency0.toLowerCase(), exactAmount: amountIn, hookData: '0x' }] })
    const amountOut = result.result[0]
    const minimumOut = amountOut * BigInt(10_000 - slippageBps) / 10_000n
    if (minimumOut <= 0n || amountOut > UINT128_MAX) throw new Error('This amount cannot produce a safe quote. Try a different amount.')
    const createdAt = Date.now()
    return { direction, amountIn, amountOut, minimumOut, slippageBps, createdAt, expiresAt: createdAt + QUOTE_LIFETIME_MS, gasEstimate: result.result[1] }
  }

  async approvalStep(account: Address, amountIn: bigint): Promise<ApprovalStep> {
    const { token, network } = this.config
    const [tokenAllowance, router] = await Promise.all([
      this.publicClient.readContract({ address: token.address, abi: token.abi, functionName: 'allowance', args: [account, network.uniswapV4.permit2] }),
      this.publicClient.readContract({ address: network.uniswapV4.permit2, abi: permit2Abi, functionName: 'allowance', args: [account, token.address, network.uniswapV4.universalRouter] }),
    ])
    if ((tokenAllowance as bigint) < amountIn) return 'token'
    if (router[0] < amountIn || router[1] <= Math.floor(Date.now() / 1000) + 60) return 'permit2'
    return 'ready'
  }

  async approveToken(account: Address, amount: bigint, onHash?: (hash: Hash) => void): Promise<Hash> {
    this.validateAmount(amount, true)
    return this.send(account, async () => {
      const { token, network } = this.config
      if (amount > 0n) {
        const current = await this.publicClient.readContract({ address: token.address, abi: token.abi, functionName: 'allowance', args: [account, network.uniswapV4.permit2] })
        if ((current as bigint) > 0n) throw new Error('An existing token approval remains. Refresh live data, reset it, then approve the new amount.')
      }
      const simulation = await this.publicClient.simulateContract({ account, address: token.address, abi: token.abi, functionName: 'approve', args: [network.uniswapV4.permit2, amount] })
      await this.assertWallet(account)
      return this.walletClient().writeContract(simulation.request)
    }, onHash)
  }

  async approveRouter(account: Address, amount: bigint, onHash?: (hash: Hash) => void): Promise<Hash> {
    this.validateAmount(amount, true)
    return this.send(account, async () => {
      const { token, network } = this.config
      const expiration = amount === 0n ? 0 : Math.floor(Date.now() / 1000) + PERMIT_LIFETIME_SECONDS
      const simulation = await this.publicClient.simulateContract({ account, address: network.uniswapV4.permit2, abi: permit2Abi, functionName: 'approve', args: [token.address, network.uniswapV4.universalRouter, amount, expiration] })
      await this.assertWallet(account)
      return this.walletClient().writeContract(simulation.request)
    }, onHash)
  }

  async swap(account: Address, quote: Quote, onHash?: (hash: Hash) => void): Promise<Hash> {
    return this.send(account, async () => {
      this.assertQuote(quote)
      if (quote.direction === 'sell' && await this.approvalStep(account, quote.amountIn) !== 'ready') throw new Error('Refresh your permissions before swapping. An approval is missing or has expired.')
      const request = this.encodeSwap(quote)
      const simulation = await this.publicClient.simulateContract({ account, address: this.config.network.uniswapV4.universalRouter, abi: routerAbi, functionName: 'execute', args: [request.commands, request.inputs, request.deadline], value: request.value })
      this.assertQuote(quote)
      await this.assertWallet(account)
      return this.walletClient().writeContract(simulation.request)
    }, onHash)
  }

  // Exported through the service to permit independent calldata validation without sending.
  encodeSwap(quote: Quote): { commands: Hex; inputs: Hex[]; deadline: bigint; value: bigint } {
    this.assertQuote(quote)
    const { pool } = this.config
    const { input, output } = this.currencies(quote.direction)
    const params = [
      encodeAbiParameters(swapParameters, [{ poolKey: pool, zeroForOne: input.toLowerCase() === pool.currency0.toLowerCase(), amountIn: quote.amountIn, amountOutMinimum: quote.minimumOut, hookData: '0x' }]),
      encodeAbiParameters(currencyAmountParameters, [input, quote.amountIn]),
      encodeAbiParameters(currencyAmountParameters, [output, quote.minimumOut]),
    ]
    return { commands: '0x10', inputs: [encodeAbiParameters(actionParameters, ['0x060c0f', params])], deadline: BigInt(Math.floor(quote.expiresAt / 1000)), value: input === zeroAddress ? quote.amountIn : 0n }
  }

  private currencies(direction: Direction): { input: Address; output: Address } {
    const { pool, token } = this.config
    const paired = pool.currency0.toLowerCase() === token.address.toLowerCase() ? pool.currency1 : pool.currency0
    if (paired !== zeroAddress) throw new Error('This interface supports the attested native-currency pool only.')
    return direction === 'buy' ? { input: paired, output: token.address } : { input: token.address, output: paired }
  }
  private validateAmount(amount: bigint, allowZero = false): void {
    if (amount < (allowZero ? 0n : 1n) || amount > UINT128_MAX) throw new Error('Enter an amount greater than zero and within the pool limit.')
  }
  private assertQuote(quote: Quote): void {
    this.validateAmount(quote.amountIn)
    if (quote.direction !== 'buy' && quote.direction !== 'sell') throw new Error('Invalid swap direction.')
    if (Date.now() >= quote.expiresAt || quote.expiresAt - quote.createdAt > QUOTE_LIFETIME_MS || quote.createdAt > Date.now()) throw new Error('This quote has expired. Request a fresh quote before swapping.')
    if (!Number.isInteger(quote.slippageBps) || quote.slippageBps < 0 || quote.slippageBps > 500 || quote.minimumOut !== quote.amountOut * BigInt(10_000 - quote.slippageBps) / 10_000n || quote.minimumOut <= 0n || quote.amountOut > UINT128_MAX) throw new Error('The quote is invalid. Request a fresh quote before swapping.')
  }
  private async assertWallet(account: Address): Promise<void> {
    const state = await this.walletState()
    if (!state.account || state.account.toLowerCase() !== account.toLowerCase()) throw new Error('Your wallet account changed. Reconnect and review the action again.')
    if (state.chainId !== this.config.deployment.chainId) throw new Error(`Switch your wallet to ${this.config.network.name} before continuing.`)
  }
  private walletClient() { return createWalletClient({ chain: this.config.chain, transport: custom(this.wallet() as EIP1193Provider) }) }
  private async send(account: Address, action: () => Promise<Hash>, onHash?: (hash: Hash) => void): Promise<Hash> {
    if (this.sending) throw new Error('A transaction is already waiting for confirmation.')
    this.sending = true
    try {
      await this.assertWallet(account)
      await this.verify()
      const hash = await action()
      onHash?.(hash)
      // Submission happens exactly once. A timeout or temporary RPC outage must not
      // unlock the action while its existing hash can still confirm on chain.
      for (;;) {
        let replacementReason: string | undefined
        try {
          const receipt = await this.publicClient.waitForTransactionReceipt({
            hash, confirmations: 1, timeout: 180_000,
            onReplaced: replacement => { replacementReason = replacement.reason },
          })
          if (replacementReason === 'cancelled' || replacementReason === 'replaced') throw new Error('This transaction was cancelled or replaced with a different action in your wallet. The original action was not confirmed. Refresh your balances before continuing.')
          if (receipt.status !== 'success') throw new Error('The transaction reverted on chain. No swap or permission change was completed; a network fee may still have been spent.')
          return receipt.transactionHash
        } catch (error) {
          if (!retryableReceiptError(error)) throw error
          await new Promise(resolve => globalThis.setTimeout(resolve, 4_000))
        }
      }
    } finally { this.sending = false }
  }
}
