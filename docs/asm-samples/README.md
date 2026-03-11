# ASM Samples

## DOOM-like wireframe maze demo

- File: `doom-like-demo.asm`
- Target: PC-G815 emulator (Assembler tab)
- Style: 144x32 dot-graphics wireframe maze animation (auto-play)
- Engine: 10x10 maze-map + autonomous camera + occlusion-aware corridor renderer

### How to run

1. Open the Web app and switch to `ASSEMBLER` tab.
2. Click `3D Sample` (or paste `doom-like-demo.asm` manually).
3. Click `ASSEMBLE`, then `RUN`.

### Notes

- Rendering is generated every frame from an 8x8 maze map, not pre-rendered playback.
- The renderer draws continuous left/right corridor walls first, then only the nearest visible side opening on each side.
- Side walls get depth seams to read as tiled dungeon walls without showing hidden geometry behind a nearer opening.
- Only dirty raw LCD bytes are flushed each frame through `OUT` to `0x54/0x56` and `0x58/0x5A`.
- The camera picks its path autonomously, always starting on an open cell and facing a traversable next step.
