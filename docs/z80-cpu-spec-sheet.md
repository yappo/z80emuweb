# Z80 CPU スペックシート（本リポジトリ実装ベース）

この文書は `packages/core-z80/src/z80-cpu.ts` を一次情報として整理した、
実装理解向けの Z80 CPU スペックシートです。

- 目的: 実装を読み解くために、命令・レジスタ・バス・割り込みを人間向けに整理する
- 記載方針: 著作物の引用ではなく、本実装の事実と一般的な用語で説明する
- 対象: 現在このリポジトリで実装済みの Z80 命令セット

## 1. CPU コア概要

`Z80Cpu` は **T-state 単位のマイクロオペレーションキュー**で命令を進行させます。

- `stepTState(count)`
  - `queue` が空なら `scheduleNextInstruction()` で次命令をデコード
  - 1 T-state ごとに `queue` 先頭の処理を 1 つ実行
- 命令フェッチ
  - `enqueueFetchOpcode()` で `bus.read8(PC)` を実行
  - `onM1?(pc)` コールバックを発火
  - `R` レジスタ下位 7bit をインクリメント
- 予約/未定義 opcode
  - 現在は各 opcode 空間で例外なくデコードされる
  - 予約/未定義のものは NOP 相当として継続

## 2. レジスタ仕様

### 2.1 8bit レジスタ

- 汎用: `A, B, C, D, E, H, L`
- 特殊: `F`（フラグ）, `I`（割り込みベクタ上位）, `R`（リフレッシュ）

### 2.2 16bit レジスタ対

- `AF, BC, DE, HL`
- インデックス: `IX, IY`
- `SP`（スタックポインタ）, `PC`（プログラムカウンタ）

### 2.3 フラグレジスタ `F`

ビット定義（`packages/core-z80/src/flags.ts`）:

- `S=0x80`: 符号
- `Z=0x40`: ゼロ
- `Y=0x20`: コピー用補助ビット
- `H=0x10`: ハーフキャリー
- `X=0x08`: コピー用補助ビット
- `PV=0x04`: パリティ/オーバーフロー
- `N=0x02`: 減算フラグ
- `C=0x01`: キャリー

## 3. バス・入出力仕様

### 3.1 メモリ/IO バスインターフェース

`Bus` インターフェース:

- `read8(addr)` / `write8(addr, value)`
- `in8(port)` / `out8(port, value)`
- `onM1?(pc)`（命令フェッチ境界通知）

### 3.2 アドレス幅

- メモリアドレス: 16bit（`0x0000-0xFFFF`）
- I/O ポート: 8bit（`0x00-0xFF`）

### 3.3 入出力命令

- `IN A,(n)`
  - 即値 `n` で指定したポートから 1 バイト読んで `A` に格納
- `OUT (n),A`
  - `A` の 1 バイトを即値 `n` のポートへ出力

## 4. 割り込み仕様

### 4.1 外部割り込み入力

- `raiseNmi()`
  - NMI 保留を立てる
- `raiseInt(dataBus=0xFF)`
  - maskable INT 保留を立て、データバス値を保持

### 4.2 優先順位と受理条件

`scheduleNextInstruction()` での優先順位:

1. NMI
2. INT（`IFF1=true` かつ EI 遅延が解けている）
3. HALT 継続
4. 通常命令フェッチ

### 4.3 IFF と EI/DI

- `DI`: `IFF1=0`, `IFF2=0`
- `EI`: `IFF1=1`, `IFF2=1`, ただし **次の 1 命令完了まで INT 受理を遅延**

### 4.4 割り込みモード `IM`

- `IM 0`: `PC = dataBus & 0x38`
- `IM 1`: `PC = 0x0038`
- `IM 2`: `(I:dataBus)`（偶数化）で 16bit ベクタを参照

### 4.5 RETN / RETI 実装差

- `RETN`: `PC` 復帰に加えて `IFF1 <- IFF2`
- `RETI`: 現状実装では `RET` 同等（`PC` 復帰のみ）

## 5. アドレッシングとプレフィクス

### 5.1 主なオペランド形式

- `n`: 8bit 即値
- `nn`: 16bit 即値（リトルエンディアン）
- `e`: 8bit 符号付き相対オフセット
- `(HL)`: `HL` が指すメモリ
- `(IX+d)`, `(IY+d)`: インデックス + 8bit 符号付き変位

### 5.2 プレフィクス

- `DD`: 後続命令の `HL/H/L` を `IX/IXH/IXL` として解釈
- `FD`: 後続命令の `HL/H/L` を `IY/IYH/IYL` として解釈
- `CB`: ビット操作/ローテート命令群
- `ED`: 拡張命令群

## 6. 命令体系（章別）

## 6.1 データ転送命令

