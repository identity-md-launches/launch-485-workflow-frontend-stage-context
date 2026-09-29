import { useCallback, useEffect, useRef, useState } from 'react';
import { formatUnits, getAddress, type Address, type Hash } from 'viem';
import { loadConfig, type RuntimeConfig } from './config';
import { ChainService, humanError, parseAmount, type ChainSnapshot, type Quote } from './chain';

type Direction = 'buy' | 'sell';
type Pending = 'connect' | 'switch' | 'quote' | 'token' | 'permit2' | 'swap' | 'revoke' | null;
type Wallet = { account?: Address; chainId?: number };

function Icon({ name, size = 20 }: { name: 'arrow' | 'switch' | 'external' | 'wallet' | 'check' | 'copy' | 'refresh'; size?: number }) {
  const paths = { arrow: 'M4 12h16m-6-6 6 6-6 6', switch: 'M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4', external: 'M14 4h6v6m0-6L10 14M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5', wallet: 'M4 6h15a1 1 0 0 1 1 1v13H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13v2m3 5h-6v5h6M16 13.5h.01', check: 'm5 12 4 4L19 6', copy: 'M9 9h11v11H9zM15 5V2H2v13h3', refresh: 'M20 11a8 8 0 1 0-2 6M20 4v7h-7' };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function FamilyMark({ small = false }: { small?: boolean }) {
  return <span className={`family-mark ${small ? 'small' : ''}`} aria-hidden="true"><svg viewBox="0 0 44 44" fill="currentColor"><circle cx="16" cy="14" r="6" /><circle cx="31" cy="15" r="5" /><path d="M5 34a11 11 0 0 1 22 0Zm23 0a14 14 0 0 0-3-9 9 9 0 0 1 14 9Z" /></svg></span>;
}
function TokenIcon({ token }: { token: boolean }) {
  return token ? <FamilyMark small /> : <span className="eth-icon" aria-hidden="true"><svg viewBox="0 0 24 30"><path d="m12 1 9 14-9 5-9-5Z" fill="currentColor" /><path d="m3 18 9 5 9-5-9 11Z" fill="currentColor" opacity=".7" /></svg></span>;
}
function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function amount(value: bigint | undefined, decimals: number, places = 5) {
  if (value === undefined) return '—';
  const raw = formatUnits(value, decimals);
  const [whole, fraction = ''] = raw.split('.');
  if (value > 0n && Number(raw) < 10 ** -places) return `< ${10 ** -places}`;
  return Number(whole).toLocaleString('en-US') + (fraction ? `.${fraction.slice(0, places).replace(/0+$/, '')}`.replace(/\.$/, '') : '');
}
function AddressLink({ address, explorer, label }: { address: Address; explorer: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  useEffect(() => { setCopied(false); setCopyError(false); }, [address]);
  return <span className="address-group"><a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" title={getAddress(address)} aria-label={`${label}: ${getAddress(address)}. View on explorer`}>{short(getAddress(address))}<Icon name="external" size={13} /></a><button className="copy-button" aria-label={`Copy ${label} address`} title={getAddress(address)} onClick={async () => { try { await navigator.clipboard.writeText(getAddress(address)); setCopied(true); setCopyError(false); } catch { setCopyError(true); } }}>{copied ? <Icon name="check" size={14} /> : <Icon name="copy" size={14} />}</button><span className="sr-only" role="status">{copied ? `${label} address copied` : copyError ? `Copy unavailable. Full address: ${getAddress(address)}` : ''}</span></span>;
}

export default function App() {
  const [config, setConfig] = useState<RuntimeConfig>();
  const [service, setService] = useState<ChainService>();
  const [loadError, setLoadError] = useState('');
  const [wallet, setWallet] = useState<Wallet>({});
  const [snapshot, setSnapshot] = useState<ChainSnapshot>();
  const [verified, setVerified] = useState(false);
  const [readError, setReadError] = useState('');
  const [checking, setChecking] = useState(false);
  const [direction, setDirection] = useState<Direction>('buy');
  const [input, setInput] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<Quote>();
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState<Hash>();
  const [now, setNow] = useState(Date.now());
  const busy = useRef(false);
  const generation = useRef(0);
  const readSequence = useRef(0);
  const walletRef = useRef(wallet);
  const amountInput = useRef<HTMLInputElement>(null);
  const slipInput = useRef<HTMLInputElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    loadConfig().then(c => { if (active) { setConfig(c); setService(new ChainService(c)); } }).catch(e => { if (active) setLoadError(humanError(e)); });
    return () => { active = false; };
  }, []);

  const invalidate = useCallback(() => { generation.current++; setQuote(undefined); setError(''); setFieldError(''); setStatus(''); }, []);
  const updateWallet = useCallback((next: Wallet) => {
    if (walletRef.current.account === next.account && walletRef.current.chainId === next.chainId) return;
    walletRef.current = next;
    readSequence.current++;
    setWallet(next); setSnapshot(undefined); invalidate();
  }, [invalidate]);

  useEffect(() => {
    if (!service) return;
    let active = true;
    service.walletState().then(w => { if (active) updateWallet(w); }).catch(() => {});
    const unsub = service.subscribeWallet(async () => { try { const w = await service.walletState(); if (active) updateWallet(w); } catch { if (active) updateWallet({}); } });
    return () => { active = false; unsub(); };
  }, [service, updateWallet]);

  const refresh = useCallback(async () => {
    if (!service) return;
    const seq = ++readSequence.current;
    const account = walletRef.current.account;
    setChecking(true);
    try {
      await service.verify();
      const data = await service.read(account);
      if (seq === readSequence.current) { setVerified(true); setSnapshot(data); setReadError(''); }
    } catch (e) {
      if (seq === readSequence.current) { setVerified(false); setReadError(humanError(e)); }
    } finally { if (seq === readSequence.current) setChecking(false); }
  }, [service]);

  useEffect(() => { if (service) void refresh(); }, [service, wallet.account, wallet.chainId, refresh]);
  useEffect(() => {
    if (!service) return;
    const timer = window.setInterval(() => { if (!document.hidden && !busy.current) void refresh(); }, 12_000);
    return () => clearInterval(timer);
  }, [service, refresh]);
  useEffect(() => { if (!quote) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [quote]);

  const tokenSymbol = snapshot?.symbol || 'GFAM';
  const decimals = snapshot?.decimals ?? 18;
  const nativeDecimals = config?.network.nativeCurrency.decimals ?? 18;
  const nativeSymbol = config?.network.nativeCurrency.symbol ?? 'ETH';
  const inputSymbol = direction === 'buy' ? nativeSymbol : tokenSymbol;
  const outputSymbol = direction === 'buy' ? tokenSymbol : nativeSymbol;
  const inputDecimals = direction === 'buy' ? nativeDecimals : decimals;
  const outputDecimals = direction === 'buy' ? decimals : nativeDecimals;
  const balance = direction === 'buy' ? snapshot?.nativeBalance : snapshot?.tokenBalance;
  const connected = !!wallet.account;
  const wrongChain = connected && wallet.chainId !== config?.deployment.chainId;
  const quoteExpired = !!quote && now >= quote.expiresAt;
  const tokenApprovalNeeded = direction === 'sell' && !!quote && (!snapshot || snapshot.tokenAllowance < quote.amountIn);
  const routerApprovalNeeded = direction === 'sell' && !!quote && (!snapshot || snapshot.routerAllowance < quote.amountIn || snapshot.routerExpiration * 1000 < now + 120_000);
  const needsReset = tokenApprovalNeeded && !!snapshot && snapshot.tokenAllowance > 0n;
  const locked = pending !== null;

  async function connect() {
    if (!service || busy.current) return;
    busy.current = true; setPending('connect'); setError(''); setStatus('Open your wallet to connect.');
    try { updateWallet(await service.connect()); }
    catch (e) { setError(humanError(e)); setStatus(''); }
    finally { busy.current = false; setPending(null); requestAnimationFrame(() => primaryButton.current?.focus()); }
  }
  async function switchNetwork() {
    if (!service || busy.current) return;
    busy.current = true; setPending('switch'); setError(''); setStatus(`Confirm the network change in your wallet.`);
    try { await service.switchChain(); updateWallet(await service.walletState()); }
    catch (e) { setError(humanError(e)); setStatus(''); }
    finally { busy.current = false; setPending(null); requestAnimationFrame(() => primaryButton.current?.focus()); }
  }
  async function getQuote() {
    if (!service || !verified || wrongChain || busy.current) return;
    setError(''); setFieldError(''); setStatus(''); setQuote(undefined);
    let parsed: bigint;
    const bps = /^\d+(\.\d{1,2})?$/.test(slippage.trim()) ? Math.round(Number(slippage) * 100) : NaN;
    try { parsed = parseAmount(input, inputDecimals); if (parsed <= 0n) throw new Error('Enter an amount greater than zero.'); }
    catch (e) { setFieldError(humanError(e)); amountInput.current?.focus(); return; }
    if (!slippage.trim() || !Number.isInteger(bps) || bps < 1 || bps > 500) { setError('Set slippage between 0.01% and 5%, with at most two decimal places.'); slipInput.current?.focus(); return; }
    if (balance !== undefined && parsed > balance) { setFieldError(`Not enough ${inputSymbol}. Enter an amount within your balance.`); amountInput.current?.focus(); return; }
    if (direction === 'buy' && balance !== undefined && parsed === balance) { setFieldError('Keep some ETH in your wallet for network fees.'); amountInput.current?.focus(); return; }
    busy.current = true; setPending('quote');
    const gen = ++generation.current;
    try { const next = await service.quote(direction, parsed, bps); if (gen === generation.current) { setQuote(next); setNow(Date.now()); setStatus('Quote ready. Review the minimum received before continuing.'); } }
    catch (e) { if (gen === generation.current) setError(humanError(e)); }
    finally { busy.current = false; setPending(null); }
  }
  async function transact(action: 'token' | 'permit2' | 'swap' | 'revoke') {
    if (!service || !wallet.account || !verified || wrongChain || busy.current) return;
    if (action !== 'revoke' && (!quote || Date.now() >= quote.expiresAt)) { invalidate(); setError('This quote expired. Get a fresh quote to continue.'); return; }
    const account = wallet.account;
    const gen = generation.current;
    busy.current = true; setPending(action); setError(''); setTxHash(undefined);
    setStatus(action === 'swap' ? 'Checking the swap before opening your wallet…' : 'Checking the approval before opening your wallet…');
    const onHash = (hash: Hash) => { setTxHash(hash); setStatus('Transaction submitted. Waiting for confirmation…'); };
    try {
      if (action === 'swap') await service.swap(account, quote!, onHash);
      else if (action === 'token' || action === 'revoke') await service.approveToken(account, action === 'revoke' || needsReset ? 0n : quote!.amountIn, onHash);
      else await service.approveRouter(account, quote!.amountIn, onHash);
      await refresh();
      if (gen === generation.current) {
        if (action === 'swap') { setQuote(undefined); setInput(''); setStatus('Swap confirmed. Your balances have been refreshed.'); }
        else { setQuote(undefined); setStatus(action === 'revoke' || needsReset ? 'Token approval cleared. Get a fresh quote to continue.' : 'Approval confirmed. Get a fresh quote for the next step.'); }
      }
    } catch (e) { if (gen === generation.current) { setError(humanError(e)); setStatus(''); } }
    finally { busy.current = false; setPending(null); }
  }
  function changeDirection(next: Direction) { if (locked) return; setDirection(next); setInput(''); invalidate(); }
  const actionLabel = !connected ? 'Connect wallet' : wrongChain ? `Switch to ${config?.network.name}` : !verified ? (checking ? 'Checking network…' : 'Network unavailable') : !quote || quoteExpired ? (quoteExpired ? 'Refresh quote' : 'Get quote') : tokenApprovalNeeded ? (needsReset ? 'Reset token approval' : `Approve ${tokenSymbol}`) : routerApprovalNeeded ? 'Approve swap access' : 'Confirm swap';
  const pendingLabels: Record<Exclude<Pending, null>, string> = { connect: 'Connecting…', switch: 'Switching network…', quote: 'Getting quote…', token: needsReset ? 'Resetting approval…' : `Approving ${tokenSymbol}…`, permit2: 'Approving swap access…', swap: 'Confirming swap…', revoke: 'Revoking approval…' };
  function primaryAction() {
    if (!connected) return void connect();
    if (wrongChain) return void switchNetwork();
    if (!quote || quoteExpired) return void getQuote();
    return void transact(tokenApprovalNeeded ? 'token' : routerApprovalNeeded ? 'permit2' : 'swap');
  }

  if (loadError) return <main className="load-state"><FamilyMark /><h1>Unable to load this deployment</h1><p role="alert">{loadError}</p><p>The deployment or its ABI could not be verified. Reload to try again.</p><button className="primary" onClick={() => window.location.reload()}>Reload deployment</button></main>;
  if (!config) return <main className="load-state"><FamilyMark /><h1>Welcome to the family.</h1><p role="status">Loading the verified deployment…</p></main>;

  return <>
    <a className="skip-link" href="#swap">Skip to swap</a>
    <header className="site-header page-width">
      <a className="brand" href="#" aria-label="Great Family home"><FamilyMark /><span>great family<span className="brand-caption">A shared beginning.</span></span></a>
      <nav aria-label="Main navigation"><a className="active" href="#swap" aria-current="page">Swap</a><a href="#about">About GFAM</a></nav>
      <div className="header-wallet"><span className="network-badge"><span className="network-dot" />{config.network.name}<span className="test-label">Testnet</span></span>{connected ? <span className="account-chip"><Icon name="wallet" size={16} />{short(getAddress(wallet.account!))}</span> : <button className="outline-button connect-top" onClick={connect} disabled={locked}><Icon name="wallet" size={16} />{pending === 'connect' ? 'Connecting…' : 'Connect wallet'}</button>}</div>
    </header>
    <main className="page-width">
      <div className="hero-grid">
        <section className="intro" aria-labelledby="hero-title">
          <div className="eyebrow"><span className="tiny-flower" aria-hidden="true">✳</span> Hello. We are the Great Family.</div>
          <h1 id="hero-title">Good things<br />grow <span>together.</span></h1>
          <p className="intro-copy">A little connection. A shared beginning.<br className="desktop-break" /> Your place in the family starts with GFAM.</p>
          <a className="intro-link" href="#about">Meet the token <span aria-hidden="true">↗</span></a>
          <div className="family-art" aria-hidden="true"><div className="art-grid" /><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-person person-a"><i /><b /></div><div className="art-person person-b"><i /><b /></div><div className="art-person person-c"><i /><b /></div><span className="art-star">✳</span><span className="art-caption">Rooted in connection.</span><span className="art-small">G F A M</span></div>
        </section>
        <section className="swap-panel" id="swap" aria-labelledby="swap-title">
          <div className="panel-heading"><div><h2 id="swap-title">Make a connection.</h2><p>Swap {nativeSymbol} and {tokenSymbol}</p></div><span className="round-mark" aria-hidden="true">↗</span></div>
          <div className="direction-control" role="group" aria-label="Swap direction"><button aria-pressed={direction === 'buy'} disabled={locked} onClick={() => changeDirection('buy')}>Buy {tokenSymbol}</button><button aria-pressed={direction === 'sell'} disabled={locked} onClick={() => changeDirection('sell')}>Sell {tokenSymbol}</button></div>
          <div className="amount-box">
            <div className="amount-label"><label htmlFor="pay-amount">You pay</label>{connected && <span title={balance !== undefined ? `${formatUnits(balance, inputDecimals)} ${inputSymbol}` : undefined}>Balance: {amount(balance, inputDecimals)}</span>}</div>
            <div className="amount-row"><input ref={amountInput} id="pay-amount" name="amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={input} disabled={locked} aria-invalid={!!fieldError} aria-describedby={fieldError ? 'amount-error' : 'usd-note'} onChange={e => { setInput(e.target.value); invalidate(); }} /><span className="token-pill"><TokenIcon token={direction === 'sell'} />{inputSymbol}</span></div>
            <p className="amount-subtitle">{direction === 'buy' ? 'Native Sepolia Ether' : 'Great Family token'}</p>
          </div>
          <div className="switch-row"><button className="switch-direction" aria-label="Reverse swap direction" disabled={locked} onClick={() => changeDirection(direction === 'buy' ? 'sell' : 'buy')}><Icon name="switch" size={18} /></button></div>
          <div className="amount-box receive-box">
            <div className="amount-label"><span>You receive</span><span>Estimated</span></div>
            <div className="amount-row"><output className={`receive-amount ${quote ? 'quoted' : ''}`} aria-label="Estimated output" title={quote ? formatUnits(quote.amountOut, outputDecimals) : undefined}>{quote ? amount(quote.amountOut, outputDecimals, 6) : '0.00'}</output><span className="token-pill"><TokenIcon token={direction === 'buy'} />{outputSymbol}</span></div>
            <p className="amount-subtitle">{quote ? 'Based on your latest quote' : 'Get a quote to see the current rate'}</p>
          </div>
          {fieldError && <p className="field-error" id="amount-error" role="alert">{fieldError}</p>}
          <div className="slippage-row"><label htmlFor="slippage">Slippage tolerance</label><span><input ref={slipInput} id="slippage" name="slippage" aria-label="Slippage tolerance percent" aria-invalid={error.startsWith('Set slippage')} aria-describedby={error.startsWith('Set slippage') ? 'action-error' : undefined} inputMode="decimal" value={slippage} disabled={locked} onChange={e => { setSlippage(e.target.value); invalidate(); }} />%</span></div>
          {quote && <div className="quote-details" data-testid="quote-details"><dl><div><dt>Minimum received</dt><dd title={formatUnits(quote.minimumOut, outputDecimals)}>{amount(quote.minimumOut, outputDecimals, 8)} {outputSymbol}</dd></div><div><dt>Rate</dt><dd>1 {inputSymbol} ≈ {Number(formatUnits(quote.amountOut, outputDecimals)) / Number(formatUnits(quote.amountIn, inputDecimals)) < 0.000001 ? '< 0.000001' : (Number(formatUnits(quote.amountOut, outputDecimals)) / Number(formatUnits(quote.amountIn, inputDecimals))).toLocaleString('en-US', { maximumFractionDigits: 6 })} {outputSymbol}</dd></div><div><dt>Quote validity</dt><dd>{quoteExpired ? 'Expired — refresh to continue' : `${Math.max(0, Math.ceil((quote.expiresAt - now) / 1000))} seconds`}</dd></div><div><dt>Network fee</dt><dd>Shown in your wallet</dd></div></dl>{direction === 'sell' && <ol className="approval-steps"><li className={!tokenApprovalNeeded ? 'complete' : ''}>Approve {tokenSymbol} for Permit2</li><li className={!routerApprovalNeeded ? 'complete' : ''}>Approve router access</li><li>Confirm swap</li></ol>}<p className="review-copy">{tokenApprovalNeeded ? (needsReset ? 'Clear your existing token allowance before setting a new amount.' : `Allow Permit2 to spend exactly ${formatUnits(quote.amountIn, decimals)} ${tokenSymbol}. Approval does not make a swap.`) : routerApprovalNeeded ? 'Allow the router to use this amount through Permit2. Access expires in 30 minutes.' : `Swap ${formatUnits(quote.amountIn, inputDecimals)} ${inputSymbol} for at least ${formatUnits(quote.minimumOut, outputDecimals)} ${outputSymbol} to your connected wallet.`}</p></div>}
          {wrongChain && <p className="notice">Your wallet is on another network. Switch to {config.network.name} to continue.</p>}
          {error && <div className="error-box" id="action-error" role="alert">{error}</div>}
          <button ref={primaryButton} className="primary swap-action" onClick={primaryAction} disabled={locked || (connected && !wrongChain && !verified)}>{pending && pending !== 'revoke' ? <><span className="loading-dot" aria-hidden="true" />{pendingLabels[pending]}</> : <>{actionLabel}<Icon name={!connected ? 'wallet' : 'arrow'} size={18} /></>}</button>
          <div className="transaction-status" role="status">{status}</div>
          {txHash && <a className="transaction-link" href={`${config.network.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">View transaction {short(txHash)}<Icon name="external" size={13} /></a>}
          <p className="swap-footnote" id="usd-note">{!connected ? 'Connect a browser wallet to get started.' : 'Sepolia test tokens. Keep ETH for network fees.'}<br />USD pricing is unavailable for this testnet pair.</p>
          <div className="powered-line"><span aria-hidden="true">◇</span> Powered by Uniswap v4<span className="fee-tag">{config.pool.fee / 10000}% pool fee</span></div>
        </section>
      </div>
      <section className="about-section" id="about" aria-labelledby="about-title">
        <div className="about-heading"><div><span className="eyebrow small-eyebrow">Meet GFAM</span><h2 id="about-title">A token. A shared beginning.</h2></div><div className="live-status"><span className={`status-dot ${verified ? 'is-live' : ''}`} />{verified ? `Live on ${config.network.name}` : checking ? 'Checking network' : 'Network unavailable'}<button className="icon-button" onClick={refresh} aria-label="Refresh live data" disabled={checking || locked}><Icon name="refresh" size={16} /></button></div></div>
        <div className="stats-grid"><div className="stat"><span>Total supply</span><strong>{snapshot ? amount(snapshot.totalSupply, decimals, 0) : '—'}<small>{tokenSymbol}</small></strong></div><div className="stat"><span>Pool status</span><strong className="pool-status-value">{snapshot ? snapshot.sqrtPriceX96 === 0n ? 'Not initialized' : snapshot.liquidity > 0n ? 'Liquidity available' : 'No active liquidity' : 'Awaiting network'}</strong><small>{snapshot?.poolError ? 'Get a quote to check availability' : `${nativeSymbol} / ${tokenSymbol} · No hook`}</small></div><div className="stat"><span>Network</span><strong>{config.network.name}<small className="test-tag">Testnet</small></strong><small>Practice with test tokens</small></div><div className="stat"><span>Token contract</span><AddressLink address={config.token.address} explorer={config.network.explorer} label="token contract" /><small>Fixed supply · No admin role</small></div></div>
        {readError && <div className="read-error" role="status"><strong>Live data is unavailable.</strong> {readError} Use “Refresh live data” to retry. Swaps stay unavailable until verification succeeds.</div>}
        {connected && <div className="wallet-details"><div><span className="detail-label">Connected wallet</span><AddressLink address={wallet.account!} explorer={config.network.explorer} label="connected wallet" /></div><div><span className="detail-label">Your balances</span><p>{amount(snapshot?.tokenBalance, decimals)} {tokenSymbol} <span className="muted">/</span> {amount(snapshot?.nativeBalance, nativeDecimals)} {nativeSymbol}</p></div><div><span className="detail-label">Token allowance to Permit2</span><p>{amount(snapshot?.tokenAllowance, decimals)} {tokenSymbol}</p></div>{snapshot && snapshot.tokenAllowance > 0n && <button className="outline-button" disabled={locked || wrongChain || !verified} onClick={() => transact('revoke')}>{pending === 'revoke' ? 'Revoking approval…' : 'Revoke token approval'}</button>}</div>}
        <details className="deployment-details"><summary>Network & deployment details<Icon name="external" size={14} /></summary><div className="deployment-body"><p>This is a Sepolia testnet market. Quotes depend on available pool liquidity. A quote expires after 60 seconds; the router enforces your minimum output. Token approvals and swaps each require a wallet confirmation.</p><dl><div><dt>Token</dt><dd>{snapshot?.name ?? 'Great Family'} ({tokenSymbol}) · {decimals} decimals</dd></div><div><dt>Last read</dt><dd>{snapshot ? `Block ${snapshot.blockNumber.toLocaleString()}` : 'Waiting for an RPC response'}</dd></div><div><dt>Pool ID</dt><dd className="hash-value">{config.poolId}</dd></div><div><dt>Source commit</dt><dd className="hash-value">{config.deployment.sourceCommit}</dd></div><div><dt>Attestation</dt><dd className="hash-value">{config.deployment.attestationHash}</dd></div></dl><div className="protocol-links">{Object.entries(config.network.uniswapV4).map(([name, address]) => <div key={name}><span>{({poolManager:'Pool manager', universalRouter:'Swap router', quoter:'Quoter', stateView:'Pool state', positionManager:'Position manager', permit2:'Permit2'} as Record<string,string>)[name]}</span><AddressLink address={address as Address} explorer={config.network.explorer} label={name} /></div>)}</div><p className="faucet-links">Need test ETH? {config.network.faucets.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">{i === 0 ? 'Google Cloud faucet' : 'Alchemy faucet'} ↗</a>)}</p></div></details>
      </section>
    </main>
    <footer className="page-width site-footer"><span><FamilyMark small /> A little closer, together.</span><div><a href="#swap">Back to swap ↑</a><span>Built on Ethereum.</span></div></footer>
  </>;
}
