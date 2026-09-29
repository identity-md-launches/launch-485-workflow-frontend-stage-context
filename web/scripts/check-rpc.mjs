import { decodeFunctionResult, encodeFunctionData } from 'viem';
import { resolve } from 'node:path';
import { loadInputs, readJson, snapshotRoot } from './integrity.mjs';

const { handoff, networkConfig } = loadInputs();
if (!networkConfig) throw new Error('No vetted network snapshot exists; live verification is unavailable');
let requestId = 0;
async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  if (body.result === undefined) throw new Error('RPC returned no result');
  return body.result;
}

const token = handoff.contracts.find((contract) => contract.name === handoff.manifest.token.contract);
const abi = readJson(resolve(snapshotRoot, `abi/${token.name}.json`));
const addresses = [
  ...handoff.contracts.map(({ name, address }) => ({ name, address })),
  ...Object.entries(networkConfig.network.uniswapV4 || {}).map(([name, address]) => ({ name, address })),
];
const results = await Promise.all(networkConfig.network.rpcUrls.map(async (url) => {
  const started = Date.now();
  try {
    const chainHex = await rpc(url, 'eth_chainId');
    const chainId = Number(BigInt(chainHex));
    if (chainId !== handoff.chainId) throw new Error(`Wrong chain: received ${chainId}, expected ${handoff.chainId}`);
    const blockNumber = await rpc(url, 'eth_blockNumber');
    const code = await Promise.all(addresses.map(async ({ name, address }) => {
      const result = await rpc(url, 'eth_getCode', [address, blockNumber]);
      return { name, address, byteLength: (result.length - 2) / 2, nonempty: /^0x[0-9a-fA-F]+$/.test(result) && result !== '0x0' };
    }));
    const tokenReads = {};
    for (const functionName of ['name', 'symbol', 'decimals', 'totalSupply']) {
      const data = encodeFunctionData({ abi, functionName });
      const result = await rpc(url, 'eth_call', [{ to: token.address, data }, blockNumber]);
      const decoded = decodeFunctionResult({ abi, functionName, data: result });
      tokenReads[functionName] = typeof decoded === 'bigint' ? decoded.toString() : decoded;
    }
    return { url, ok: code.every((entry) => entry.nonempty), chainId, blockNumber: Number(BigInt(blockNumber)), code, tokenReads, elapsedMs: Date.now() - started };
  } catch (error) {
    return { url, ok: false, error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started };
  }
}));
const report = { checkedAt: new Date().toISOString(), sourceCommit: handoff.sourceCommit, readOnly: true, anyEndpointVerified: results.some((result) => result.ok), endpoints: results };
console.log(JSON.stringify(report, null, 2));
if (!report.anyEndpointVerified) process.exitCode = 1;