| 命令 | オペランド | 説明 |
|---|---|---|
| `LD r,n` | `r=B/C/D/E/H/L/A` | 8bit 即値をレジスタへ代入 |
| `LD (HL),n` | `n` | 即値を `HL` 間接メモリへ書込 |
| `LD (IX+d),n` / `LD (IY+d),n` | `d,n` | インデックス間接先へ即値を書込 |
| `LD BC,nn` / `LD DE,nn` / `LD HL,nn` / `LD IX,nn` / `LD IY,nn` / `LD SP,nn` | `nn` | 16bit 即値をレジスタ対へ代入 |
| `LD A,(nn)` | `nn` | 絶対アドレスの 1 バイトを `A` に読込 |
| `LD (nn),A` | `nn` | `A` を絶対アドレスへ書込 |
| `LD A,(BC)` / `LD A,(DE)` | - | レジスタ対間接先を `A` に読込 |
| `LD (BC),A` / `LD (DE),A` | - | `A` をレジスタ対間接先へ書込 |
| `LD A,(HL)` / `LD A,(IX+d)` / `LD A,(IY+d)` | - | 間接先メモリを `A` に読込 |
| `LD (HL),A` / `LD (IX+d),A` / `LD (IY+d),A` | - | `A` を間接先メモリへ書込 |
| `LD r,r'` | `r,r'=A/B/C/D/E/H/L/(HL)/(IX+d)/(IY+d)` | 8bit レジスタ/間接先どうしの転送 |
| `LD (nn),HL/IX/IY` / `LD HL/IX/IY,(nn)` | `nn` | 16bit レジスタ対を絶対アドレスと相互転送 |
| `LD A,I` / `LD A,R` | - | 特殊レジスタから `A` へコピー |
| `LD I,A` / `LD R,A` | - | `A` から特殊レジスタへコピー |

## 6.2 算術・比較命令

| 命令 | オペランド | 説明 |
|---|---|---|
| `INC r` / `DEC r` | `r` | 8bit レジスタを ±1 |
| `INC (HL)` / `DEC (HL)` | - | `HL` 間接先の 1 バイトを ±1 |
| `INC (IX+d)` / `DEC (IX+d)` | `d` | インデックス間接先を ±1 |
| `INC HL/IX/IY` / `DEC HL/IX/IY` | - | 16bit レジスタ対を ±1 |
| `INC BC/DE/SP` / `DEC BC/DE/SP` | - | 16bit レジスタ対を ±1 |
| `ADD HL,rr` / `ADD IX,rr` / `ADD IY,rr` | `rr=BC/DE/HL(or IX/IY)/SP` | 16bit 加算 |
| `ADD A,n` | `n` | `A+n` |
| `ADC A,n` | `n` | `A+n+C` |
| `SUB n` | `n` | `A-n` |
| `SBC A,n` | `n` | `A-n-C` |
| `CP n` | `n` | `A-n` を比較用途で実行（`A` は不変） |
| `ADD/ADC/SUB/SBC/AND/XOR/OR/CP r` | `r=A/B/C/D/E/H/L/(HL)/(IX+d)/(IY+d)` | A レジスタ対象 ALU 演算 |
| `NEG` | - | `A <- 0-A` |

## 6.3 論理命令

| 命令 | 説明 |
|---|---|
| `XOR A` | `A` を 0 にし、対応フラグを更新 |
| `OR A` | `A` は維持し、`A OR A` 相当でフラグを更新 |
| `AND n` / `XOR n` / `OR n` | 即値論理演算 |

## 6.4 分岐・サブルーチン命令

| 命令 | 条件 | 説明 |
|---|---|---|
| `JR e` | 無条件 | 相対ジャンプ |
| `DJNZ e` | `B!=0` | `B` をデクリメントして非 0 なら相対ジャンプ |
| `JR NZ,e` / `JR Z,e` / `JR NC,e` / `JR C,e` | `Z/C` | 条件付き相対ジャンプ |
| `JP nn` | 無条件 | 絶対ジャンプ |
| `JP (HL)` / `JP (IX)` / `JP (IY)` | 無条件 | レジスタ対値へ間接ジャンプ |
| `JP NZ,nn` / `JP Z,nn` / `JP NC,nn` / `JP C,nn` | `Z/C` | 条件付き絶対ジャンプ |
| `CALL nn` | 無条件 | 復帰先をスタックへ積んで分岐 |
| `CALL NZ,nn` / `CALL Z,nn` / `CALL NC,nn` / `CALL C,nn` | `Z/C` | 条件付きサブルーチン呼び出し |
| `RET` | 無条件 | スタックから復帰先 `PC` を復元 |
| `RET NZ` / `RET Z` / `RET NC` / `RET C` | `Z/C` | 条件付き復帰 |
| `RST p` | 無条件 | 固定ベクタへ分岐（`p=00,08,10,18,20,28,30,38h`） |

## 6.5 スタック・交換命令

| 命令 | 説明 |
|---|---|
| `PUSH BC/DE/HL/IX/IY/AF` | レジスタ対 16bit 値をスタックへ退避 |
| `POP BC/DE/HL/IX/IY/AF` | スタック先頭 16bit 値をレジスタ対へ復元 |
| `EX DE,HL`（`DD/FD` 時は `EX DE,IX/IY` 相当） | 2 つの 16bit レジスタ対の値を交換 |
| `EX (SP),HL/IX/IY` | スタックトップ 16bit 値と対象レジスタ対を交換 |
| `EX AF,AF'` / `EXX` | 主レジスタ群とシャドウレジスタ群を交換 |

