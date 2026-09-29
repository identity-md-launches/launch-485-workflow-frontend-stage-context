import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const packages = execFileSync('npm', ['ls', '--omit=dev', '--all', '--parseable'], { cwd: root, encoding: 'utf8' }).trim().split('\n').slice(1);
const sections = ['Third-party notices for the Great Family frontend.\nIncludes production dependencies; tree shaking can omit unused modules.'];
for (const directory of packages) {
  const info = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  if (info.name === 'typescript' || info.name.startsWith('@typescript/')) continue; // Build-time peers.
  const files = readdirSync(directory).filter(name => /^(licen[cs]e|copying)(\..*)?$/i.test(name));
  if (!files.length) throw new Error(`Missing license for ${info.name}`);
  sections.push(`${info.name} ${info.version}\n${'='.repeat(60)}\n${files.map(name => readFileSync(resolve(directory, name), 'utf8')).join('\n')}`);
}
writeFileSync(resolve(root, 'public/THIRD-PARTY-NOTICES.txt'), sections.join('\n\n') + '\n');
console.log('Generated static third-party notices.');
