import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { decodeAbiParameters, decodeFunctionData, parseAbiParameters } from 'viem';
import { account, nextAccount, startHarness, routerAbi, tokenAbi, permitAbi } from './harness.mjs';

const results = [];
const started = new Date().toISOString();
const harness = await startHarness();
const timeout = setTimeout(() => { console.error('Browser validation exceeded its 180 second bound.'); void harness.close().finally(() => process.exit(1)); }, 180000);
const out = resolve(import.meta.dirname, '../../docs/test-results.json');
const quoteButton = page => page.getByRole('button', { name: /^Get quote$/i });
const amountField = page => page.getByLabel('You pay', { exact: true });
const swapButton = page => page.getByRole('button', { name: /^Confirm swap$/i });
const connectButton = page => page.getByRole('button', { name: /^Connect wallet$/i }).first();
const approveTokenButton = page => page.getByRole('button', { name: /^Approve GFAM/i });
const approvePermitButton = page => page.getByRole('button', { name: /^Approve swap access/i });

async function test(name, callback, options) {
  const fixture = await harness.page(options);
  fixture.page.setDefaultTimeout(8000);
  const began = Date.now();
  try {
    const details = await callback(fixture);
    assert.deepEqual(fixture.state.errors, [], 'No unhandled browser or RPC errors');
    assert.deepEqual(fixture.state.resources, [], 'No failed static resources at /preview/');
    results.push({ name, status: 'passed', durationMs: Date.now() - began, ...(details ? { details } : {}) });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, status: 'failed', durationMs: Date.now() - began, error: error.stack, browserErrors: fixture.state.errors });
    console.error(`FAIL ${name}: ${error.message}`);
  } finally { await fixture.close(); }
}

async function connect(page) {
  await connectButton(page).click();
  await expect(page.locator('.wallet-details')).toContainText('1,000 GFAM');
}
async function quote(page, amount = '0.1', sell = false) {
  if (sell) await page.getByRole('button', { name: /^Sell GFAM$/i }).click();
  await amountField(page).fill(amount);
  await quoteButton(page).click();
  await expect(page.getByText('Minimum received', { exact: true })).toBeVisible();
}

