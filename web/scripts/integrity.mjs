import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex } from 'viem';

export const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = resolve(webRoot, '..');
export const distRoot = resolve(repoRoot, 'dist');
export const snapshotRoot = resolve(webRoot, 'deployment');
export const maxFileBytes = 8 * 1024 * 1024;
export const maxExportBytes = 24 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
const addressPattern = /^0x[a-fA-F0-9]{40}$/;

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function abiHash(abi) {
  assert(Array.isArray(abi), 'ABI must be a raw JSON array');
  return keccak256(stringToHex(canonicalJson(abi))).slice(2);
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function sameJson(actual, expected, label) {
  assert(canonicalJson(actual) === canonicalJson(expected), `${label} differs from validated handoff`);
}

export function safeRelativePath(path) {
  assert(typeof path === 'string' && path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes(':') && !path.includes('?') && !path.includes('#'), `Invalid relative asset path: ${path}`);
  assert(path.split('/').every((part) => part && part !== '.' && part !== '..'), `Invalid relative asset path: ${path}`);
  return path;
}

function exactKeys(object, expected, label) {
  assert(object && typeof object === 'object' && !Array.isArray(object), `${label} must be an object`);
  assert(JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...expected].sort()), `${label} has missing or extra keys`);
}

export function loadInputs() {
  const handoffPath = resolve(snapshotRoot, 'deployment.json');
  const networkPath = resolve(snapshotRoot, 'network.json');
  const handoff = readJson(handoffPath);
  const networkConfig = existsSync(networkPath) ? readJson(networkPath) : undefined;
  for (const filename of ['deployment.json', 'network.json']) {
    const provided = resolve(repoRoot, '.imd/reads', filename);
    const snapshot = resolve(snapshotRoot, filename);
    if (existsSync(provided)) {
      assert(existsSync(snapshot), `Missing retained ${filename}`);
      assert(readFileSync(provided).equals(readFileSync(snapshot)), `Retained ${filename} differs from supplied pinned input`);
    }
  }
  assert(handoff.version === 1, 'Unsupported handoff version');
  assert(typeof handoff.launchId === 'string' && handoff.launchId.length > 0, 'Missing launch ID');
  assert(Number.isSafeInteger(handoff.chainId) && handoff.chainId > 0, 'Invalid chain ID');
  assert(/^[a-f0-9]{40}$/.test(handoff.sourceCommit), 'Invalid source commit');
  assert(hashPattern.test(handoff.attestationHash), 'Invalid attestation hash');
  assert(Array.isArray(handoff.contracts) && handoff.contracts.length > 0, 'Missing handoff contracts');
  assert(new Set(handoff.contracts.map((contract) => contract.name)).size === handoff.contracts.length, 'Duplicate handoff contract names');
  let pinnedCommitAvailable = false;
  try {
    execFileSync('git', ['cat-file', '-e', `${handoff.sourceCommit}^{commit}`], { cwd: repoRoot, stdio: 'pipe' });
    pinnedCommitAvailable = true;
  } catch {
    // The retained, hash-bound ABI permits a source ZIP rebuild without Git history.
  }
  const contracts = handoff.contracts.map((contract) => {
    assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(contract.name), 'Unsafe contract name');
    assert(addressPattern.test(contract.address), `Invalid ${contract.name} address`);
    assert(hashPattern.test(contract.abiHash), `Invalid ${contract.name} ABI hash`);
    const abiPath = `abi/${contract.name}.json`;
    const bytes = readFileSync(resolve(snapshotRoot, abiPath));
    const abi = JSON.parse(bytes.toString('utf8'));
    assert(abiHash(abi) === contract.abiHash, `${contract.name} canonical ABI hash does not match handoff`);
    if (pinnedCommitAvailable) {
      const pinned = execFileSync('git', ['show', `${handoff.sourceCommit}:docs/${abiPath}`], { cwd: repoRoot, stdio: 'pipe' });
      assert(bytes.equals(pinned), `${contract.name} ABI differs from implementation-derived bytes at pinned source commit`);
    }
    return { name: contract.name, address: contract.address, abiHash: contract.abiHash, abiPath };
  });
  if (networkConfig) {
    assert(networkConfig.network.chainId === handoff.chainId, 'Network and handoff chain IDs differ');
    assert(Array.isArray(networkConfig.network.rpcUrls) && networkConfig.network.rpcUrls.length > 0, 'Missing public RPC URLs');
    for (const rpc of networkConfig.network.rpcUrls) {
      const url = new URL(rpc);
      assert(url.protocol === 'https:' && !url.username && !url.password, 'RPC must be public HTTPS without userinfo');
    }
    if (networkConfig.walletAddChain) {
      assert(Number(BigInt(networkConfig.walletAddChain.chainId)) === handoff.chainId, 'walletAddChain chain differs');
    }
  }
  return { handoff, contracts, networkConfig, pinnedCommitAvailable };
}

