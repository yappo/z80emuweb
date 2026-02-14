## タスク開発フロー（必須）
1. 優先順位は「AIが必要タスクを整理し順番に処理」が基本です。**ユーザから緊急依頼が来た場合は割り込みを最優先**し、元タスクは一時停止として扱います。
2. タスク開始前に、必ず「今回着手タスク1件」と「以降の残タスク（最大10件）」を提示し、ユーザ合意後に着手します。
3. 合意前にブランチは作りません。着手確定後に **1タスク = 1ブランチ = 1PR**（`codex/<topic>`）で進めます（例: `git checkout -b codex/fix-mergepos-missing-d`）。
4. タスクの内容を実装し、実装後のローカル確認は最低限以下を実行します。
   - `cmake --build build -j`
   - `ctest --test-dir build --output-on-failure`
   - 必要に応じて不具合再現/修正確認コマンド（CLI/HTTPなど）を実行して正常に動作することを確認する
5. コミットメッセージは `type: summary` 形式（英語・命令形）を必須とします。`type` は `fix|refactor|test|docs|chore`。例: `fix: validate required -d option in mergepos`
6. PRは `gh` コマンドで作成し、本文は次のテンプレートを必須とします。
   - `gh pr create --base master --head <branch> --title \"<title>\" --body-file <file>`
