## タスク開発フロー（必須）
1. 優先順位は「AIが必要タスクを整理し順番に処理」が基本です。**ユーザから緊急依頼が来た場合は割り込みを最優先**し、元タスクは一時停止として扱います。
2. タスク開始前に、必ず「今回着手タスク1件」と「以降の残タスク（最大10件）」を提示し、ユーザ合意後に着手します。
   - 今後必要になるタスクを全て先読みで洗い出して、全て提示してください。タスク完了後に後出しで追加タスクを提示しないよう努力してください。
3. 合意前にブランチは作りません。
   - git commit が必要なタスクの場合は、着手確定後に **1タスク = 1ブランチ = 1PR**（`codex/<topic>`）で進めます（例: `git checkout -b codex/fix-mergepos-missing-d`）。
   - タスクの内容が調査のみでコードやファイルの変更や git commit が不要なタスクだと判断したら、ブランチ作成は不要です
4. タスクの内容を実装し、実装後のローカル確認は最低限以下を実行します。
   - test を必ず実施
   - 必要に応じて不具合再現/修正確認コマンドを実行して正常に動作することを確認する
5. コミットメッセージは `type: summary` 形式（英語・命令形）を必須とします。`type` は `fix|refactor|test|docs|chore`。例: `fix: validate required -d option in mergepos`
6. PRは `gh` コマンドで作成し、本文は次のテンプレートを必須とします。
   - `gh pr create --base master --head <branch> --title \"<title>\" --body-file <file>`
7. PR作成後は GitHub Actions の CI を確認し、**必須ジョブが全て成功してから** merge します。失敗していたら gh コマンドで CI のログを確認し原因を調査しコミットを再度行います (`gh run view <run-id> --log-failed`)
   - `gh pr checks <pr-number> --watch`
   - `gh pr merge <pr-number> --merge --delete-branch`
8. タスク完了後は次タスクへ自動遷移せず、再度「次タスク候補 + 残タスク（最大10件）」を提示してユーザ判断を待ちます。

