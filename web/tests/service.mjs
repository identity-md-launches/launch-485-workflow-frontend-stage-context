import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ContractFunctionRevertedError, WaitForTransactionReceiptTimeoutError, encodeErrorResult, parseAbi } from 'viem';

const root = resolve(import.meta.dirname, '..');
const server = await createServer({ configFile: false, root, server: { middlewareMode: true }, appType: 'custom' });
globalThis.window = {};
try {
  const { ChainService, humanError } = await server.ssrLoadModule('/src/chain.ts');
  const network = JSON.parse(readFileSync(resolve(root, 'deployment/network.json'), 'utf8')).network;
  const handoff = JSON.parse(readFileSync(resolve(root, 'deployment/deployment.json'), 'utf8'));
  const token = handoff.contracts.find(contract => contract.name === 'LaunchToken');
  token.abi = JSON.parse(readFileSync(resolve(root, 'deployment/abi/LaunchToken.json'), 'utf8'));
  const account = '0x1111111111111111111111111111111111111111';
  const hash = `0x${'1'.repeat(64)}`;
  const otherHash = `0x${'2'.repeat(64)}`;
  const config = {
    chain: { id: network.chainId, name: network.name, nativeCurrency: network.nativeCurrency, rpcUrls: { default: { http: network.rpcUrls } } },
    network, token, deployment: { chainId: network.chainId },
  };
  const results = [];
  function service() {
    const value = new ChainService(config);
    // Isolate transaction lifecycle from wallet consent and deployment verification,
    // which are covered by the production-browser suite. No RPC can send a write.
    value.assertWallet = async () => {};
    value.verify = async () => {};
    return value;
  }

  {
    const value = service();
    let sends = 0, hashes = 0, waits = 0;
    value.publicClient.waitForTransactionReceipt = async () => {
      waits++;
      if (waits === 1) throw new WaitForTransactionReceiptTimeoutError({ hash });
      assert.equal(value.sending, true);
      return { status: 'success', transactionHash: hash };
    };
    const pending = value.send(account, async () => { sends++; return hash; }, () => { hashes++; });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(value.sending, true);
    await assert.rejects(() => value.send(account, async () => { sends++; return otherHash; }), /already waiting/);
    assert.equal(await pending, hash);
    assert.equal(sends, 1);
    assert.equal(hashes, 1);
    assert.equal(waits, 2);
    assert.equal(value.sending, false);
    results.push('Receipt timeout keeps pending state, rejects duplicate send, retries original hash, and confirms once');
  }

  for (const reason of ['cancelled', 'replaced', 'repriced']) {
    const value = service();
    value.publicClient.waitForTransactionReceipt = async args => {
      args.onReplaced({ reason });
      return { status: 'success', transactionHash: otherHash };
    };
    const pending = value.send(account, async () => hash);
    if (reason === 'repriced') assert.equal(await pending, otherHash);
    else await assert.rejects(() => pending, /cancelled or replaced/);
    assert.equal(value.sending, false);
    results.push(`Receipt replacement reason ${reason} handled correctly`);
  }

  {
    const value = service();
    value.publicClient.waitForTransactionReceipt = async () => ({ status: 'reverted', transactionHash: hash });
    await assert.rejects(() => value.send(account, async () => hash), /reverted on chain/);
    assert.equal(value.sending, false);
    results.push('Reverted receipt surfaces failure and releases pending state');
  }

  {
    const abi = parseAbi(['function f()', 'error UnexpectedRevertBytes(bytes revertData)', 'error NotEnoughLiquidity(bytes32 poolId)']);
    const inner = encodeErrorResult({ abi, errorName: 'NotEnoughLiquidity', args: [hash] });
    const data = encodeErrorResult({ abi, errorName: 'UnexpectedRevertBytes', args: [inner] });
    const error = new ContractFunctionRevertedError({ abi, data, functionName: 'f' });
    assert.match(humanError(error), /not have enough liquidity/);
    results.push('Live nested quoter liquidity revert maps to an actionable message');
  }

  {
    const value = service();
    let simulated = false, sent = false;
    value.publicClient.readContract = async request => { assert.equal(request.functionName, 'allowance'); return 1n; };
    value.publicClient.simulateContract = async () => { simulated = true; throw new Error('Should not simulate'); };
    value.walletClient = () => ({ writeContract: async () => { sent = true; return hash; } });
    await assert.rejects(() => value.approveToken(account, 2n), /existing token approval remains/);
    assert.equal(simulated, false);
    assert.equal(sent, false);
    assert.equal(value.sending, false);
    results.push('Fresh nonzero token allowance blocks replacement before simulation or signing');
  }

  const report = { checkedAt: new Date().toISOString(), mode: 'isolated service with mocked wallet and receipt RPC; no chain writes', passed: results.length, results };
  writeFileSync(resolve(root, '../docs/service-test-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await server.close();
}