try {
  await test('Disconnected and missing-wallet state gives a recoverable connect action', async ({ page, state }) => {
    await expect(connectButton(page)).toBeVisible();
    await connectButton(page).click();
    await expect(page.getByRole('alert')).toContainText(/wallet/i);
    assert.equal(state.sent.length, 0);
  }, { wallet: false });

  await test('Rejected wallet connection is reported and the control recovers', async ({ page, state }) => {
    await connectButton(page).click();
    await expect(page.getByText(/reject|cancel/i).last()).toBeVisible();
    await expect(connectButton(page)).toBeEnabled();
    state.rejectConnect = false;
    await connect(page);
  }, { rejectConnect: true });

  await test('Wrong chain switches with the exact vetted add-chain parameters after error 4902', async ({ page, state }) => {
    await connectButton(page).click();
    const switchButton = page.getByRole('button', { name: /Switch to Sepolia/i });
    await expect(switchButton).toBeVisible();
    await switchButton.click();
    await expect(page.locator('.wallet-details')).toContainText('1,000 GFAM');
    const added = state.requests.find(request => request.method === 'wallet_addEthereumChain');
    assert.deepEqual(added.params[0], harness.deployment.walletAddChain);
    assert.equal(state.requests.filter(request => request.method === 'wallet_switchEthereumChain').length, 2);
    assert.equal(state.sent.length, 0);
  }, { chainId: '0x1', unknownChain: true });

  await test('Connected reads, strict amount validation and stale quote invalidation', async ({ page, state }) => {
    await connect(page);
    await expect(page.getByText(/10 ETH/).first()).toBeVisible();
    for (const amount of ['0', '-1', '1e3', '0.0000000000000000001', '11']) {
      await amountField(page).fill(amount);
      await quoteButton(page).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(swapButton(page)).toHaveCount(0);
    }
    await quote(page);
    await expect(swapButton(page)).toBeEnabled();
    await amountField(page).fill('0.2');
    await expect(swapButton(page)).toHaveCount(0);
    assert.equal(state.sent.length, 0);
  });

  await test('ETH buy simulates and sends exact router actions, native value, minimum output and deadline', async ({ page, state }) => {
    await connect(page);
    await quote(page);
    const before = Math.floor(Date.now() / 1000);
    await swapButton(page).click();
    await expect(page.getByText(/confirmed|complete/i).last()).toBeVisible();
    assert.equal(state.sent.length, 1);
    const tx = state.sent[0];
    assert.equal(tx.to.toLowerCase(), harness.deployment.network.uniswapV4.universalRouter);
    assert.equal(BigInt(tx.value), 10n ** 17n);
    const { args } = decodeFunctionData({ abi: routerAbi, data: tx.data });
    assert.equal(args[0], '0x10');
    assert.ok(args[2] > BigInt(before) && args[2] <= BigInt(before + 60));
    const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes,bytes[]'), args[1][0]);
    assert.equal(actions, '0x060c0f');
    const [swap] = decodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)'), params[0]);
    assert.equal(swap.zeroForOne, true);
    assert.equal(swap.amountIn, 10n ** 17n);
    assert.equal(swap.amountOutMinimum, 199n * 10n ** 15n);
    assert.equal(swap.poolKey.currency0, '0x0000000000000000000000000000000000000000');
    assert.equal(swap.poolKey.currency1.toLowerCase(), harness.deployment.contracts[0].address);
    assert.equal(swap.poolKey.fee, 3000);
    assert.equal(swap.poolKey.tickSpacing, 60);
    assert.equal(swap.poolKey.hooks, '0x0000000000000000000000000000000000000000');
    assert.equal(swap.hookData, '0x');
    const settle = decodeAbiParameters(parseAbiParameters('address,uint256'), params[1]);
    const take = decodeAbiParameters(parseAbiParameters('address,uint256'), params[2]);
    assert.equal(settle[0], swap.poolKey.currency0);
    assert.equal(settle[1], swap.amountIn);
    assert.equal(take[0], swap.poolKey.currency1);
    assert.equal(take[1], swap.amountOutMinimum);
    assert.equal(state.requests.some(request => request.method === 'eth_call' && request.params[0].data === tx.data), true, 'Exact execute calldata was simulated');
    assert.equal(state.requests.some(request => request.method === 'eth_sendTransaction' && request.params[0].to.toLowerCase() === harness.deployment.network.uniswapV4.permit2), false);
  });

  await test('Sell approvals are separate, exact and locked until confirmation before swapping', async ({ page, state }) => {
    await connect(page);
    await quote(page, '2', true);
    await approveTokenButton(page).click();
    await expect(page.getByRole('button', { name: /Approving|Confirming|Waiting/i }).last()).toBeDisabled();
    await expect.poll(() => state.sent.length).toBe(1);
    await expect(page.getByText('Transaction submitted. Waiting for confirmation…', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Approving GFAM/i })).toBeDisabled();
    await expect(amountField(page)).toBeDisabled();
    await expect(quoteButton(page)).toBeEnabled({ timeout: 15000 });
    await quote(page, '2');
    await expect(approvePermitButton(page)).toBeEnabled();
    const ercApprove = decodeFunctionData({ abi: tokenAbi, data: state.sent[0].data });
    assert.equal(ercApprove.functionName, 'approve');
    assert.equal(ercApprove.args[0].toLowerCase(), harness.deployment.network.uniswapV4.permit2);
    assert.equal(ercApprove.args[1], 2n * 10n ** 18n);
    await approvePermitButton(page).click();
    await expect(quoteButton(page)).toBeEnabled({ timeout: 15000 });
    await quote(page, '2');
    await expect(swapButton(page)).toBeEnabled();
    const permitApprove = decodeFunctionData({ abi: permitAbi, data: state.sent[1].data });
    assert.equal(permitApprove.args[0].toLowerCase(), harness.deployment.contracts[0].address);
    assert.equal(permitApprove.args[1].toLowerCase(), harness.deployment.network.uniswapV4.universalRouter);
    assert.equal(permitApprove.args[2], 2n * 10n ** 18n);
    await swapButton(page).click();
    await expect(page.getByText(/confirmed|complete/i).last()).toBeVisible({ timeout: 15000 });
    assert.equal(state.sent.length, 3);
    assert.equal(BigInt(state.sent[2].value || '0x0'), 0n);
  }, { receiptDelay: 1200 });

  await test('Failed swap simulation exposes the reason and never asks the wallet to send', async ({ page, state }) => {
    await connect(page);
    await quote(page);
    state.executeRevert = true;
    await swapButton(page).click();
    await expect(page.getByRole('alert')).toContainText(/TooLittleReceived|simulation|price moved|slippage|swap|revert/i);
    assert.equal(state.sent.length, 0);
  });

  await test('Wallet transaction rejection unlocks the action with persistent feedback', async ({ page, state }) => {
    await connect(page);
    await quote(page);
    await swapButton(page).click();
    await expect(page.getByText(/reject|cancel/i).last()).toBeVisible();
    assert.equal(state.sent.length, 0);
    await expect(swapButton(page)).toBeEnabled();
  }, { rejectSend: true });

  await test('Slippage validation and changes discard previously reviewed quotes', async ({ page, state }) => {
    await connect(page);
    await amountField(page).fill('0.1');
    const slippage = page.getByLabel('Slippage tolerance percent');
    for (const value of ['0', '5.01', '2.555', 'abc']) {
      await slippage.fill(value);
      await quoteButton(page).click();
      await expect(page.getByRole('alert')).toContainText(/slippage/i);
      await expect(swapButton(page)).toHaveCount(0);
    }
    await slippage.fill('0.5');
    await quoteButton(page).click();
    await expect(swapButton(page)).toBeEnabled();
    await slippage.fill('1');
    await expect(swapButton(page)).toHaveCount(0);
    await quoteButton(page).click();
    await expect(page.getByTestId('quote-details')).toContainText('0.198 GFAM');
    await slippage.fill('0.29');
    await quoteButton(page).click();
    await expect(page.getByTestId('quote-details')).toContainText('0.19942 GFAM');
    assert.equal(state.sent.length, 0);
  });

  await test('Expired quotes require refresh and direction changes clear the output', async ({ page, state }) => {
    await page.clock.install();
    await connect(page);
    await quote(page);
    await page.clock.fastForward(61000);
    await expect(page.getByRole('button', { name: /^Refresh quote$/i })).toBeVisible();
    await expect(swapButton(page)).toHaveCount(0);
    await page.getByRole('button', { name: /^Sell GFAM$/i }).click();
    await expect(page.getByLabel('Estimated output')).toHaveText('0.00');
    await expect(amountField(page)).toHaveValue('');
    assert.equal(state.sent.length, 0);
  });

  await test('Quote failure explains recovery without sending any transaction', async ({ page, state }) => {
    await connect(page);
    await amountField(page).fill('0.1');
    await quoteButton(page).click();
    await expect(page.getByRole('alert')).toContainText(/liquidity|simulation|contract|quote/i);
    await expect(quoteButton(page)).toBeEnabled();
    assert.equal(state.sent.length, 0);
  }, { quoteRevert: true });

  await test('Account changes during a delayed quote prevent stale results from enabling a swap', async ({ page, state }) => {
    await connect(page);
    await amountField(page).fill('0.1');
    await quoteButton(page).click();
    await expect.poll(() => state.requests.some(request => request.method === 'eth_call' && request.params[0].to.toLowerCase() === harness.deployment.network.uniswapV4.quoter)).toBe(true);
    state.accounts = [nextAccount];
    await page.evaluate(value => window.__testEmit('accountsChanged', value), state.accounts);
    await expect(quoteButton(page)).toBeEnabled();
    await expect(swapButton(page)).toHaveCount(0);
    await expect(page.getByLabel('Estimated output')).toHaveText('0.00');
    assert.equal(state.sent.length, 0);
  }, { quoteDelay: 1500 });

  await test('Swap rechecks permissions immediately before signing', async ({ page, state }) => {
    await connect(page);
    await quote(page, '2', true);
    await expect(swapButton(page)).toBeEnabled();
    state.tokenAllowance = 0n;
    await swapButton(page).click();
    await expect(page.getByRole('alert')).toContainText(/approval|permission/i);
    assert.equal(state.sent.length, 0);
  }, { tokenAllowance: 10n ** 20n, permitAllowance: 10n ** 20n, permitExpiration: Math.floor(Date.now() / 1000) + 3600 });

  await test('Revocation sends a zero token allowance and refreshes it after confirmation', async ({ page, state }) => {
    await connect(page);
    await page.getByRole('button', { name: /^Revoke token approval$/i }).click();
    await expect(page.getByText(/Token approval cleared/i)).toBeVisible();
    assert.equal(state.sent.length, 1);
    const approval = decodeFunctionData({ abi: tokenAbi, data: state.sent[0].data });
    assert.equal(approval.args[1], 0n);
    await expect(page.getByRole('button', { name: /^Revoke token approval$/i })).toHaveCount(0);
  }, { tokenAllowance: 10n ** 18n });

  await test('A smaller existing token allowance is reset before granting a new amount', async ({ page, state }) => {
    await connect(page);
    await quote(page, '2', true);
    await page.getByRole('button', { name: /^Reset token approval$/i }).click();
    await expect(quoteButton(page)).toBeEnabled();
    assert.equal(state.sent.length, 1);
    const approval = decodeFunctionData({ abi: tokenAbi, data: state.sent[0].data });
    assert.equal(approval.args[1], 0n);
    await quote(page, '2');
    await expect(approveTokenButton(page)).toBeEnabled();
  }, { tokenAllowance: 10n ** 18n });

  await test('Account and chain events invalidate existing quotes and gate signing', async ({ page, state }) => {
    await connect(page);
    await quote(page);
    state.accounts = [nextAccount];
    await page.evaluate(value => window.__testEmit('accountsChanged', value), state.accounts);
    await expect(swapButton(page)).toHaveCount(0);
    await quote(page);
    state.chainId = '0x1';
    await page.evaluate(value => window.__testEmit('chainChanged', value), state.chainId);
    await expect(page.getByRole('button', { name: /Switch to Sepolia/i })).toBeVisible();
    await expect(swapButton(page)).toHaveCount(0);
    assert.equal(state.sent.length, 0);
  });

  await test('Missing deployed bytecode prevents swap controls from enabling', async ({ page, state }) => {
    await connectButton(page).click();
    await expect(page.getByText(/code|verification|contract.*unavailable/i).last()).toBeVisible();
    await expect(swapButton(page)).toHaveCount(0);
    assert.equal(state.sent.length, 0);
  }, { missingCode: true });

  await test('Initialized zero active liquidity delegates executable pricing to the quoter', async ({ page, state }) => {
    await connect(page);
    await quote(page);
    await expect(swapButton(page)).toBeEnabled();
    assert.equal(state.sent.length, 0);
  }, { liquidity: 0n });

  await test('Uninitialized pools reject quotes before any signing request', async ({ page, state }) => {
    await connect(page);
    await amountField(page).fill('0.1');
    await quoteButton(page).click();
    await expect(page.getByRole('alert')).toContainText(/not.*initialized|uninitialized/i);
    await expect(swapButton(page)).toHaveCount(0);
    assert.equal(state.sent.length, 0);
  }, { sqrtPriceX96: 0n, liquidity: 0n });

  await test('Configured RPC fallback preserves reads and quotes when the first endpoint fails', async ({ page, state }) => {
    await connect(page);
    await quote(page);
    await expect(swapButton(page)).toBeEnabled();
    assert.ok(state.transportUrls.some(url => url.startsWith(harness.deployment.network.rpcUrls[1])));
    assert.equal(state.sent.length, 0);
  }, { failFirstRpc: true });

  await test('A runtime ABI hash mismatch blocks the deployment with a recoverable error', async ({ page, state }) => {
    await expect(page.getByRole('heading', { name: /Unable to load this deployment/i })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/hash|interface/i);
    await expect(page.getByRole('button', { name: /Reload deployment/i })).toBeEnabled();
    assert.equal(state.requests.some(request => request.method === 'eth_requestAccounts'), false);
    assert.equal(state.sent.length, 0);
  }, { tamperAbi: true });

  await test('Transient receipt RPC failures do not resubmit the transaction', async ({ page, state }) => {
    await connect(page);
    await quote(page);
    await swapButton(page).click();
    await expect(page.getByText(/Swap confirmed/i)).toBeVisible({ timeout: 15000 });
    assert.equal(state.receiptFailures, 0);
    assert.equal(state.sent.length, 1);
  }, { receiptFailures: 3 });

  await test('Nested quoter liquidity reverts are translated into a specific readable error', async ({ page, state }) => {
    await connect(page);
    await amountField(page).fill('0.1');
    await quoteButton(page).click();
    await expect(page.getByRole('alert')).toHaveText('The pool does not have enough liquidity for this swap.');
    assert.equal(state.sent.length, 0);
  }, { nestedQuoteRevert: true });

  for (const width of [1440, 768, 390, 320]) {
    await test(`Rendered ${width}px reflow, keyboard access and automated WCAG checks`, async ({ page }) => {
      const overflow = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(overflow.scroll <= overflow.viewport, `Horizontal overflow ${JSON.stringify(overflow)}`);
      const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(scan.violations.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => node.target) })), []);
      await connectButton(page).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('.wallet-details')).toContainText('1,000 GFAM');
      await amountField(page).focus();
      await page.keyboard.type('0.1');
      await quoteButton(page).focus();
      await page.keyboard.press('Enter');
      await expect(swapButton(page)).toBeEnabled();
      await swapButton(page).focus();
      const connectedWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(connectedWidth <= width, 'Connected quote state has no horizontal overflow');
      const skipBounds = await page.getByRole('link', { name: 'Skip to swap', exact: true }).boundingBox();
      assert.ok(skipBounds && skipBounds.y + skipBounds.height <= 0, 'Unfocused skip link remains above the viewport');
      await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      await mkdir(resolve(import.meta.dirname, '../../docs/evidence'), { recursive: true });
      await page.screenshot({ path: resolve(import.meta.dirname, `../../docs/evidence/interaction-${width}.png`), fullPage: true });
      return { viewportWidth: width, documentWidth: overflow.scroll, connectedDocumentWidth: connectedWidth, skipLinkHiddenUnlessFocused: true, axeViolations: scan.violations.length, axePasses: scan.passes.length, axeIncompleteRules: scan.incomplete.map(item => item.id) };
    }, { viewport: { width, height: 1000 } });
  }
} finally {
  clearTimeout(timeout);
  await harness.close();
  await mkdir(resolve(import.meta.dirname, '../../docs'), { recursive: true });
  const report = {
    started, finished: new Date().toISOString(), command: 'npm test --prefix web',
    deploymentManifestSha256: harness.manifestSha256,
    environment: { engine: `Chromium ${harness.browserVersion} via Playwright`, staticBase: '/preview/', rpc: 'Mocked vetted RPC endpoints', wallet: 'Mocked EIP-1193 browser wallet' },
    screenshots: [1440, 768, 390, 320].map(width => `docs/evidence/interaction-${width}.png`),
    results, limitations: ['No real wallet extension, transaction broadcast, funded swap or live-chain execution was tested.', 'Automated axe checks are not a screen-reader session or a guarantee of accessibility compliance.', 'CSS viewport reflow is not native browser zoom or physical-device validation.'],
  };
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`${results.filter(result => result.status === 'passed').length}/${results.length} checks passed. Evidence: docs/test-results.json`);
}
if (results.some(result => result.status === 'failed')) process.exitCode = 1;
