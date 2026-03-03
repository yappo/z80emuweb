import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from '@z80emu/assembler-z80';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const asmDir = path.resolve(packageRoot, 'asm');
const kernelFile = path.resolve(asmDir, 'kernel.asm');
const outFile = path.resolve(packageRoot, 'src/generated/basic_firmware.ts');

const source = fs.readFileSync(kernelFile, 'utf8');

const result = assemble(source, {
  filename: kernelFile,
  addressRange: { start: 0x0000, end: 0xffff },
  includeResolver: (fromFilename, includePath) => {
    const baseDir = path.dirname(fromFilename);
    const resolved = path.resolve(baseDir, includePath);
    if (!resolved.startsWith(asmDir)) {
      return undefined;
    }
    if (!fs.existsSync(resolved)) {
      return undefined;
    }
    return {
      filename: resolved,
      source: fs.readFileSync(resolved, 'utf8')
    };
  }
});

if (!result.ok) {
  const detail = result.diagnostics.map((d) => `${d.file}:${d.line}:${d.column}: ${d.message}`).join('\n');
  throw new Error(`Z80 firmware assemble failed\n${detail}`);
}

const commands = [
  'NEW','LIST','RUN','PRINT','LET','INPUT','GOTO','GOSUB','RETURN','END','STOP','CONT','IF','CLS','REM','FOR','NEXT','DIM','DATA','READ','RESTORE','POKE','OUT','BEEP','WAIT','LOCATE','AUTO','BLOAD','BSAVE','FILES','HDCOPY','PAINT','CIRCLE','PASS','PIOSET','PIOPUT','SPOUT','SPINP','REPEAT','UNTIL','WHILE','WEND','LNINPUT','CLEAR','DELETE','ERASE','ON','RANDOMIZE','RENUM','USING','MON','OPEN','CLOSE','LOAD','SAVE','LFILES','LCOPY','KILL','CALL','GCURSOR','GPRINT','LINE','PSET','PRESET','ELSE','EMPTY'
];

const bytes = [...result.binary].map((b) => `0x${b.toString(16).padStart(2, '0')}`);
const chunks = [];
for (let i = 0; i < bytes.length; i += 16) {
  chunks.push(`  ${bytes.slice(i, i + 16).join(', ')}`);
}

const output = `// 自動生成: scripts/generate-firmware.mjs
// PC-G815 BASIC Z80 インタープリター ROM イメージ

export const BASIC_INTERPRETER_ENTRY = 0x${result.entry.toString(16).toUpperCase()};
export const BASIC_INTERPRETER_ROM_BANK = 0x0F;

export const BASIC_INTERPRETER_COMMANDS = ${JSON.stringify(commands)} as const;

export const BASIC_INTERPRETER_ROM_IMAGE = Uint8Array.from([\n${chunks.join(',\n')}\n]);
`;

fs.writeFileSync(outFile, output, 'utf8');
console.log(`Generated ${outFile} (${result.binary.length} bytes)`);
