# Wireframe 3D Right-Branch Handover

Date: 2026-03-13
Branch: `codex/wireframe-asm-sample`

## Status

- User reports that the Web UI rendering is still visually wrong.
- In particular, the right-side branch / side corridor rendering is still not matching the user's expectation in the actual browser view.
- I repeatedly overfit tests instead of fixing the real rendering problem first. This handoff is meant to prevent that from happening again.

## User's Current Complaint

Latest concrete complaint:

- "なんも変わってない"
- The right-side branch still looks wrong in the actual Web UI.
- The user specifically pointed out a "hole" / missing wall feeling on the right-side branch area.
- The user's trust is low. Any next attempt should start from the actual rendered frame in the browser, not from synthetic assumptions.

## Files Modified In Current Worktree

- `apps/web/src/main.ts`
- `apps/web/src/asm-doom-like-repro.test.ts`
- `docs/asm-samples/doom-like-demo.asm`

## What Was Changed

### 1. ASM sample renderer changes

`apps/web/src/main.ts` and `docs/asm-samples/doom-like-demo.asm` were updated to:

- keep branch-length measurement stable by preserving `DE` around `IS_WALL_BC`
- store `BRANCH_LIMIT`
- draw branch corridor diagonals in `DRAW_LEFT_BRANCH_AT_DEPTH` / `DRAW_RIGHT_BRANCH_AT_DEPTH`
- remove the fake screen-edge closing wall for continuing branches

Important detail:

- The latest branch behavior is now "draw an outer wall only when `BRANCH_OUTER > 0`; do not draw a fake edge wall when `BRANCH_OUTER == 0`".
- This was intended to remove the visible "hole/closed box" artifact near the screen edge.

### 2. Test infrastructure changes

`apps/web/src/asm-doom-like-repro.test.ts` was heavily rewritten.

Key points:

- expected output is now built as raw 144x32 LCD VRAM bytes
- comparison is byte/bit level against `machine.createSnapshot().vram.text`
- expected line drawing was switched back to a TS integer raster that matches the asm line routine more closely than `Lcd144x32.drawLine`
- pinned scenes, forced scenes, and early autoplay frames were added for right-branch cases

## Verified Command Results At Time Of Handoff

These commands passed after the latest edits:

- `npm run test -w @z80emu/web -- src/asm-doom-like-repro.test.ts`
- `npm run test -w @z80emu/web`
- `npm run typecheck -w @z80emu/web`

Important caveat:

- Even though tests passed, the user says the actual Web rendering still looks wrong.
- This means the current tests are still not locking onto the exact failure the user sees.

## Root Problem With Current Approach

The failure mode is not "the code does nothing".
The failure mode is:

- tests are now raw-VRAM-based, which is better than before
- but the pinned / forced scenes still do not fully capture the exact browser frame the user is reacting to
- as a result, a change can pass tests and still be visually unacceptable

In short:

- the test harness improved
- the actual rendering issue is not yet solved

## Recommended Next Steps For The Next Agent

1. Reproduce the exact bad browser frame first.
   - Do not start from forced scenes.
   - Use the real autoplay frame / real camera state the user is pointing at.

2. Capture that exact frame as raw VRAM.
   - The next regression should be built from the actual bad frame, not inferred from current expected geometry.

3. Re-check the right branch geometry model in `DRAW_RIGHT_BRANCH_AT_DEPTH`.
   - Decide explicitly whether the branch is:
     - continuing beyond the visible depth
     - ending within visible depth
   - Then define which of these should be drawn:
     - branch jamb
     - branch ceiling line
     - branch floor line
     - branch back wall
     - outer side wall

4. Validate against the real Web output, not just test output.
   - The user's complaint is about the browser-visible result.

## Warning For Whoever Continues This

- Do not assume "tests pass" means the issue is fixed.
- Do not start by adding more synthetic scene cases.
- Start from the exact frame the user says is wrong and work backward into renderer logic.

