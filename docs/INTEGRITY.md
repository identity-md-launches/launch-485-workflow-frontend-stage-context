# Deployment integrity and read-only chain evidence

The frontend retains the supplied deployment and network handoffs in
`web/deployment/`. They are build inputs only. The running app loads the exported
`imd-deployment.json` and its referenced ABI; the retained snapshots are not an
independent runtime address or RPC map.

## Pinned implementation ABI

The LaunchToken ABI was obtained with:

```sh
git show 23af8cd4b30a896759c1fae5beeb7a5ca20aeea2:docs/abi/LaunchToken.json
```

Its bytes are retained at `web/deployment/abi/LaunchToken.json` and copied unchanged
to `dist/abi/LaunchToken.json`. JSON objects are recursively sorted by key, arrays
retain their order, the resulting compact JSON is encoded as UTF-8, and its Keccak-256
is calculated using viem. The verified canonical hash is:

```text
38880b8e56d42ce900f744a7908c7139632a49f1c3f33385c64ceaed29d37bee
```

This matches the supplied handoff. `prepare.mjs` and `verify.mjs` also compare the
retained ABI's exact bytes against the pinned Git object whenever that source
commit is available. A source ZIP without Git history can rebuild from the retained
ABI and its handoff-bound canonical hash. When the original `.imd/reads` files are
present, the scripts check the retained handoff snapshots against their exact bytes.

The generated pool data includes only fee, tick spacing, paired currency, and
contract names. It is derived from the supplied pool manifest before Vite compiles.
The attested project has one token and no hook; the preparation script fails if that
contract set changes, so another launch cannot silently reuse this pool derivation.

## Export checks

From `web/`, run:

```sh
npm run build
node scripts/verify.mjs
node scripts/test-integrity.mjs
node scripts/check-rpc.mjs
```

The build validates inputs and prepares pool data before Vite, then copies ABIs and
generates `dist/imd-deployment.json` after Vite has written the final static files.
Every other exported file is enumerated and bound to its final bytes with lowercase
SHA-256. The manifest excludes itself. Export verification checks:

- The exact allowed top-level keys, version, launch ID, chain ID, source commit,
  attestation hash, and complete name/address/ABI-hash contract set.
- Unchanged supplied network and wallet-add-chain objects.
- ABI canonical hashes, raw pinned ABI bytes, and pool derivation.
- A complete unique inventory, matching SHA-256 values, `index.html`, and every ABI.
- Relative safe paths, no symlinks, at most 128 assets, at most 8 MiB per file,
  and an export below 24 MiB to leave room under the HTTP response budget.
- No root-relative `src` or `href` in the exported HTML.

On 2026-09-29, all **10 integrity tests passed**. These include a valid export and
negative cases for an added router key, omitted asset, changed asset, changed ABI
with an updated SHA-256, changed vetted network, path traversal, excessive inventory,
and an exported symlink. Canonicalization is also checked for object-key stability
and preserved array order. Test fixtures go only into disposable `test/scratch/`.

The 8 MiB Git submission limit is separate from the HTTP export limit. Dependencies,
package-manager caches, and transient test output are excluded; selected validation
evidence is retained under docs/. Source,
lockfile, runtime assets, ABI, and manifest remain included. Final archive size and
browser/build results are recorded in the frontend validation documentation.

## Live RPC reads

`node scripts/check-rpc.mjs` completed at **2026-09-29T22:23:29.081Z**. All three
configured public endpoints returned chain ID **11155111** and block **11810492**:

| Supplied RPC endpoint | Chain and code reads | Duration |
| --- | --- | --- |
| `https://ethereum-sepolia-rpc.publicnode.com` | Passed | 1,055 ms |
| `https://rpc.sepolia.ethpandaops.io` | Passed | 718 ms |
| `https://sepolia.rpc.sentio.xyz` | Passed | 1,703 ms |

At that block, all three endpoints returned the following nonempty contract code:

| Contract from supplied configuration | Code bytes |
| --- | ---: |
| LaunchToken | 1,709 |
| Uniswap PoolManager | 24,009 |
| Uniswap Universal Router | 19,540 |
| Uniswap Quoter | 5,820 |
| Uniswap StateView | 3,531 |
| Uniswap PositionManager | 23,877 |
| Permit2 | 9,152 |

All three also returned `name() = Great Family`, `symbol() = GFAM`, `decimals() = 18`,
and `totalSupply() = 1000000000000000000000000000` minor units, or
1,000,000,000 GFAM. The script reads addresses and RPC URLs from the retained supplied
configuration, and pins contract-code and token-state reads to the observed block.

These are worker-side read observations, not publication certification. They do not
prove liquidity, executable swaps, or future RPC availability. No real approvals,
transfers, swaps, or other transactions were signed or broadcast for validation.
Wallet signing and settlement behavior are validated with mocks and remain untested
with real funds. Immutable-CID hosting, named-entrypoint checks, and control-plane
publication checks happen after this worker submission and are not claimed here.
