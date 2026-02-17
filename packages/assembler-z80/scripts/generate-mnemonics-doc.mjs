import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Z80_MNEMONICS } from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const docPath = path.resolve(repoRoot, 'docs/z80-assembly-mnemonics.md');

const content = readFileSync(docPath, 'utf8');
const missing = Z80_MNEMONICS.filter((mnemonic) => !content.includes(`### \`${mnemonic}\``));

if (missing.length > 0) {
  console.error(`Missing mnemonic sections in ${docPath}: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Mnemonic reference validated: ${docPath} (${Z80_MNEMONICS.length} entries)`);
