import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { assemble } from './assembler.js';

interface CliOptions {
  input?: string;
  output?: string;
  lst?: string;
  sym?: string;
  dumpFile?: string;
  format?: 'summary' | 'dump';
}

function printUsage(): void {
  console.log('Usage: z80asm -i <input.asm> [-o out.bin] [--lst out.lst] [--sym out.sym] [--dump out.txt] [--format dump]');
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = { format: 'summary' };
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i] ?? '';
    const next = args[i + 1];
    switch (token) {
      case '-i':
      case '--input':
        opts.input = next;
        i += 1;
        break;
      case '-o':
      case '--output':
        opts.output = next;
        i += 1;
        break;
      case '--lst':
        opts.lst = next;
        i += 1;
        break;
      case '--sym':
        opts.sym = next;
        i += 1;
        break;
      case '--dump':
        opts.dumpFile = next;
        i += 1;
        break;
      case '--format':
        if (next === 'dump' || next === 'summary') {
          opts.format = next;
          i += 1;
        }
        break;
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);
      default:
        break;
    }
  }
  return opts;
}

function defaultOutputPaths(input: string): { bin: string; lst: string; sym: string; dump: string } {
  const base = path.basename(input, path.extname(input));
  const outDir = path.resolve(process.cwd(), 'dist');
  return {
    bin: path.join(outDir, `${base}.bin`),
    lst: path.join(outDir, `${base}.lst`),
    sym: path.join(outDir, `${base}.sym`),
    dump: path.join(outDir, `${base}.dump.txt`)
  };
}

function ensureParent(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
}

function resolveInclude(fromFile: string, includePath: string): { filename: string; source: string } | undefined {
  const baseDir = path.dirname(fromFile);
  const resolvedPath = path.resolve(baseDir, includePath);
  try {
    return {
      filename: resolvedPath,
      source: readFileSync(resolvedPath, 'utf8')
    };
  } catch {
    return undefined;
  }
}

export function runCli(argv: string[]): number {
  const opts = parseArgs(argv);
  if (!opts.input) {
    printUsage();
    return 1;
  }

  const inputPath = path.resolve(process.cwd(), opts.input);
  let source = '';
  try {
    source = readFileSync(inputPath, 'utf8');
  } catch (error) {
    console.error(`Failed to read input: ${inputPath}`);
    if (error instanceof Error) {
      console.error(error.message);
    }
    return 1;
  }

  const defaults = defaultOutputPaths(inputPath);
  const outputBin = path.resolve(process.cwd(), opts.output ?? defaults.bin);
  const outputLst = path.resolve(process.cwd(), opts.lst ?? defaults.lst);
  const outputSym = path.resolve(process.cwd(), opts.sym ?? defaults.sym);
  const outputDump = path.resolve(process.cwd(), opts.dumpFile ?? defaults.dump);

  const result = assemble(source, {
    filename: inputPath,
    includeResolver: resolveInclude
  });

  if (!result.ok) {
    for (const diag of result.diagnostics) {
      console.error(`${diag.file}:${diag.line}:${diag.column}: ${diag.message}`);
    }
    return 1;
  }

  ensureParent(outputBin);
  writeFileSync(outputBin, result.binary);

  ensureParent(outputLst);
  writeFileSync(outputLst, result.lst, 'utf8');

  ensureParent(outputSym);
  writeFileSync(outputSym, result.sym, 'utf8');

  ensureParent(outputDump);
  writeFileSync(outputDump, result.dump, 'utf8');

  if (opts.format === 'dump') {
    console.log(result.dump);
  } else {
    console.log(`Assembled ${inputPath}`);
    console.log(`  BIN: ${outputBin} (${result.binary.length} bytes)`);
    console.log(`  LST: ${outputLst}`);
    console.log(`  SYM: ${outputSym}`);
    console.log(`  DUMP: ${outputDump}`);
    console.log(`  ORG: ${result.origin.toString(16).toUpperCase().padStart(4, '0')}`);
    console.log(`  ENTRY: ${result.entry.toString(16).toUpperCase().padStart(4, '0')}`);
  }

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = runCli(process.argv.slice(2));
  process.exit(code);
}
