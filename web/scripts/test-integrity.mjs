import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { abiHash, canonicalJson, listExportFiles, loadInputs, repoRoot, sha256, snapshotRoot, verifyExport } from './integrity.mjs';

const scratch = resolve(repoRoot, 'test/scratch');
mkdirSync(scratch, { recursive: true });
const { handoff, contracts, networkConfig } = loadInputs();
function fixture() {
  const root = mkdtempSync(resolve(scratch, 'manifest-'));
  mkdirSync(resolve(root, 'abi'));
  writeFileSync(resolve(root, 'index.html'), '<!doctype html><html><head><title>Integrity fixture</title></head><body></body></html>');
  for (const contract of contracts) copyFileSync(resolve(snapshotRoot, contract.abiPath), resolve(root, contract.abiPath));
  const manifest = {
    version: 1, launchId: handoff.launchId, chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit, attestationHash: handoff.attestationHash, contracts,
    assets: listExportFiles(root).map(({ path, sha256 }) => ({ path, sha256 })),
    network: networkConfig.network, walletAddChain: networkConfig.walletAddChain,
  };
  const save = () => writeFileSync(resolve(root, 'imd-deployment.json'), JSON.stringify(manifest));
  save();
  return { root, manifest, save };
}

test('accepts an exact, complete hash-bound export', () => {
  const { root } = fixture();
  assert.equal(verifyExport(root).ok, true);
});
test('canonical ABI hash ignores object-key order but binds array order', () => {
  assert.equal(canonicalJson({ z: 1, a: { b: 2, a: 1 } }), '{"a":{"a":1,"b":2},"z":1}');
  assert.equal(abiHash([{ name: 'a', type: 'function' }]), abiHash([{ type: 'function', name: 'a' }]));
  assert.notEqual(abiHash([{ name: 'a' }, { name: 'b' }]), abiHash([{ name: 'b' }, { name: 'a' }]));
});
test('rejects an extra deployment router key', () => {
  const { root, manifest, save } = fixture();
  manifest.router = networkConfig.network.uniswapV4.universalRouter;
  save();
  assert.throws(() => verifyExport(root), /missing or extra keys/);
});
test('rejects an export file missing from inventory', () => {
  const { root } = fixture();
  writeFileSync(resolve(root, 'unlisted.js'), 'window.changed=true;');
  assert.throws(() => verifyExport(root), /inventory is incomplete/);
});
test('rejects modified asset bytes', () => {
  const { root } = fixture();
  writeFileSync(resolve(root, 'index.html'), '<h1>tampered</h1>');
  assert.throws(() => verifyExport(root), /SHA-256 mismatch/);
});
test('rejects ABI modification even with an updated asset SHA-256', () => {
  const { root, manifest, save } = fixture();
  const abiPath = contracts[0].abiPath;
  const changed = JSON.parse(readFileSync(resolve(root, abiPath), 'utf8'));
  changed.push({ type: 'function', name: 'unattested', inputs: [], outputs: [], stateMutability: 'view' });
  const bytes = JSON.stringify(changed);
  writeFileSync(resolve(root, abiPath), bytes);
  manifest.assets.find((asset) => asset.path === abiPath).sha256 = sha256(bytes);
  save();
  assert.throws(() => verifyExport(root), /ABI hash mismatch/);
});
test('rejects changes to vetted network configuration', () => {
  const { root, manifest, save } = fixture();
  manifest.network = { ...manifest.network, chainId: 1 };
  save();
  assert.throws(() => verifyExport(root), /network differs/);
});
test('rejects path traversal', () => {
  const { root, manifest, save } = fixture();
  manifest.assets[0].path = '../private.json';
  save();
  assert.throws(() => verifyExport(root), /Invalid relative asset path/);
});
test('rejects more than 128 declared assets', () => {
  const { root, manifest, save } = fixture();
  manifest.assets = Array.from({ length: 129 }, (_, index) => ({ path: `${index}.js`, sha256: 'a'.repeat(64) }));
  save();
  assert.throws(() => verifyExport(root), /between 1 and 128/);
});
test('rejects a symlink in the static export', () => {
  const { root } = fixture();
  symlinkSync(resolve(snapshotRoot, 'deployment.json'), resolve(root, 'linked.json'));
  assert.throws(() => verifyExport(root), /must not contain symlink/);
});
