# PC-G815互換ハードウェア仕様（根拠付きドラフト）

この文書は、初期版PC-G815互換実装における正本（Source of Truth）です。

## スコープと運用方針

- 対象: PC-G815相当のUX/挙動を目指すブラウザエミュレータ
- 方針: バランス型（PC-G815の直接言及 + 同系機の解析）
- 根拠と実装が矛盾した場合は、先にこの文書を更新する
- 信頼度定義:
  - `CONFIRMED`: PC-G815向けに明記、または複数系統で独立一致
  - `DERIVED`: 同系機（PC-G850/PC-E220系）と解析ノートから推定
  - `HYPOTHESIS`: 互換実装の仮置き
- ステータス定義:
  - `LOCKED`: 現在ビルドで安定採用
  - `TBD`: 実装済みだが暫定
- 機械可読テーブルは `packages/machine-pcg815/src/hardware-map.ts` に集約し、ロード時/テスト時に検証する

## 根拠インデックス

- `z88dk-platform-sharp-pc`: <https://github-wiki-see.page/m/z88dk/z88dk/wiki/Platform---Sharp-PC>
- `ashitani-g850-general`: <https://ashitani.jp/g850/docs/01_general_info.html>
- `akiyan-g850-tech`: <https://www.akiyan.com/pc-g850_technical_data>
- `pokecom-basic-samples`: <https://poke-com.jimdofree.com/basic-%E3%83%97%E3%83%AD%E3%82%B0%E3%83%A9%E3%83%A0/>
- `ver0-doc-index`: <https://ver0.sakura.ne.jp/doc/index.html>
- `ver0-root`: <https://ver0.sakura.ne.jp/>
- `ver0-js`: <https://ver0.sakura.ne.jp/js/index.html>
- `ver0-android`: <https://ver0.sakura.ne.jp/android/>
- `mame-pce220-metadata`: <https://data.spludlow.co.uk/mame/machine/pce220>
- `wikipedia-pce220`: <https://en.wikipedia.org/wiki/Sharp_PC-E220>

## CPU

- コア: Z80互換
- クロック: `3,579,545 Hz`
- 実行モデル: T-state単位の内部スケジューラ
- 割込み: IM0/IM1/IM2, NMI, IFF1/IFF2
- Web実行時既定値:
  - `strict=0`（既定）
  - `strict=1` で未対応opcodeを厳格例外化（デバッグ用途）
  - `debug=1` で状態診断パネル表示

## 表示

| 項目 | 値 | 信頼度 | 根拠 | ステータス | 備考 |
| --- | --- | --- | --- | --- | --- |
| ドット解像度 | `144 x 32` | `CONFIRMED` | `z88dk-platform-sharp-pc` | `LOCKED` | 互換ターゲットの基準 |
| 文字グリッド | `24 x 4` | `CONFIRMED` | `z88dk-platform-sharp-pc` | `LOCKED` | 96文字セル |
| グリフモデル | `5 x 7` | `CONFIRMED` | `z88dk-platform-sharp-pc` | `LOCKED` | `6 x 8` ピッチで描画 |
| フレームバッファモデル | 1bppモノクロ | `DERIVED` | `ver0-js`, `ver0-root` | `TBD` | LCD詳細解析の進展で更新される可能性あり |

## メモリ

| 開始 | 終了 | 領域 | 書込可否 | 信頼度 | 根拠 | ステータス | 備考 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `0x0000` | `0x7FFF` | メインRAM / 拡張窓 | Yes | `DERIVED` | `ashitani-g850-general`, `akiyan-g850-tech`, `mame-pce220-metadata` | `LOCKED` | `0x1B` bit2 で RAM bank0/1 を切替 |
| `0x8000` | `0xBFFF` | システムROM / 拡張窓 | No | `DERIVED` | `ashitani-g850-general`, `akiyan-g850-tech`, `mame-pce220-metadata` | `LOCKED` | `0x19` high3bit で EXROM bank0..7 を切替 |
| `0xC000` | `0xFFFF` | バンクROM窓 | No | `DERIVED` | `ashitani-g850-general`, `akiyan-g850-tech`, `mame-pce220-metadata` | `LOCKED` | `0x19` low4bit で banked ROM bank0..15 を切替 |

## I/O

