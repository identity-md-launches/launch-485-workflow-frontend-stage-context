import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { distRoot, listExportFiles, loadInputs, snapshotRoot, verifyExport } from './integrity.mjs';

const { handoff, contracts, networkConfig } = loadInputs();
mkdirSync(resolve(distRoot, 'abi'), { recursive: true });
for (const contract of contracts) {
  copyFileSync(resolve(snapshotRoot, contract.abiPath), resolve(distRoot, contract.abiPath));
}
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets: listExportFiles().filter((file) => file.path !== 'imd-deployment.json').map(({ path, sha256 }) => ({ path, sha256 })),
  ...(networkConfig ? { network: networkConfig.network } : {}),
  ...(networkConfig?.walletAddChain ? { walletAddChain: networkConfig.walletAddChain } : {}),
};
writeFileSync(resolve(distRoot, 'imd-deployment.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(verifyExport(), null, 2));
