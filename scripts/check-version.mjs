// Verifies package.json and the plugin manifest agree on the version, and
// optionally that both match a given tag version (used by the release workflow).
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')).version;
const yaml = readFileSync('package/metadata/LoupedeckPackage.yaml', 'utf8');
const manifest = yaml.match(/^version:\s*(\S+)/m)?.[1];
const expected = process.argv[2];

const problems = [];
if (pkg !== manifest) problems.push(`package.json says ${pkg}, LoupedeckPackage.yaml says ${manifest}`);
if (expected && pkg !== expected) problems.push(`tag says ${expected}, package.json says ${pkg}`);

if (problems.length) {
  for (const p of problems) console.error(`version mismatch: ${p}`);
  process.exit(1);
}
console.log(`version ${pkg}`);
