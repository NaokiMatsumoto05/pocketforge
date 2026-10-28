# PocketForge

スマートフォンから、AI・コード・デザインを切り替えてExpoアプリをつくる開発スタジオ。

**実験用MVPです。[Render Free＋Neon Freeで公開中](https://pocketforge.onrender.com)です。**

[進捗報告書](docs/PROGRESS.md)に、指示された作業の対応内容・確認結果・残る課題を記録しています。作業完了ごとに追記します。

iPhone実機へ進む手順は[実接続・iPhone試験](docs/IPHONE_TEST.md)、Render＋Neonの設定は[無料枠セットアップ](docs/RENDER_NEON.md)、その他の公開サーバー構成は[HTTPSセットアップ](docs/HTTPS_SETUP.md)にまとめています。PocketForge本体をEASへ連携済みですが、ユーザーからiPhoneでの起動確認の報告を受けています。実AI応答・実機での編集はまだ未確認です。

## 動かせるもの

- アカウント登録・ログイン、ユーザーごとのプロジェクト分離
- Expo / React Native / TypeScriptプロジェクトの作成・永続保存
- ファイル編集・作成・名前変更・削除、フォルダ作成、プロジェクト内検索
- 自動保存、端末内の下書き復元、競合検出、インデント・括弧入力補助
- 対応コンポーネントのデザイン編集とReact Nativeソースへの反映
- 変更履歴、差分確認、ロールバック、ソースのZIPエクスポート
- OpenAI / Anthropic / Grok（xAI）/ Geminiのツール呼び出しエージェント接続
- E2Bの起動・一時停止、コマンド実行、ログ、ファイル同期、Git操作の接続
- EAS Buildの要求・状況照会・成果物リンク取得の接続

AI応答・E2B実行・アプリ内から要求するEASビルドは**接続コードを実装していますが、実サービスでの動作は未検証**です。PocketForge本体のEASプロジェクト連携は実施済みです。キー未設定の機能は未接続と表示します。組み込みデザインプレビューは対応スキーマの描画で、任意コードやネイティブ機能の実行環境ではありません。

## 開発版の起動

Node.js 24以降が必要です。以下はサービスの開発・運用担当者向けです。

```sh
npm ci
npm run build:web
npm run dev
```

- 通常の画面: http://localhost:4310
- スマートフォン幅の確認: http://localhost:4310/phone.html
- `npm run mobile`: Development Build用Expo開発サーバー
- `npm run eas -- ...`: PocketForgeのモノレポ全体を対象にEAS CLIを実行
- `npm run test:live-ai`: 登録済みAIの実応答・生成・編集・保存をHTTP経由で検証
- `npm run package:source`: 秘密情報・ローカルDBを除外したソースZIPを生成
- `npm run check`: 型チェックとAPIテスト

127.0.0.1限定で起動します。スマートフォンから遠隔利用するサービスの公開は、HTTPS環境の準備と承認が必要です。本アプリ利用者にPCでのコード操作を要求する設計ではありません。ネイティブ版ではログイン画面から接続先HTTPS URLを入力できます。

## 接続

AI画面でOpenAI・Claude・Grok・Geminiを選択できます。各サービスは個別に登録でき、全社のキーを揃える必要はありません。モデルIDは利用中のアカウントで使える、テキスト・ツール呼び出し対応モデルを指定します。

キーの発行: [OpenAI公式ガイド](https://developers.openai.com/api/docs/quickstart)、[Anthropic公式ガイド](https://platform.claude.com/docs/en/api/overview)、[Grok公式ガイド](https://docs.x.ai/developers/quickstart)、[Gemini公式ガイド](https://ai.google.dev/gemini-api/docs/api-key)。設定画面からも開けます。

「接続・設定」から各自のキーを入力します。キーはAES-256-GCMで暗号化され、プロジェクトのソースやエクスポートに含めません。

| 接続 | 必要な設定 | 動作 |
|---|---|---|
| OpenAI | APIキー、利用可能なモデルID | Responses API |
| Anthropic | APIキー、モデルID | Messages API |
| Grok（xAI） | APIキー、モデルID | Responses API |
| Gemini | APIキー、モデルID | Interactions API（v1） |
| E2B | APIキー、制限を設定したテンプレート | プロジェクト専用microVM |
| Expo | アクセストークン、project ID、アプリ識別子・署名 | EAS Build |

E2Bは既定で`base`テンプレート。Node.js、npm、Python3、git、GNU timeoutが必要です。本運用前にCPU・メモリ・ディスク制限を設定した専用テンプレートを用意し、`E2B_TEMPLATE`を指定してください。

EASでは`app.json`に`extra.eas.projectId`と`ios.bundleIdentifier` / `android.package`を設定します。`preview`プロファイルを使用。初回署名設定とiOSデバイス登録は未自動化です。現在のターミナルは非対話型のため、すべての初回手続きを完結できるわけではありません。

## 保存と復旧

`DATABASE_URL`を指定するとPostgreSQL（Neon）に保存します。未指定時のローカル保存先は`.data/`です。Renderでは`DATABASE_URL`と固定の`VAULT_KEY`が必須です。

- `pocketforge.sqlite`：ユーザー・セッション・全ソース・履歴・操作ログ
- `vault.key`：ローカル開発用暗号鍵。**DBと一緒に安全にバックアップしてください。**
- 下書き：端末内ストレージ。同じアカウント・同じAPIに接続すると、サーバー保存済みデータを別端末から開けます。
- Git履歴・依存パッケージ：E2Bの一時停止環境に保持。ソースのDB保存とは別です。

バックアップはAPIを停止してSQLite関連ファイルをまとめて保管するか、SQLiteのバックアップAPIを使用してください。配布ZIPに`.data`を含めません。

## 制限

UTF-8テキストのみ。1ファイル512KB、250ファイル、プロジェクト4MB、30プロジェクト/ユーザー、1000履歴・履歴総量64MB/プロジェクト。空フォルダは`.gitkeep`で保持します。

ターミナルは60秒上限で、PTYではありません。完了時にソースを同期。バックグラウンドプロセスの連続変更は自動保存しません。E2Bは10分で一時停止、同一ユーザーの稼働環境は最大1つです。

APIは単一プロセス用。SQLiteまたはPostgreSQLとメモリ内ジョブ排他制御を使用し、多台数構成には未対応です。PostgreSQLのファイル保存はトランザクションと行ロックで競合を防ぎます。ジョブキュー・独立プレビュー配信・オブジェクトストレージは今後の実装です。

詳細: [設計](docs/ARCHITECTURE.md) / [実装状況](docs/STATUS.md) / [検証記録](docs/VALIDATION.md)
