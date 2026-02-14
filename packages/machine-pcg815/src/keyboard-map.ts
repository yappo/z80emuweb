export interface KeyMapping {
  code: string;
  row: number;
  col: number;
  normal?: number;
  shifted?: number;
}

export const KEY_MAP: KeyMapping[] = [
  { code: 'ShiftLeft', row: 7, col: 0 },
  { code: 'ShiftRight', row: 7, col: 1 },
  { code: 'Enter', row: 7, col: 2, normal: 0x0d },
  { code: 'Backspace', row: 7, col: 3, normal: 0x08 },
  { code: 'Space', row: 7, col: 4, normal: 0x20 },
  { code: 'ArrowUp', row: 7, col: 5 },
  { code: 'ArrowDown', row: 7, col: 6 },
  { code: 'ArrowLeft', row: 7, col: 7 },

  { code: 'ArrowRight', row: 6, col: 0 },
  { code: 'Digit0', row: 6, col: 1, normal: 0x30, shifted: 0x29 },
  { code: 'Digit1', row: 6, col: 2, normal: 0x31, shifted: 0x21 },
  { code: 'Digit2', row: 6, col: 3, normal: 0x32, shifted: 0x40 },
  { code: 'Digit3', row: 6, col: 4, normal: 0x33, shifted: 0x23 },
  { code: 'Digit4', row: 6, col: 5, normal: 0x34, shifted: 0x24 },
  { code: 'Digit5', row: 6, col: 6, normal: 0x35, shifted: 0x25 },
  { code: 'Digit6', row: 6, col: 7, normal: 0x36, shifted: 0x5e },

  { code: 'Digit7', row: 5, col: 0, normal: 0x37, shifted: 0x26 },
  { code: 'Digit8', row: 5, col: 1, normal: 0x38, shifted: 0x2a },
  { code: 'Digit9', row: 5, col: 2, normal: 0x39, shifted: 0x28 },
  { code: 'Minus', row: 5, col: 3, normal: 0x2d, shifted: 0x5f },
  { code: 'Equal', row: 5, col: 4, normal: 0x3d, shifted: 0x2b },
  { code: 'Comma', row: 5, col: 5, normal: 0x2c, shifted: 0x3c },
  { code: 'Period', row: 5, col: 6, normal: 0x2e, shifted: 0x3e },
  { code: 'Slash', row: 5, col: 7, normal: 0x2f, shifted: 0x3f },

  { code: 'KeyA', row: 0, col: 0, normal: 0x41 },
  { code: 'KeyB', row: 0, col: 1, normal: 0x42 },
  { code: 'KeyC', row: 0, col: 2, normal: 0x43 },
  { code: 'KeyD', row: 0, col: 3, normal: 0x44 },
  { code: 'KeyE', row: 0, col: 4, normal: 0x45 },
  { code: 'KeyF', row: 0, col: 5, normal: 0x46 },
  { code: 'KeyG', row: 0, col: 6, normal: 0x47 },
  { code: 'KeyH', row: 0, col: 7, normal: 0x48 },

  { code: 'KeyI', row: 1, col: 0, normal: 0x49 },
  { code: 'KeyJ', row: 1, col: 1, normal: 0x4a },
  { code: 'KeyK', row: 1, col: 2, normal: 0x4b },
  { code: 'KeyL', row: 1, col: 3, normal: 0x4c },
  { code: 'KeyM', row: 1, col: 4, normal: 0x4d },
  { code: 'KeyN', row: 1, col: 5, normal: 0x4e },
  { code: 'KeyO', row: 1, col: 6, normal: 0x4f },
  { code: 'KeyP', row: 1, col: 7, normal: 0x50 },

  { code: 'KeyQ', row: 2, col: 0, normal: 0x51 },
  { code: 'KeyR', row: 2, col: 1, normal: 0x52 },
  { code: 'KeyS', row: 2, col: 2, normal: 0x53 },
  { code: 'KeyT', row: 2, col: 3, normal: 0x54 },
  { code: 'KeyU', row: 2, col: 4, normal: 0x55 },
  { code: 'KeyV', row: 2, col: 5, normal: 0x56 },
  { code: 'KeyW', row: 2, col: 6, normal: 0x57 },
  { code: 'KeyX', row: 2, col: 7, normal: 0x58 },

  { code: 'KeyY', row: 3, col: 0, normal: 0x59 },
  { code: 'KeyZ', row: 3, col: 1, normal: 0x5a },
  { code: 'Semicolon', row: 3, col: 2, normal: 0x3b, shifted: 0x3a },
  { code: 'Quote', row: 3, col: 3, normal: 0x27, shifted: 0x22 },
  { code: 'BracketLeft', row: 3, col: 4, normal: 0x5b, shifted: 0x7b },
  { code: 'BracketRight', row: 3, col: 5, normal: 0x5d, shifted: 0x7d },
  { code: 'Backslash', row: 3, col: 6, normal: 0x5c, shifted: 0x7c },
  { code: 'Backquote', row: 3, col: 7, normal: 0x60, shifted: 0x7e }
];

export const KEY_MAP_BY_CODE = new Map(KEY_MAP.map((entry) => [entry.code, entry]));
