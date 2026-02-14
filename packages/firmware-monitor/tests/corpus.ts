import fs from 'node:fs';
import path from 'node:path';

import type { BasicCommandSpec, BasicObservationCase } from '../src/types';

export interface BasicManifestDocument {
  version: number;
  profile: string;
  policyRef: string;
  commands: BasicCommandSpec[];
}

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCS_ROOT = path.resolve(REPO_ROOT, 'docs');

export function loadManifest(): BasicManifestDocument {
  const filePath = path.resolve(DOCS_ROOT, 'basic-command-manifest.json');
  const source = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(source) as BasicManifestDocument;
}

export function loadObservationCases(): BasicObservationCase[] {
  const corpusDir = path.resolve(DOCS_ROOT, 'basic-observation-corpus');
  const fileNames = fs
    .readdirSync(corpusDir)
    .filter((name) => name.endsWith('.yaml'))
    .sort((a, b) => a.localeCompare(b));

  const cases: BasicObservationCase[] = [];

  for (const fileName of fileNames) {
    const filePath = path.resolve(corpusDir, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(source) as { cases?: BasicObservationCase[] } | BasicObservationCase;

    if (Array.isArray((parsed as { cases?: BasicObservationCase[] }).cases)) {
      cases.push(...((parsed as { cases: BasicObservationCase[] }).cases ?? []));
      continue;
    }

    cases.push(parsed as BasicObservationCase);
  }

  return cases;
}
