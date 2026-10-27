# Render Free + Neon Free

2026-10-27。実験用の単一APIプロセス構成。公開URL・実配置結果は[進捗報告書](PROGRESS.md)を正本とする。

## 構成

- iPhone → RenderのHTTPS API → Neon PostgreSQL。iPhoneへDB接続URLやVAULT_KEYを渡さない。
- GitHubはNaokiMatsumoto05、RenderはMy Workspace。PocketForge専用のリソースを使う。
- NeonはPocketForge組織のFreeプラン。既存の別サービス用Launch組織とは分離。
- RenderはFree、Singapore、Node 24.16.0。Buildは`npm ci --include=dev && npm run build:web`、Startは`npm start`。Health Checkは`/api/health`。
- 環境変数の正本はRenderの設定画面。リポジトリには実値を置かない。[設定項目](../.env.render.example)を参照。
- Render Freeのファイルは休止や再配置で消えるため、SQLiteへのフォールバックは起動時に拒否する。

## データベース

`DATABASE_URL`にはNeonのpooled接続URLを設定する。`VAULT_KEY`は32バイトを64桁の16進文字列にして固定し、安全に別途保管する。DBを復元するときも同じ鍵が必要。

初回起動で`apps/api/migrations/001_initial.sql`をトランザクション内で適用する。PostgreSQLの証明書検証を常時有効にし、接続プールは最大3本。Macの既存SQLiteは自動転送・削除しない。

新規登録は停止する。初期ユーザーは、MacでDB接続設定と`BOOTSTRAP_NAME`・`BOOTSTRAP_PASSWORD`を安全に渡して`npm run account:create`で作る。この管理操作は実行中ジョブの復旧処理を行わない。

## iPhone

1. 接続先欄には実際に発行されたRender HTTPS URLのルートを入力する。`/api`やExpoのURLは付けない。
2. 「接続先を確認」を押し、接続成功後にPocketForgeのユーザー名・パスワードでログインする。
3. Free環境は起動に約1分かかる場合がある。最新版は接続待ちを最大2分に延長。以前のJSの場合はDevelopment BuildをMetroから再読み込みする。
4. まず手動でファイルを作成・保存し、再読み込みして残ることを確認する。その後AIキー・モデルIDをアプリの設定へ登録する。
5. AIへ小さなファイル生成を依頼し、実ファイル・履歴を確認する。E2Bはこの実機確認後に検証する。

Development BuildはMetroが必要。Macなしでの受入試験はPreview Buildで別途行う。

## 運用上の範囲

Free環境は常時稼働を保証しない。起動待ちで失敗した書き込みを自動再送しない。サーバー停止時に実行中だったジョブは再起動後に失敗と記録し、各AIツールラウンドの保存済み変更は残す。

ジョブ排他は単一プロセス内。AI作業中の手動デプロイは避ける。ローリング更新中の新旧プロセスや複数台をまたぐジョブ実行は未対応で、本番運用にはDB上のジョブリース・キューが必要。

[Render Free](https://render.com/docs/free) / [Render環境変数](https://render.com/docs/configure-environment-variables) / [Neon料金](https://neon.com/pricing)
