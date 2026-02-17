// モニタ ROM は 16KiB 窓を前提に作成する。
const ROM_SIZE = 0x4000;

function textToBytes(text: string): number[] {
  return [...text].map((ch) => ch.charCodeAt(0));
}

// 起動メッセージと簡易 I/O ループだけを持つ最小ブート ROM。
export function createMonitorRom(): Uint8Array {
  const rom = new Uint8Array(ROM_SIZE);

  const code = [
    0x31, 0xff, 0x7f, // LD SP,0x7FFF
    0x3e, 0x40, // LD A,40h
    0xd3, 0x58, // OUT (58h),A
    0x3e, 0x80, // LD A,80h
    0xd3, 0x58, // OUT (58h),A
    0x21, 0x27, 0x00, // LD HL,bootmsg
    0xcd, 0x19, 0x00, // CALL print_string
    // main_loop:
    0x3e, 0xff, // LD A,FFh
    0xd3, 0x11, // OUT (11h),A
    0xdb, 0x10, // IN A,(10h)
    0x18, 0xf8, // JR main_loop
    // print_string:
    0x7e, // LD A,(HL)
    0xb7, // OR A
    0xc8, // RET Z
    0xd3, 0x5a, // OUT (5Ah),A
    0x23, // INC HL
    0x18, 0xf8 // JR print_string
  ];

  rom.set(code, 0x0000);

  const banner = textToBytes('PC-G815 COMPAT\r\nBASIC READY\r\n> ');
  rom.set([...banner, 0x00], 0x0027);

  return rom;
}
