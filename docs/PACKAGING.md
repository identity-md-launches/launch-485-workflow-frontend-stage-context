# Submission packaging record

The frontend is delivered as ordinary source/export/evidence files. No dependency registry, package archive, cache, submodule or symlink is part of the candidate submission.

- Candidate changed/new files: **60**.
- Candidate raw file bytes: **1778058**.
- Entire existing tracked tree plus candidate raw file bytes: **2686343**, below the **8,388,608-byte** assignment limit with substantial metadata/compression headroom.
- Production export, including manifest: **625,854 bytes**; **8 assets** plus the manifest. Largest runtime file is about 545 kB.
- Tested manifest SHA-256: `112d81a73185dba0ee74745b0212df5b32523273d8d0afc0193dfa663acdc005`.

Inventory was checked with `git ls-files --others --exclude-standard`, `git diff --name-only`, and filesystem byte counts. Every candidate path is in `web/`, `dist/` or `docs/`. The only new dotfile is explicitly permitted `web/.gitignore`. Its basename patterns exclude dependency/cache/report directories at every nesting level. No tracked baseline file was modified; the deployed Solidity source, ABI source export, root build configuration, root ignore file and libraries are preserved.

The worker's build, tests and preview do not depend on `test/scratch/` as a delivered input. Temporary browser-tool output was removed. The production export contains source-derived runtime JS/CSS, the local font, favicon, license notices, pinned raw ABI and its complete generated manifest. No generated package tarballs or offline registry were retained.

## Git metadata limitation

The environment mounts `.git` read-only. The requested staging attempt, `git add -- web dist docs`, failed with `Unable to create .git/index.lock: Read-only file system`. No commit was created. An attempt to measure the existing history as a Git bundle was also blocked because this partial checkout needed to materialize a missing promisor object into the read-only object database.

The raw candidate and full-tree counts above are measured file payloads, **not a claim that a final Git bundle was produced**. The publisher must collect these files into its writable Git repository and measure its final submission bundle. The payload itself is well below the cap; no oversized dependency/cache artifacts are present. This filesystem limitation does not prevent delivery of the complete frontend source, lockfile, static export and validation evidence, and no permission escalation was requested.
