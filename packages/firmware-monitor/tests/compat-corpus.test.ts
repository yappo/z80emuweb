import { describe, expect, it } from 'vitest';

import { PcG815BasicRuntime } from '../src/runtime';
import { loadManifest, loadObservationCases } from './corpus';

function drain(runtime: PcG815BasicRuntime): string {
  const chars: string[] = [];
  for (let i = 0; i < 25_000; i += 1) {
    const code = runtime.popOutputChar();
    if (code === 0) {
      break;
    }
    chars.push(String.fromCharCode(code));
  }
  return chars.join('');
}

describe('observation corpus compatibility', () => {
  const manifest = loadManifest();
  const cases = loadObservationCases().filter((entry) => entry.profile === manifest.profile);

  it('has observation cases bound to current profile', () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const scenario of cases) {
    it(`matches case ${scenario.id}`, () => {
      const runtime = new PcG815BasicRuntime({
        commandSpecs: manifest.commands,
        defaultProfileId: manifest.profile
      });

      runtime.loadObservationProfile(scenario.profile);
      for (const line of scenario.lines) {
        runtime.executeLine(line);
      }

      const output = drain(runtime);
      const expected = scenario.expect;

      for (const token of expected.outputContains ?? []) {
        expect(output).toContain(token);
      }

      for (const token of expected.outputNotContains ?? []) {
        expect(output).not.toContain(token);
      }

      for (const token of expected.errorContains ?? []) {
        expect(output).toContain(token);
      }

      for (const [name, value] of Object.entries(expected.variables ?? {})) {
        expect(runtime.getVariables().get(name)).toBe(value);
      }
    });
  }
});
