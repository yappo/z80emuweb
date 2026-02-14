# z80emu（PC-G815互換）

PC-G815相当の体験を目指した、ブラウザ動作のZ80エミュレータです。

## クイックスタート

```bash
npm install
npm run dev
```

## ワークスペース構成

- `apps/web`: ViteベースのWebアプリ（Canvas2D UI）
- `packages/core-z80`: T-state単位で進むZ80コア
- `packages/machine-pcg815`: マシン層（メモリマップ、LCD、キーボード）
- `packages/firmware-monitor`: モニタ + 小規模BASICランタイム
- `docs/hardware-spec.md`: ハード仕様前提とマッピング

## ハードウェアマップ方針

- ハードウェアマップと根拠定義は次に集約しています。
  - `packages/machine-pcg815/src/hardware-map.ts`
  - `packages/machine-pcg815/src/hardware-evidence.ts`
- テーブルは `CONFIRMED` / `DERIVED` / `HYPOTHESIS` の信頼度付きで管理し、`validateHardwareMap()` でテスト検証します。

## スクリプト

- `npm run build`
- `npm run test`
- `npm run test:compat`
- `npm run test:e2e`
- `npm run dev`

## 実行時フラグ

- 既定値: `strict=0`（通常利用向けの安全起動）
- デバッグ厳格モード: `?debug=1&strict=1`
- 例: `http://127.0.0.1:5173/?debug=1&strict=1`

## LCD無表示の切り分け

1. ヘッダーの `BOOT STATUS` が `READY` になっているか確認する
2. `FAILED` / `STALLED` の場合は画面内デバッグ情報（`pc`, `tstates`）を確認する
3. `npm run test:e2e` を実行し、点灯ピクセル検証とランタイム例外捕捉が通るか確認する

## BASIC厳密互換トラック（ROM非使用）

- ポリシー: `docs/basic-observation-policy.md`
- マニフェスト: `docs/basic-command-manifest.json`
- 観測コーパス: `docs/basic-observation-corpus/*.yaml`
- 実装基準: `packages/firmware-monitor/src/runtime.ts`

回帰確認は次で実行します。

```bash
npm run test:compat
```

## GitHub Pages

1. `main` へ push する
2. リポジトリ設定で Pages のソースに GitHub Actions を指定する
3. `Deploy Pages` ワークフローが `apps/web/dist` を静的サイトとして公開する

公開URL:

- <https://yappo.github.io/z80emuweb/?debug=1>