export function derivePool(handoff) {
  const pool = handoff.manifest.pool;
  const tokenContract = handoff.manifest.token.contract;
  assert(handoff.contracts.some((contract) => contract.name === tokenContract), 'Pool token contract missing from handoff');
  assert(Number.isInteger(pool.fee) && pool.fee >= 0 && pool.fee <= 16777215, 'Invalid pool fee');
  assert(Number.isInteger(pool.tickSpacing) && pool.tickSpacing > 0 && pool.tickSpacing <= 8388607, 'Invalid tick spacing');
  assert(addressPattern.test(pool.pairedCurrency), 'Invalid paired currency');
  // This attested launch is explicitly token-only and has no hook contract.
  assert(handoff.contracts.length === 1 && tokenContract === 'LaunchToken', 'Review pool derivation before changing deployed contract set');
  return { fee: pool.fee, tickSpacing: pool.tickSpacing, pairedCurrency: pool.pairedCurrency, tokenContract, hookContract: null };
}

export function listExportFiles(root = distRoot) {
  const files = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const fullPath = resolve(directory, name);
      const stat = lstatSync(fullPath);
      assert(!stat.isSymbolicLink(), `Export must not contain symlink: ${name}`);
      if (stat.isDirectory()) visit(fullPath);
      else {
        assert(stat.isFile(), `Export must contain only files and directories: ${name}`);
        const path = relative(root, fullPath).split(sep).join('/');
        safeRelativePath(path);
        files.push({ path, size: stat.size, sha256: sha256(readFileSync(fullPath)) });
      }
    }
  }
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function verifyExport(root = distRoot) {
  const { handoff, contracts, networkConfig, pinnedCommitAvailable } = loadInputs();
  const manifest = readJson(resolve(root, 'imd-deployment.json'));
  const expectedKeys = ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash', 'contracts', 'assets'];
  if (networkConfig) expectedKeys.push('network');
  if (networkConfig?.walletAddChain) expectedKeys.push('walletAddChain');
  exactKeys(manifest, expectedKeys, 'Deployment manifest');
  for (const key of ['version', 'launchId', 'chainId', 'sourceCommit', 'attestationHash']) {
    assert(manifest[key] === handoff[key], `Manifest ${key} differs from handoff`);
  }
  sameJson(manifest.contracts, contracts, 'Manifest contract set and ABI paths');
  if (networkConfig) sameJson(manifest.network, networkConfig.network, 'Manifest network');
  if (networkConfig?.walletAddChain) sameJson(manifest.walletAddChain, networkConfig.walletAddChain, 'Manifest walletAddChain');
  sameJson(readJson(resolve(webRoot, 'src/generated/pool.json')), derivePool(handoff), 'Generated pool constants');
  assert(Array.isArray(manifest.assets) && manifest.assets.length > 0 && manifest.assets.length <= 128, 'Export must declare between 1 and 128 assets');
  const declaredPaths = new Set();
  for (const asset of manifest.assets) {
    exactKeys(asset, ['path', 'sha256'], 'Asset record');
    safeRelativePath(asset.path);
    assert(asset.path !== 'imd-deployment.json', 'Manifest cannot hash itself');
    assert(!declaredPaths.has(asset.path), `Duplicate asset: ${asset.path}`);
    assert(hashPattern.test(asset.sha256), `Invalid SHA-256 for ${asset.path}`);
    declaredPaths.add(asset.path);
  }
  const files = listExportFiles(root);
  assert(files.every((file) => file.size <= maxFileBytes), 'An exported file exceeds 8 MiB');
  const assets = files.filter((file) => file.path !== 'imd-deployment.json');
  assert(assets.length === manifest.assets.length, 'Manifest asset inventory is incomplete');
  const actual = new Map(assets.map((file) => [file.path, file]));
  for (const asset of manifest.assets) {
    assert(actual.get(asset.path)?.sha256 === asset.sha256, `Missing asset or SHA-256 mismatch: ${asset.path}`);
  }
  assert(declaredPaths.has('index.html'), 'Missing index.html inventory');
  for (const contract of contracts) {
    assert(declaredPaths.has(contract.abiPath), `ABI absent from inventory: ${contract.abiPath}`);
    const abiBytes = readFileSync(resolve(root, safeRelativePath(contract.abiPath)));
    assert(abiHash(JSON.parse(abiBytes.toString('utf8'))) === contract.abiHash, `Exported ${contract.name} ABI hash mismatch`);
    assert(abiBytes.equals(readFileSync(resolve(snapshotRoot, contract.abiPath))), `Exported ${contract.name} ABI bytes differ from retained pinned ABI`);
  }
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  assert(totalBytes < maxExportBytes, 'Export must remain under 24 MiB for HTTP verification headroom');
  const html = readFileSync(resolve(root, 'index.html'), 'utf8');
  assert(!/(?:src|href)=["']\/(?!\/)/i.test(html), 'index.html has a root-relative resource; use Vite base ./');
  return { ok: true, assets: assets.length, totalBytes, contracts: contracts.length, pinnedCommitAvailable, sourceCommit: handoff.sourceCommit, abiHashes: contracts.map(({ name, abiHash }) => ({ name, abiHash })) };
}
