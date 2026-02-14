import { describe, expect, it } from 'vitest';

import { loadManifest, loadObservationCases } from './corpus';

describe('basic command manifest', () => {
  it('keeps LOCKED commands implemented with positive/negative coverage', () => {
    const manifest = loadManifest();
    const cases = loadObservationCases();
    const caseIds = new Set(cases.map((entry) => entry.id));

    expect(manifest.commands.length).toBeGreaterThan(0);

    for (const command of manifest.commands) {
      expect(command.keyword.length).toBeGreaterThan(0);
      expect(command.evidence.length).toBeGreaterThan(0);

      if (command.status === 'LOCKED') {
        expect(command.implemented).toBe(true);
        expect(command.positiveCaseIds.length).toBeGreaterThan(0);
        expect(command.negativeCaseIds.length).toBeGreaterThan(0);

        for (const caseId of command.positiveCaseIds) {
          expect(caseIds.has(caseId)).toBe(true);
        }
        for (const caseId of command.negativeCaseIds) {
          expect(caseIds.has(caseId)).toBe(true);
        }
      }

      if (command.status === 'TBD') {
        expect(command.implemented).toBe(false);
      }
    }
  });

  it('has at least one TBD command to track strict-compatibility backlog', () => {
    const manifest = loadManifest();
    expect(manifest.commands.some((entry) => entry.status === 'TBD')).toBe(true);
  });
});
