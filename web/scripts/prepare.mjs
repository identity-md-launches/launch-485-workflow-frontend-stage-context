import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { derivePool, loadInputs, webRoot } from './integrity.mjs';

const { handoff, contracts, pinnedCommitAvailable } = loadInputs();
mkdirSync(resolve(webRoot, 'src/generated'), { recursive: true });
writeFileSync(resolve(webRoot, 'src/generated/pool.json'), `${JSON.stringify(derivePool(handoff), null, 2)}\n`);
console.log(`Validated ${contracts.length} implementation-derived ABI; pinned Git bytes ${pinnedCommitAvailable ? 'verified' : 'unavailable, canonical attested hash verified'}.`);
