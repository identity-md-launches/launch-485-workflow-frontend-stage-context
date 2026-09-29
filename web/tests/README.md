# Browser validation

Run `npm test --prefix web` after the production build. Install the Playwright Chromium browser using `npx playwright install chromium` from `web/`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an available compatible Chromium executable. Browser installations are tooling caches, not submission artifacts.

The bounded foreground script starts its own local server, loads the **committed production export** at `/preview/`, runs the scenarios, and closes its browser and server. It writes `docs/test-results.json` and four full-page screenshots under `docs/evidence/`. The report records the SHA-256 of the tested deployment manifest so the evidence can be matched to an export. Rebuild and rerun after changing frontend source.

Every public RPC request is intercepted before navigation. A scripted EIP-1193 wallet implements connection, switching, signing responses and wallet events. No signed transactions reach a chain. All calls outside the configured RPC endpoints are rejected. Fixtures use 10 ETH, 1,000 GFAM and an artificial quote of two output units per input unit; screenshot balances and prices are **test data**, not current market observations.

The suite checks wallet errors and chain addition, live reads, strict amounts and slippage, quote invalidation and expiry, approval/reset/revocation flows, confirmation locking, simulation failures, runtime ABI verification, RPC fallback, and wallet account/chain races. Router transactions are independently decoded to check the recipient, actions, pool key, direction, native value, exact amounts, slippage minimum and deadline. No production ABI encoder is reused for these assertions.

At 1440, 768, 390 and 320 CSS pixels the suite checks document overflow, axe WCAG rules and keyboard activation of the connect and quote controls. It saves a connected quote review state with the confirmation button focused. This does not establish physical-device compatibility, native browser zoom, a complete Tab-order audit, screen-reader behavior or full accessibility compliance. Real wallet extensions, funded transaction execution, publication gateways and named entrypoints require separate validation.
