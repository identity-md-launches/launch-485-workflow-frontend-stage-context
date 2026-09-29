import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from '@playwright/test';
import { encodeErrorResult, encodeFunctionResult, parseAbi, decodeFunctionData } from 'viem';

export const account = '0x1111111111111111111111111111111111111111';
export const nextAccount = '0x2222222222222222222222222222222222222222';
export const tokenAbi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function decimals() view returns (uint8)', 'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
]);
export const permitAbi = parseAbi([
  'function allowance(address,address,address) view returns (uint160,uint48,uint48)',
  'function approve(address,address,uint160,uint48)',
]);
export const routerAbi = parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
export const stateAbi = parseAbi([
  'function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)',
  'function getLiquidity(bytes32) view returns (uint128)',
]);
export const quoteAbi = parseAbi([
  'function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256 amountOut,uint256 gasEstimate)',
  'error NotEnoughLiquidity(bytes32 poolId)',
  'error UnexpectedRevertBytes(bytes revertData)',
]);

const zeroHash = `0x${'0'.repeat(64)}`;
const blockHash = `0x${'b'.repeat(64)}`;
const blockNumber = '0xb50000';
const quantity = n => `0x${BigInt(n).toString(16)}`;
const jsonError = (code, message, data) => ({ error: { code, message, ...(data ? { data } : {}) } });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function startHarness() {
  const dist = resolve(import.meta.dirname, '../../dist');
  const manifestBytes = await readFile(resolve(dist, 'imd-deployment.json'));
  const deployment = JSON.parse(manifestBytes.toString('utf8'));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/preview/')) { res.writeHead(404); res.end(); return; }
      const file = resolve(dist, decodeURIComponent(url.pathname.slice('/preview/'.length)) || 'index.html');
      if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const pages = [];
  return {
    deployment,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    browserVersion: browser.version(),
    async page(options = {}) {
      const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      pages.push(context);
      const state = {
        chainId: quantity(deployment.chainId), accounts: [account], authorized: false,
        rejectConnect: false, unknownChain: false, added: false,
        tokenAllowance: 0n, permitAllowance: 0n, permitExpiration: 0,
        nativeBalance: 10n ** 19n, tokenBalance: 1000n * 10n ** 18n,
        sqrtPriceX96: 2n ** 96n, liquidity: 10n ** 20n,
        blockNumber: BigInt(blockNumber),
        rejectSend: false, executeRevert: false, quoteRevert: false,
        missingCode: false, quoteDelay: 0, receiptDelay: 0, receiptFailures: 0,
        sent: [], requests: [], errors: [], resources: [], transportUrls: [], receipts: new Map(),
        ...options,
      };
      const addresses = deployment.network.uniswapV4;
      const token = deployment.contracts[0].address;
      const isAddress = (a, b) => a?.toLowerCase() === b.toLowerCase();

      async function rpc(request, wallet = false) {
        const { method, params = [] } = request;
        state.requests.push({ method, params, wallet });
        if (method === 'eth_chainId') return wallet ? state.chainId : quantity(deployment.chainId);
        if (method === 'net_version') return String(deployment.chainId);
        if (method === 'eth_accounts') return state.authorized ? state.accounts : [];
        if (method === 'eth_requestAccounts') {
          if (state.rejectConnect) return jsonError(4001, 'User rejected wallet connection');
          state.authorized = true; return state.accounts;
        }
        if (method === 'wallet_switchEthereumChain') {
          if (state.unknownChain && !state.added) return jsonError(4902, 'Unrecognized chain');
          state.chainId = params[0].chainId;
          await page.evaluate(chain => window.__testEmit?.('chainChanged', chain), state.chainId);
          return null;
        }
        if (method === 'wallet_addEthereumChain') { state.added = true; return null; }
        if (method === 'eth_getCode') return state.missingCode ? '0x' : '0x6001600055';
        if (method === 'eth_getBalance') return quantity(state.nativeBalance);
        if (method === 'eth_blockNumber') return quantity(state.blockNumber++);
        if (method === 'eth_gasPrice' || method === 'eth_maxPriorityFeePerGas') return '0x3b9aca00';
        if (method === 'eth_estimateGas') return '0x493e0';
        if (method === 'eth_getTransactionCount') return '0x1';
        if (method === 'eth_call') {
          const call = params[0];
          if (isAddress(call.to, token)) {
            const data = decodeFunctionData({ abi: tokenAbi, data: call.data });
            const result = {
              name: 'Great Family', symbol: 'GFAM', decimals: 18, totalSupply: 1000000n * 10n ** 18n,
              balanceOf: state.tokenBalance, allowance: state.tokenAllowance, approve: true,
            }[data.functionName];
            return encodeFunctionResult({ abi: tokenAbi, functionName: data.functionName, result });
          }
          if (isAddress(call.to, addresses.stateView)) {
            const data = decodeFunctionData({ abi: stateAbi, data: call.data });
            return encodeFunctionResult({ abi: stateAbi, functionName: data.functionName, result: data.functionName === 'getSlot0' ? [state.sqrtPriceX96, 0, 0, 3000] : state.liquidity });
          }
          if (isAddress(call.to, addresses.permit2)) {
            const data = decodeFunctionData({ abi: permitAbi, data: call.data });
            return encodeFunctionResult({ abi: permitAbi, functionName: data.functionName, result: data.functionName === 'allowance' ? [state.permitAllowance, state.permitExpiration, 0] : undefined });
          }
          if (isAddress(call.to, addresses.quoter)) {
            await sleep(state.quoteDelay);
            if (state.nestedQuoteRevert) {
              const inner = encodeErrorResult({ abi: quoteAbi, errorName: 'NotEnoughLiquidity', args: [zeroHash] });
              const wrapped = encodeErrorResult({ abi: quoteAbi, errorName: 'UnexpectedRevertBytes', args: [inner] });
              return jsonError(3, 'execution reverted', wrapped);
            }
            if (state.quoteRevert) return jsonError(3, 'execution reverted: Pool has insufficient liquidity');
            const data = decodeFunctionData({ abi: quoteAbi, data: call.data });
            return encodeFunctionResult({ abi: quoteAbi, functionName: data.functionName, result: [data.args[0].exactAmount * 2n, 120000n] });
          }
          if (isAddress(call.to, addresses.universalRouter)) return state.executeRevert ? jsonError(3, 'execution reverted: TooLittleReceived') : '0x';
          return jsonError(-32602, `Unexpected eth_call target ${call.to}`);
        }
        if (method === 'eth_sendTransaction') {
          if (state.rejectSend) return jsonError(4001, 'User rejected the transaction');
          const tx = params[0];
          const hash = `0x${(state.sent.length + 1).toString(16).padStart(64, '0')}`;
          state.sent.push(tx);
          const receipt = { hash, tx, ready: Date.now() + state.receiptDelay, applied: false };
          state.receipts.set(hash, receipt);
          return hash;
        }
        if (method === 'eth_getTransactionReceipt') {
          if (state.receiptFailures > 0) { state.receiptFailures--; return jsonError(-32005, 'Receipt RPC temporarily unavailable'); }
          const receipt = state.receipts.get(params[0]);
          if (!receipt || Date.now() < receipt.ready) return null;
          if (!receipt.applied) {
            receipt.applied = true;
            if (isAddress(receipt.tx.to, token)) state.tokenAllowance = decodeFunctionData({ abi: tokenAbi, data: receipt.tx.data }).args[1];
            if (isAddress(receipt.tx.to, addresses.permit2)) {
              const args = decodeFunctionData({ abi: permitAbi, data: receipt.tx.data }).args;
              state.permitAllowance = args[2]; state.permitExpiration = Number(args[3]);
            }
          }
          return {
            transactionHash: receipt.hash, transactionIndex: '0x0', blockHash, blockNumber,
            from: account, to: receipt.tx.to, cumulativeGasUsed: '0x493e0', gasUsed: '0x493e0',
            contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1',
            effectiveGasPrice: '0x3b9aca00', type: '0x2',
          };
        }
        if (method === 'eth_getBlockByNumber') return {
          number: blockNumber, hash: blockHash, parentHash: zeroHash, timestamp: quantity(Math.floor(Date.now() / 1000)),
          nonce: '0x0000000000000000', difficulty: '0x0', totalDifficulty: '0x0', size: '0x100',
          gasLimit: '0x1c9c380', gasUsed: '0x493e0', baseFeePerGas: '0x3b9aca00',
          miner: account, extraData: '0x', transactions: [], uncles: [],
          receiptsRoot: zeroHash, transactionsRoot: zeroHash, stateRoot: zeroHash,
          sha3Uncles: zeroHash, logsBloom: `0x${'0'.repeat(512)}`,
        };
        if (method === 'eth_getTransactionByHash') {
          const receipt = state.receipts.get(params[0]);
          return receipt ? { ...receipt.tx, hash: receipt.hash, blockHash, blockNumber, transactionIndex: '0x0', nonce: '0x1', gas: '0x493e0', gasPrice: '0x3b9aca00', input: receipt.tx.data, value: receipt.tx.value || '0x0', type: '0x0', v: '0x1b', r: '0x1', s: '0x1' } : null;
        }
        return jsonError(-32601, `Unmocked RPC method: ${method}`);
      }

      await page.route('https://**/*', async route => {
        if (!deployment.network.rpcUrls.some(url => route.request().url().startsWith(url))) {
          state.errors.push(`Unexpected external request ${route.request().url()}`);
          await route.abort(); return;
        }
        state.transportUrls.push(route.request().url());
        const body = route.request().postDataJSON();
        const answer = async request => {
          try {
            if (state.failFirstRpc && route.request().url().startsWith(deployment.network.rpcUrls[0])) return { jsonrpc: '2.0', id: request.id, error: { code: -32005, message: 'RPC temporarily unavailable' } };
            const result = await rpc(request);
            return { jsonrpc: '2.0', id: request.id, ...(result?.error ? result : { result }) };
          } catch (error) { state.errors.push(error.message); return { jsonrpc: '2.0', id: request.id, error: { code: -32603, message: error.message } }; }
        };
        const result = Array.isArray(body) ? await Promise.all(body.map(answer)) : await answer(body);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
      });
      if (options.tamperAbi) await page.route(`**/preview/${deployment.contracts[0].abiPath}`, route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
      await page.exposeBinding('__testWalletRpc', (_, request) => rpc(request, true));
      if (options.wallet !== false) await page.addInitScript(() => {
        const listeners = new Map();
        window.__testEmit = (event, value) => { for (const listener of listeners.get(event) || []) listener(value); };
        window.ethereum = {
          isMetaMask: true,
          request: async request => {
            const response = await window.__testWalletRpc(request);
            if (response?.error) throw Object.assign(new Error(response.error.message), response.error);
            return response;
          },
          on: (event, listener) => listeners.set(event, [...(listeners.get(event) || []), listener]),
          removeListener: (event, listener) => listeners.set(event, (listeners.get(event) || []).filter(item => item !== listener)),
        };
      });
      page.on('pageerror', error => state.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') state.errors.push(message.text()); });
      page.on('response', response => { if (response.url().startsWith(`http://127.0.0.1:${port}/`) && response.status() >= 400) state.resources.push(`${response.status()} ${response.url()}`); });
      await page.goto(`http://127.0.0.1:${port}/preview/`, { waitUntil: 'networkidle' });
      return { page, state, async close() { await context.close(); } };
    },
    async close() { await browser.close(); await new Promise(resolve => server.close(resolve)); },
  };
}