| ポート | 方向 | 論理役割 | 信頼度 | 根拠 | ステータス | 備考 |
| --- | --- | --- | --- | --- | --- | --- |
| `0x10` | OUT | キーボード行選択 | `DERIVED` | `akiyan-g850-tech`, `ver0-doc-index`, `ver0-root` | `TBD` | アクティブロー行列スキャナ選択 |
| `0x11` | IN | キーボード行データ | `DERIVED` | `akiyan-g850-tech`, `ver0-doc-index`, `ver0-root` | `TBD` | 選択行のビット値を返す |
| `0x12` | IN | キーボードASCII FIFO | `HYPOTHESIS` | `ver0-js`, `ver0-root` | `TBD` | モニタランタイム用の互換補助FIFO |
| `0x19` | INOUT | ROM/EXROM バンク選択 | `DERIVED` | `akiyan-g850-tech`, `mame-pce220-metadata`, `wikipedia-pce220` | `LOCKED` | low4=banked ROM, high3=EXROM を切替 |
| `0x1B` | INOUT | 拡張RAMバンク制御 | `DERIVED` | `akiyan-g850-tech`, `mame-pce220-metadata`, `wikipedia-pce220` | `LOCKED` | bit2 で RAM bank0/1 を切替 |
| `0x1C` | OUT | ランタイム入力チャネル | `HYPOTHESIS` | `ver0-js`, `ver0-root` | `TBD` | エミュレータ補助チャネル |
| `0x1D` | IN | ランタイム出力チャネル | `HYPOTHESIS` | `ver0-js`, `ver0-root` | `TBD` | エミュレータ補助チャネル |
| `0x58` | OUT | LCDコマンド | `CONFIRMED` | `z88dk-platform-sharp-pc`, `pokecom-basic-samples` | `LOCKED` | コミュニティBASIC利用例で観測 |
| `0x5A` | OUT | LCDデータ | `CONFIRMED` | `z88dk-platform-sharp-pc`, `pokecom-basic-samples` | `LOCKED` | コミュニティBASIC利用例で観測 |
| `0x5B` | IN | LCDステータス | `DERIVED` | `ver0-doc-index`, `mame-pce220-metadata` | `TBD` | 互換向けステータス読み取り経路 |

## ワークエリア

| アドレス | 意味 | 信頼度 | 根拠 | ステータス | 備考 |
| --- | --- | --- | --- | --- | --- |
| `0x790D` | 表示開始/スクロール関連ワークエリア候補 | `DERIVED` | `akiyan-g850-tech`, `pokecom-basic-samples`, `ver0-doc-index` | `TBD` | 現行互換挙動: 下位5bitを垂直開始ラインオフセットとして適用 |

## 既知ギャップ

- 公式PC-G815サービスマニュアルは本リポジトリに同梱していない
- `0x10-0x1F` の複数制御ポートは強い根拠待ちのプレースホルダ
- LCDアイコンセグメントと独自記号は未だ実機厳密ではない

## BASIC互換ポリシー

- 正本ポリシー文書: `docs/basic-observation-policy.md`
- コマンドマニフェスト: `docs/basic-command-manifest.json`
- 観測コーパス: `docs/basic-observation-corpus/*.yaml`
- 実装アンカー: `packages/firmware-monitor/src/runtime.ts`

### 評価モデル

- 根拠重み:
  - 実機再現ログ: `5`
  - 解析資料: `4`
  - 独立エミュ一致: `3`
  - 単発/断片: `1`
- LOCKルール:
  - 最上位候補の重み付きスコアが `>= 7`
  - 最上位と次点のスコア差が `>= 2`
- 閾値未満の項目は `TBD` のまま維持し、完了宣言対象から除外

### CIモデル

- `npm run test:compat` で次を検証:
  - マニフェスト整合性
  - `LOCKED` コマンド実装カバレッジ
  - 観測コーパスとランタイム出力/変数の一致
- 日次監視ワークフローで回帰発生時に `counterexample` issue を起票

## LCD無表示の診断

1. アプリ内の起動ステータスが `READY` か確認する
2. `FAILED` / `STALLED` の場合は診断表示（`pc`, `tstates`）を確認する
3. E2Eスモーク（`npm run test:e2e`）で点灯ピクセルとランタイムエラー検証を行う
