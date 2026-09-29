# Frontend validation and consolidated interface review

Worker validation performed 2026-09-29. This is a report of local checks, not independent certification or a claim that publication checks ran.

## Scope and assumptions

Implemented the approved Great Family connected-wallet **Swap** workflow for the supplied Sepolia token-only launch: ETH/GFAM buy/sell, wallet connection and chain addition, reads, quotes, slippage, approvals/reset/revocation, router simulation, receipts, error recovery and deployment observability. Source is `web/`; the ready-to-host export is repository-root `dist/`.

A quiet light theme, Manrope typography, family illustration and green/cream palette were inferred from the supplied family identity. The app supports English and injected EIP-1193 wallets. No remote-wallet project ID, live site domain, USD price source, liquidity-management UI, token-transfer workflow or administrative action was supplied. There is no fabricated market price, balance or successful transaction state in the production app.

**Path conflict:** root `DESIGN.md` is requested in one acceptance item but prohibited by the explicit write boundary. The complete implemented design document is delivered as `docs/DESIGN.md`. Root configuration, contract source, root ignore file, libraries and workflow files remain unchanged. `web/.gitignore` is the only ignore file changed and has an explicit path allowance.

## Commands and outcomes

| Command, from repository root | Outcome |
| --- | --- |
| `npm --prefix web run typecheck` | Passed after final source changes; strict TypeScript, no emit |
| `npm --prefix web run build` | Passed; Vite static export and post-build manifest verification |
| `npm --prefix web run verify` | Exact handoff/network/ABI and complete SHA-256 inventory passed |
| `npm --prefix web run test:integrity` | 10/10 passed, including mutation/path/inventory rejection cases |
| `npm --prefix web run test:service` | 7/7 passed, mocked receipt lifecycle and fresh approval guard |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=<installed Chromium> npm --prefix web test` | 27/27 browser scenarios passed on the final export; see bound report |
| `npm --prefix web run check:rpc` | All three configured endpoints passed chain/code/token reads; detailed evidence retained |

Environment: Node 22.22.1, npm 9.2.0, Vite 8.3.1, React 19.3.0, TypeScript 7.0.2, viem 2.57.1; exact dependencies are in `web/package-lock.json`. Playwright used available Chromium 145.0.7632.6 from `/home/imd-worker/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome` rather than downloading another browser. The production bundle is 625,854 bytes including its manifest, with 8 declared assets. One minified JavaScript chunk is approximately 545 kB (166 kB gzip); Vite's nonfatal 500 kB chunk advisory remains. The complete export is far below the asset and HTTP-budget limits.

Reproducible test source: `web/tests/browser.mjs`, `harness.mjs`, `service.mjs`, and `web/scripts/test-integrity.mjs`. Reports are `docs/test-results.json` (including the tested manifest SHA-256) and `docs/service-test-results.json`. Mock rates/balances and transport restrictions are documented in `web/tests/README.md`. There are no production test hooks or fake connected wallets bundled into `dist/`.

The browser runner serves the actual `dist/` files under `/preview/`, manages/terminates its own HTTP server and Chromium session, intercepts all external RPC/wallet calls, and records uncaught errors and failed static resources. Manual MCP inspection used a bounded local preview server because the guide's `test/scratch/browser/preview.json` was not supplied. That disposable server and browser session were closed after review.

## Interaction coverage

Browser validation covers missing wallet; rejected connection; wrong chain and exact 4902 add-chain fallback; connected metadata/balances; invalid/zero/negative/exponent/overprecision/overbalance amounts; exact decimal slippage including 0.29%; stale quote invalidation; quote expiry and direction changes; account/chain events and an account change during an in-flight quote; actual buy calldata decoding for router, pool key, 0x10/0x060c0f actions, input value, minimum output, settlement/take amounts and deadline; both exact sell approvals, receipt locks and refreshed allowances; permission rechecks before signing; reset and revoke controls; rejected signatures; simulation failure with no send; reverted/nested insufficient-liquidity quotes; transient receipt RPC errors with one submission; RPC fallback; missing bytecode; modified ABI fail-closed; initialized zero-active-liquidity quoting; uninitialized pool refusal.

Service checks additionally force receipt timeout/retry and attempted duplicate submission, cancelled/replaced/repriced receipts, an on-chain failure receipt, decoding of the actual observed nested liquidity error, and stale nonzero allowance rejection before simulation/signing. These are isolated mocks, not real wallet transactions.

At the live observed block, the pool had zero active liquidity but a 0.001 ETH buy quote succeeded; a 1 GFAM sell quote failed for liquidity. The frontend correctly leaves execution availability to the quoter. See `docs/LIVE-READS.md` and `docs/live-pool-reads.json` for block, outputs and limitations. Live checks used only reads/simulations; no transaction was signed or broadcast.

## Better Interface: six-domain coverage

The pinned workflow, six domains' core principles and implementation-documentation section were read and applied during construction. The Ethereum frontend UX reference was also applied, with task-specific network/USD constraints taking precedence.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native buttons, input labels, grouped direction controls, skip link, heading/landmark hierarchy, alerts/status, no positive tab order, keyboard connect/quote and visible Confirm swap focus. Axe WCAG A/AA scans at all four widths report no violations; decorative-background contrast checks remain marked incomplete, not passed. Not verified with a screen reader or physical assistive device. |
| Layout | Checked | Actual export at 1440×1000, 768×1000, 390×1000 and 320×1000; desktop/two-column and compact/one-column screenshots; disconnected and connected reflow checked without horizontal overflow. Mobile error state also inspected at 320×900. Native browser zoom, RTL and localization expansion not verified. |
| Writing | Checked | Verb-first actions; clear buy/sell and approval steps; explicit testnet/no-USD text; persistent recoverable errors; minimum output and recipient context before signing. No invented price, wallet balance or liquidity promise. |
| Typography | Checked | Locally bundled variable font loaded; heading hierarchy, amount/input sizing, numeric stability, long hashes and realistic connected review text checked in rendered screenshots. Latin/English coverage only. |
| Colors | Checked | Semantic tokens, default/hover boundaries, text/error/background and actual keyboard-focus pairs measured from rendered styles. Border contrast fixed and remeasured. See measurement artifact for exact pairs. Light theme only; automated decorative-gradient cases remain incomplete. |
| UI | Checked | Selected/unselected directions, primary/outline controls, hover/focus/disabled/pending/error/empty states reviewed; motion opt-in and static pending label retained under reduced motion. No dialog/overlay, localization or alternate theme exists. Animation at 10% speed, physical touch and platform-specific rendering were not reviewed. |

The browser's accessibility snapshot and axe scans are not screen-reader sessions. CSS viewport reflow is not browser-native zoom. Automated checks cannot establish full accessibility conformance.

## Findings, fixes and rechecks

| Severity / domain | Final source location | Evidence, correction and recheck |
| --- | --- | --- |
| High / contract flow | `web/src/chain.ts:229` | Initial guard rejected every zero-active-liquidity pool. Live initialized pool returned a valid buy quote at liquidity 0. Removed that guard, retained uninitialized check and quoter failure handling. New browser tests pass for both states. |
| Medium / writing, contract flow | `web/src/chain.ts:68` | Live sell quote wrapped NotEnoughLiquidity in UnexpectedRevertBytes. Added bounded nested custom-error decoding. Browser and service tests show the specific liquidity explanation. |
| Medium / input behavior | `web/src/App.tsx:141` | Floating-point multiplication could reject valid 0.29% slippage. Validate decimal precision before rounding basis points; bigint execution math remains exact. Browser case verifies 0.19942 fixture minimum. |
| Medium / wallet flow | `web/src/App.tsx:69`, `web/src/App.tsx:98` | Same-account network changes cleared reads without triggering an immediate refresh; duplicate events could clear them again. Depend on chain as well as account and ignore identical wallet state. Wrong-chain/account tests pass. |
| Medium / wallet flow | `web/src/chain.ts:175` | A wallet injected after initial render lacked event subscriptions. Attach subscriptions when the provider becomes available. Source reviewed; actual late-injected extension behavior not manually exercised. |
| High / transaction lifecycle | `web/src/chain.ts:339` | Receipt timeout previously released the submit lock although a submitted transaction could still confirm. Retry receipt reads for the existing hash, handle replacement/cancellation separately. Service timeout/duplicate/replacement cases and browser transient-receipt test pass. |
| High / approval flow | `web/src/chain.ts:258` | UI allowance snapshots could be stale before a positive approval. Freshly read and require existing allowance to be zero. UI reset flow and isolated guard tests pass. |
| Medium / colors | `web/src/styles.css:12`, `web/src/styles.css:84` | Original outlined boundary measured 2.53:1; first correction remained 2.97:1 on hover. Darkened control token to #778371, applied it to amount field and selected direction. Final default/hover rendered pairs meet 3:1; remeasured and browser matrix repeated. |
| Medium / accessibility | `web/src/App.tsx:204` | Axe flagged the direction div's accessible name as unsupported without a role. Added native-button group semantics (`role=group`). Repeated axe/keyboard matrix on final export. |
| Medium / focus, writing | `web/src/App.tsx:128` | Disabling the header connection button could leave focus at the document and its error below the mobile fold. Return focus to the main action after connect/switch; alert remains adjacent. Keyboard checks and mobile missing-wallet screenshot rechecked. |
| Build / packaging | `web/src/styles.css:1` | Installed font package did not expose latin.css. Replaced the failing import with an explicit local Latin WOFF2 @font-face. Final typecheck/build and real font-load/resource checks pass. |

No unresolved primary-flow or observed reflow defect remains. Remaining limitations are stated above and below rather than counted as successful checks.

## Evidence and completion

- `docs/evidence/desktop-live.png`: final disconnected desktop with public RPC reads.
- `docs/evidence/mobile-wallet-error.png`: final 320px missing-wallet/error state.
- `docs/evidence/interaction-{1440,768,390,320}.png`: final connected quote with keyboard focus, using clearly documented mock balances/rates.
- `docs/evidence/contrast-measurements.json`: rendered foreground/background pairs and computed WCAG ratios.
- `docs/evidence/browser-console.txt`, `browser-resources.txt`: manual final-export warning/error and local static request inspection.
- `docs/INTEGRITY.md`: implementation ABI provenance, exact handoff checks and live chain/code evidence.
- `docs/PACKAGING.md`: final path, byte-size and Git-delivery record.

**Complete for the stated permitted frontend implementation and validation scope; Git commit blocked by read-only metadata**, with the Git staging limitation recorded in `docs/PACKAGING.md` and the root-DESIGN path conflict explicitly resolved by delivering its content under `docs/`. Required worker build, typecheck, browser, interaction and integrity checks ran. Real extension UX, funded approval/swap settlement, long-lived pending state across reloads, physical devices, screen readers and native 200% zoom remain untested. Network reads/quotes can change after the recorded block. No social-domain/image check or IPFS/CID/named-site publication was performed. Those later control-plane checks are not worker completion prerequisites.