## 6.6 ビット操作・ローテート命令（CB 系）

`CB` プレフィクスで実装されている範囲:

| 種別 | 形式 | 実装範囲 |
|---|---|---|
| `BIT` | `BIT b,target` | `b=0..7`, `target=r/(HL)/(IX+d)/(IY+d)` 全対応 |
| `RES` | `RES b,target` | 同上 |
| `SET` | `SET b,target` | 同上 |
| `RLC` | `RLC target` | `target=r/(HL)/(IX+d)/(IY+d)` |
| `RL` | `RL target` | `target=r/(HL)/(IX+d)/(IY+d)` |
| `RRC/RR/SLA/SRA/SLL/SRL` | `target=r/(HL)/(IX+d)/(IY+d)` | 全対応 |

## 6.7 ブロック転送命令

| 命令 | 説明 |
|---|---|
| `LDI/LDD/LDIR/LDDR` | ブロック転送（前進/後退、単発/反復） |
| `CPI/CPD/CPIR/CPDR` | ブロック比較 |
| `INI/IND/INIR/INDR` | ブロック入力 |
| `OUTI/OUTD/OTIR/OTDR` | ブロック出力 |

実装では `BC != 0` の間、`PC` を命令先頭へ巻き戻して再実行します。

## 6.8 制御命令

| 命令 | 説明 |
|---|---|
| `NOP` | 何も変更しない |
| `HALT` | 割り込み発生まで停止 |
| `RLCA/RRCA/RLA/RRA` | A レジスタの回転 |
| `DAA/CPL/SCF/CCF` | BCD 補正・補数・キャリーフラグ制御 |
| `DI` | マスク可能割り込みを無効化 |
| `EI` | マスク可能割り込みを有効化（1 命令遅延あり） |
| `IM 0/1/2` | 割り込みモード設定 |
| `RETN` | 割り込み復帰 + `IFF1 <- IFF2` |
| `RETI` | 現状実装は `RET` と同等 |

## 7. フラグ更新の要点

実装上の主なルール:

- `INC/DEC`
  - `C` は保持
  - `H`, `PV`, `S`, `Z`, `X`, `Y` を結果と境界条件で更新
- `ADD/ADC/SUB/SBC/CP`
  - `H`, `PV`, `C` を補助関数で正確に算出
- `BIT`
  - `C` は保持
  - `H=1` を立てる
- `RLC/RL/RRC/RR/SLA/SRA/SLL/SRL`
  - 回転結果で `S/Z/PV/X/Y` を更新し、搬出ビットを `C` へ

## 8. 割り込み・バスと命令実行の関係

- `HALT` 中でも NMI/INT は監視され、受理時に HALT を解除
- 命令フェッチ（M1 相当）ごとに `onM1` コールバックが呼ばれる
- `IN/OUT` は CPU コアがポート番号を 8bit に正規化してバスへ渡す
- `raiseInt(dataBus)` の `dataBus` は IM0/IM2 でベクタ決定に利用される

## 9. 未実装命令の現況（2026-02-14時点）

`strictUnsupportedOpcodes=true` で全空間（base/CB/ED/DD/FD/DDCB/FDCB）を走査しても
`Unsupported opcode` は発生しません。

今回の拡張で以下を追加し、予約/未定義 opcode は NOP 相当として扱う実装に整理しました。

- ベース空間:
  - `LD r,r'` 群
  - `ADD/ADC/SUB/SBC/AND/XOR/OR/CP r,(HL),(IX+d),(IY+d)` 群
  - `DJNZ`, `EXX`, `EX AF,AF'`, `EX (SP),HL/IX/IY`, `JP (HL/IX/IY)`, `LD SP,HL/IX/IY`
  - `RLCA/RRCA/RLA/RRA`, `DAA/CPL/SCF/CCF`
- CB 空間:
  - `RRC`, `RR`, `SLA`, `SRA`, `SLL`, `SRL`（`r/(HL)/(IX+d)/(IY+d)`）
- ED 空間:
  - `IN r,(C)`, `OUT (C),r`
  - `ADC HL,rr`, `SBC HL,rr`
  - `LD (nn),rr`, `LD rr,(nn)`
  - `IM 0/1/2`
  - `RRD/RLD`
  - `LDI/LDD/LDIR/LDDR`
  - `CPI/CPD/CPIR/CPDR`
  - `INI/IND/INIR/INDR`
  - `OUTI/OUTD/OTIR/OTDR`

注:
- 「予約/未定義 opcode が存在しない」という意味ではなく、
  CPU 実装上はそれらも実行可能（NOP 相当）として扱う、という意味です。

## 10. 参照ファイル

- CPU 実装: `packages/core-z80/src/z80-cpu.ts`
- フラグ定義: `packages/core-z80/src/flags.ts`
- 型定義: `packages/core-z80/src/types.ts`
- マシン側 I/O 利用例: `packages/machine-pcg815/src/machine.ts`
