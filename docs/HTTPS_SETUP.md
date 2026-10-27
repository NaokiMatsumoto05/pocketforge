# iPhone用HTTPSバックエンドの構成

本書と構成ファイルは準備済みです。公開サーバーでの起動・TLS証明書取得・iPhone疎通はまだ実施していません。このMacにはDockerがなく、Dockerイメージのビルドも未確認です。

## 構成

`iPhone → HTTPS:443 → Caddy → API:4310 → 永続SQLiteボリューム`

`compose.yaml` はAPIのポートをホストへ公開せず、Caddyだけを公開します。`TRUST_PROXY=1` はこの一段のプロキシ構成専用です。直接アクセス可能なサーバーで使用しないでください。別構成では信頼するプロキシを見直します。APIは本番時にHTTPS以外の要求を拒否します（機密情報を含まないhealthのみ監視用HTTP可）。

## 公開前に必要なもの

- Docker Composeが使えるサーバー、永続ディスク、利用するドメイン。
- ドメインのDNSがサーバーを向き、80/443が到達可能であること。
- 固定した64桁hexの `VAULT_KEY`。DBと暗号鍵はセットで安全にバックアップする。
- 本番用の新しいユーザー名・パスワード。ローカルの動作確認用アカウントやDBは公開環境へ持ち込まない。

Caddyの[自動HTTPS](https://caddyserver.com/docs/automatic-https)で証明書を取得します。自己署名証明書の警告を無視したり、iOSの通信保護を解除したりする構成にはしません。

## 管理者によるセットアップ

サーバー上でPocketForgeルートを作業ディレクトリーにします。`.env.server.example` を `.env.server` にコピーし、実際のドメイン・オリジン・暗号鍵を設定します。ファイルのパーミッションは600にしてください。秘密値をチャット、Git、ビルド資産へ含めないでください。

```sh
chmod 600 .env.server
docker compose --env-file .env.server build api
```

公開前にアカウントを作成します。以下はbash/zshで対話入力し、パスワードをコマンド引数・履歴へ書き込まない手順です。

```sh
read -r BOOTSTRAP_NAME
read -rs BOOTSTRAP_PASSWORD
export BOOTSTRAP_NAME BOOTSTRAP_PASSWORD
docker compose --env-file .env.server run --rm -e BOOTSTRAP_NAME -e BOOTSTRAP_PASSWORD api npm run account:create
unset BOOTSTRAP_NAME BOOTSTRAP_PASSWORD
docker compose --env-file .env.server up -d
```

`read`の順にユーザー名（2〜40文字）、パスワード（10〜128文字）を入力します。アカウント作成が失敗した場合は公開開始を止め、名前の重複や設定を確認します。新規登録は停止した状態です。AIキーはiPhoneからログイン後に「接続・設定」で登録します。

`https://実際のドメイン/api/health` が `service: pocketforge` と `mode: production` を返すこと、未ログインの `/api/projects` が401であることを確認します。iPhoneのログイン画面で同じオリジンを入力して接続確認します。

## 運用範囲と保存

- SQLite・ジョブ排他は単一APIプロセス用です。レプリカ数は1に固定します。
- `pocketforge_data` はプロジェクト・セッション・暗号化された接続キーを保持します。削除しないでください。`docker compose down -v` はデータを削除するため使わないでください。
- Caddyの証明書は専用ボリュームで保持します。
- 初回展開時に既存ローカルの `.data` はコピーしません。必要なプロジェクト移行は別途安全に実施します。
- Renderなどへ変更する場合も、HTTPS終端、信頼するプロキシ、永続ディスク、VAULT_KEY、新規登録停止、単一インスタンスを同様に設定します。SQLiteを一時ファイルシステムだけに置かないでください。
- `.dockerignore`・`.easignore`・配布ZIPから `.data*`、実値入り `.env*`、DB、暗号鍵を除外します。

公開先の選択、ドメイン、費用が未確定のため、今回はサーバー作成・有料契約・本番公開を実行していません。
