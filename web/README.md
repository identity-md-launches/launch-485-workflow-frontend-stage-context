# Great Family frontend

A static, one-page ETH / GFAM swap interface for the attested Sepolia deployment. The approved connected-wallet action is **Swap**. This source does not redeploy contracts, publish the site, or add token administration.

## Run and rebuild

Tested with Node.js 22.22.1 and npm 9.2.0. Run from `web/`:

```sh
npm ci
npm run typecheck
npm run build
npm run preview -- --host 127.0.0.1
```

`npm run dev` first builds the production export, then starts Vite with source hot reload. Its middleware serves the same exported deployment manifest and ABI. `npm run preview` serves the production files. Use HTTP hosting; opening `index.html` directly with `file://` cannot load the fetched configuration reliably.

The build runs deployment/ABI validation, generates third-party notices, exports Vite to repository-root `dist/`, then emits and verifies `dist/imd-deployment.json`. The `./` base, relative assets, local font and hash links support gateway subpaths without rewrites. The publisher hosts the committed export without rebuilding. Always rebuild after source or runtime-asset changes; never hand-edit the generated manifest.

## Configuration and trust boundary

- `deployment/deployment.json` and `deployment/network.json` retain the exact supplied handoff bytes so builds still work after `.imd/reads/` is removed.
- `deployment/abi/LaunchToken.json` is the raw implementation ABI extracted with `git show` at the handoff's deployed source commit. Both canonical Keccak binding and exact pinned Git bytes are checked when that commit is available. A source ZIP without Git retains the hash-bound ABI for rebuilding.
- `scripts/prepare.mjs` derives only the pool's fee, spacing, paired currency and contract names into `src/generated/pool.json`. The effective opening price is read from chain, not inferred from the legacy initial price.
- **`dist/imd-deployment.json` is the sole runtime deployment map.** `src/config.ts` fetches it and every referenced ABI, verifies canonical ABI hashes and derives the pool key. There is no independent compiled map of deployment addresses, chain IDs or RPC URLs.
- The manifest copies the exact contract set and network/wallet-add-chain objects, permits only the required top-level keys and hashes every other exported file. `scripts/verify.mjs` checks identities, ABI binding, inventory, hashes, safe paths and limits.
- `src/protocol.ts` contains protocol interfaces and the router tuple specified by the assignment. All protocol addresses come from the manifest's vetted network block. `src/chain.ts` verifies chain ID and nonempty deployed code before enabling transaction paths. These checks do not prove economic safety or attest contract bytecode equivalence.

Changing deployment is a new handoff operation: replace the validated snapshots and ABI together, review pool derivation, rebuild, and rerun the checks. Do not patch an address in the UI. No private credentials are used or required.

## Wallet and swap behavior

An injected EIP-1193 Ethereum browser wallet is supported. No WalletConnect project ID was supplied, so remote/QR connectors are not configured. Account and chain events clear stale quotes and balances. Unknown-chain error 4902 offers the handoff's exact `wallet_addEthereumChain` parameters and switches again.

Live reads include token metadata, total supply, connected balances, token and router allowances, pool state and block number. They use the supplied public RPCs in order with bounded request timeouts. Visible pages refresh every 12 seconds, consistent with Ethereum's block cadence; receipt polling is four seconds. Successful chain/code verification is cached for five minutes. RPC failure disables signing until reads recover. Addresses are checksummed, copyable, fully available in link titles/accessibility labels, and linked to the configured explorer. ENS lookup is not implemented for this Sepolia interface.

1. Choose buy or sell, an exact decimal amount, and 0.01–5% slippage (default 0.5%). Keep ETH for gas. No USD source was supplied; the UI says USD pricing is unavailable.
2. Request a read-only quoter simulation. Quote minimum output uses integer arithmetic and expires after 60 seconds. Changing amount, direction, slippage, account or chain invalidates it. Zero active liquidity alone does not reject a quote: initialized pools can cross to funded ranges.
3. ETH input requires no approval. GFAM input shows two explicit transactions: exact token allowance to Permit2, then exact Permit2 allowance to the vetted router, expiring after 30 minutes. Existing nonzero token allowances must be reset before replacement. Revoke token approval is available when an allowance remains.
4. Each approval waits for a successful receipt and fresh reads. Get a fresh quote for the next step. The final review shows exact input, minimum output, recipient context, rate and deadline.
5. The exact router `execute` is simulated before signing. It uses `0x10` / `0x060c0f`, native input as value, and the quote's minimum output/deadline. Account and chain are checked again immediately before signing.
6. Submitted transactions stay locked until receipt resolution; temporary receipt errors retry the existing hash. Wallet rejection, on-chain failure and cancellation/replacement are distinct outcomes. Success refreshes chain state. Pending state is local to this page session; after reloading, inspect the transaction in your wallet/explorer before submitting another action.

There are no generic transfer, mint, burn, liquidity or admin controls because they are outside the approved Swap workflow. The token has no administrator. A successful quote does not guarantee a funded router swap will execute.

## Validation

```sh
npm run typecheck
npm run build
npm run verify
npm run test:integrity
npm run test:service
npx playwright install chromium
npm test
npm run check:rpc
```

For an already installed compatible Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium` for `npm test`. The browser runner starts and closes its own bounded HTTP server at `/preview/`, intercepts all RPC/wallet traffic and never broadcasts. Its recorded rates and balances are fixtures, not market data. Service tests cover receipt timeouts/replacements and stale allowance checks. `check:rpc` performs only live chain/code/token reads.

See [validation and review](../docs/VALIDATION.md), [implemented design](../docs/DESIGN.md), [ABI/export integrity](../docs/INTEGRITY.md), and [read-only pool observations](../docs/LIVE-READS.md). Browser reports bind to the SHA-256 of the tested deployment manifest.

## Packaging and limitations

Keep source, lockfile, ABI snapshots and necessary frontend configuration in `web/`; runtime files in root `dist/`; evidence/docs in `docs/`. Only `web/.gitignore` is budgeted for ignore changes. Its recursive basename patterns exclude nested dependencies, caches, reports and unnecessary package archives. No offline npm mirror or submodule is needed. Retain `dist/THIRD-PARTY-NOTICES.txt` with the export.

The explicit write boundary prohibits root `DESIGN.md`; its requested content is delivered at `docs/DESIGN.md`. No live domain was supplied, so absolute Open Graph URL/image and social preview validation remain pending publication. Browser tests use mocks; no real wallet extension, funded swap or transaction broadcast was tested. Publication, IPFS/CID/name checks and their RPC verification belong to the control plane.
