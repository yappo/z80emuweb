// Z80 の F レジスタで使うビット定義。
export const FLAG_S = 0x80;
export const FLAG_Z = 0x40;
export const FLAG_Y = 0x20;
export const FLAG_H = 0x10;
export const FLAG_X = 0x08;
export const FLAG_PV = 0x04;
export const FLAG_N = 0x02;
export const FLAG_C = 0x01;

// 8bit 値のパリティ (1 の数が偶数か) を返す。
export function parity8(value: number): boolean {
  let bits = value & 0xff;
  let count = 0;
  for (let i = 0; i < 8; i += 1) {
    count += bits & 1;
    bits >>= 1;
  }
  return (count % 2) === 0;
}
