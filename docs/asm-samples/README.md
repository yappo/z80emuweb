# ASM Samples

## DOOM-like pseudo 3D maze demo

- File: `doom-like-demo.asm`
- Target: PC-G815 emulator (Assembler tab)
- Style: 24x4 text-cell pseudo 3D maze animation (auto-play)
- Engine: maze-map + fixed-route camera + lightweight raycast per column

### How to run

1. Open the Web app and switch to `ASSEMBLER` tab.
2. Click `3D Sample` (or paste `doom-like-demo.asm` manually).
3. Click `ASSEMBLE`, then `RUN`.

### Notes

- Rendering is generated every frame from an 8x8 maze map, not pre-rendered playback.
- Perspective uses characters from `0x80-0x9F`, plus `0xEE/0xEF` for diagonal corner hints.
- The camera follows a fixed route (`FWD` / `TURN_L` / `TURN_R`) and loops forever.
- LCD output uses ports `0x58` (command) and `0x5A` (data).
