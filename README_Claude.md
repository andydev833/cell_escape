# CELL / ESCAPE — Claudeへの引き継ぎ

これは初版MVPの既存ソースコードです。
天井プレス、安全な最初の3歩などの変更は、まだコードに反映されていません。

1. このフォルダを既存プロジェクトとして開いてください。
2. CELL_ESCAPE_Claude_Spec_v0.4.md を読んで変更を実装してください。
3. 基本UIを維持し、ステージ1だけを変更してください。

## 構成
- dist/index.html: 画面
- dist/style.css: スタイル
- dist/app.js: 描画・入力・演出
- dist/engine.js: ゲームルール
- tests/engine.test.mjs: 既存テスト（旧仕様のため設計書に合わせて変更）
- docs/UI_UX.md: 旧MVPの仕様。変更時はv0.4の設計書を優先
- .openai/hosting.json: 既存サイトの識別子と公開設定

## ローカル確認
ビルドと依存ライブラリのインストールは不要です。
プロジェクトのルートで次を実行すると dist を配信できます。

python3 -m http.server 8000 --directory dist

ブラウザーで http://localhost:8000/ を開いてください。
index.htmlをfile://で直接開く方法では、JavaScriptモジュールが読み込めない場合があります。

テスト: npm test
構文確認: npm run check

既存サイトを編集する場合はホスティングの識別子・アクセス権を維持してください。
Gitの履歴、認証情報、デプロイ用アーカイブはこのZIPに含めていません。
