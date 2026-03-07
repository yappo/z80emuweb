export {
  BASIC_INTERPRETER_ENTRY,
  BASIC_INTERPRETER_ROM_BANK,
  BASIC_INTERPRETER_ROM_IMAGE,
  BASIC_INTERPRETER_COMMANDS
} from './generated/basic_firmware';

export interface BasicInterpreterRomBundle {
  entry: number;
  romBank: number;
  image: Uint8Array;
  commands: readonly string[];
}

export function getBasicInterpreterRomBundle(): BasicInterpreterRomBundle {
  return {
    entry: BASIC_INTERPRETER_ENTRY,
    romBank: BASIC_INTERPRETER_ROM_BANK,
    image: BASIC_INTERPRETER_ROM_IMAGE,
    commands: BASIC_INTERPRETER_COMMANDS
  };
}

import {
  BASIC_INTERPRETER_COMMANDS,
  BASIC_INTERPRETER_ENTRY,
  BASIC_INTERPRETER_ROM_BANK,
  BASIC_INTERPRETER_ROM_IMAGE
} from './generated/basic_firmware';
