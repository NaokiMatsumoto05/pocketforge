# iPhoneからAIに開発を指示する実機試験

2026-10-25時点。**実機試験は未完了です。** この手順は実施済みの証拠ではありません。結果は正本の[進捗報告書](PROGRESS.md)へ追記します。

## 現在の準備状況

- OpenAI / Anthropic / Grok / Geminiの接続実装を点検済み。AIキー・モデルIDはまだ未登録。
- Expoのログインを確認し、[PocketForgeのEASプロジェクト](https://expo.dev/accounts/matsumoto-naoki/projects/pocketforge)を作成・連携済み。
- `development`は開発クライアント、`preview`はJSをアプリへ同梱する実機用の内部配布。署名済みIPAはまだ作成していない。
- 現在のMacはXcode 15.3。Expo SDK 58が要求するXcode 26.4以降を満たさないため、EASクラウドビルドを使う。対象iPhoneはiOS 16.4以上。
- 現在のSDKはApp Store版Expo Goでは動かない。SDKを下げずDevelopment Buildを使用する。
- HTTPSバックエンドの公開先・Apple Developerの準備・実際のiPhone操作は確認待ち。
- Expo上には既存のAppleチームとiPhone4台・iPad1台の登録を確認した。ただし今回の対象端末、会員資格の現在の有効性、新アプリ用の署名は未確認。端末識別子は報告書へ記載しない。
- Development Build開始はソースのExpo/EAS送信に対する明示的承認が必要として自動承認レビューで停止。署名・ビルドの検証には進んでいない。

## 1. まず1社だけAIを登録

PocketForgeを開き「接続・設定」から、利用する会社のAPIキーと、そのアカウントで利用可能なツール呼び出し対応モデルIDを登録します。キーはチャットへ貼らず、アプリに入力してください。4社すべてを揃える必要はありません。

| 表示               | 実際の接続先                                                | 設定                        |
| ------------------ | ----------------------------------------------------------- | --------------------------- |
| OpenAI             | `https://api.openai.com/v1/responses`                       | OpenAI APIキー・モデルID    |
| Claude / Anthropic | `https://api.anthropic.com/v1/messages`                     | Anthropic APIキー・モデルID |
| Grok               | `https://api.x.ai/v1/responses`                             | xAI APIキー・モデルID       |
| Gemini             | `https://generativelanguage.googleapis.com/v1/interactions` | Google AI APIキー・モデルID |

登録先はユーザーごと・バックエンドごとに分かれます。ローカルに登録したキーは、新しく公開するサーバーには自動移行されません。公開サーバーにログイン後、同じ設定画面で登録します。現状の実装は上記キー名を環境変数へ設定するだけでは登録されません。

管理者が先に実接続を確認するときは、ルートの `.env.iphone-test.example` を `.env.iphone-test` にコピーし、検証用アカウントの名前・パスワード・接続先を設定して実行します。

```sh
chmod 600 .env.iphone-test
npm run test:live-ai
```

スクリプトは登録済みの1社を選び、専用プロジェクトを作って「短い応答 → ファイル生成 → 編集 → 再ログイン後の読み出し → 履歴 → ZIP内の内容」を確認します。AI利用料金が発生し得ます。検証プロジェクトは証拠として残します。結果は `work/live-ai-result.json`（既定では作業フォルダー直下のwork）へ保存し、**PCのHTTPテスト**と明記します。iPhone実機試験の代わりにはしません。

## 2. HTTPSバックエンド

[HTTPS構成手順](HTTPS_SETUP.md)に従ってバックエンドを用意します。iPhoneの `localhost` はiPhone自身を指すため使えません。

- 接続先は証明書が有効な `https://...` のオリジンだけ。`/api`、クエリ、ログイン情報をURLに付けない。
- アプリ起動後、ログイン画面にURLを入力して「接続先を確認」を押す。
- 既存アカウントでログイン。本番環境は通常、新規登録を停止する。
- 接続先を変更すると端末内セッションを消す。セッションはiOS SecureStoreへ、APIキーはバックエンドの暗号化ストアへ保存する。
- `EXPO_PUBLIC_API_URL` は公開情報であるURLの既定値にだけ使う。APIキー・Expoトークン・VAULT_KEYを `EXPO_PUBLIC_*` に入れない。

## 3. Development Buildを作る

以下は運用・開発担当者向けです。ユーザー本人のApple Developer Program加入、署名用Appleアカウント、利用するiPhoneの登録が必要です。認証情報は各サービスの公式ログイン画面で入力します。

このプロジェクトはモノレポです。ルートで `npm run eas -- ...` を使うと、作業ディレクトリーを `apps/mobile`、送信ルートをPocketForge全体へ固定します。CLIは検証した25.3.0に固定しています。

```sh
# 設定を確認（クラウドビルドは開始しない）
npm run eas -- config --platform ios --profile development --non-interactive
# 端末登録用リンクをiPhoneで開き登録
npm run eas -- device:create
# 署名を設定し、開発クライアントをビルド
npm run eas -- build --platform ios --profile development
# ビルドのインストールURLを登録済みiPhoneで開く
# 開発時のみMacでMetroを起動
npm run mobile
```

必要な場合、iPhoneの設定でデベロッパモードを有効にします。開発クライアントからMetroへ接続し、HTTPSバックエンドURLでログインします。MetroへのLAN接続とバックエンドへのHTTPS接続は別物です。Metroへ接続できても、バックエンド接続を確認できたことにはなりません。

開発ビルドで基本操作を確認したら、次を実行してJS同梱版を作ります。

```sh
npm run eas -- build --platform ios --profile preview
```

**iPhoneだけで使う受入試験にはPreview Buildを使用**します。インストール後はMetroを停止し、iPhoneのWi-Fiを切ってモバイル通信でも試します。バックエンドは常時稼働が必要です。API URLはログイン画面で指定できるため、未決定の仮URLをビルドへ埋め込む必要はありません。

## 4. 実機での合格条件

新規プロジェクト「iPhone実機確認」をiPhoneから作り、選んだAIを使います。「コマンド実行」はオフのままにします。AIのファイル編集だけならE2Bは不要です。

| 手順       | 操作・指示                                                                                                             | 確認する証拠                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 接続       | 「ファイルを変更せず、接続できました、とだけ返答してください」                                                         | 実際のモデルから返答、ジョブ完了       |
| 生成       | 「src/iphone-check.tsを作り、export const deviceCheck = 'iPhone'; と書いて保存してください。他は変更しないでください」 | コード画面にファイルと内容が表示される |
| 編集       | 「src/iphone-check.tsを読んで、文字列をiPhoneからiPhone verifiedに変更して保存してください」                           | 内容変更、revision増加、履歴差分       |
| 永続保存   | アプリ終了 → 再起動 → 同じプロジェクトを開く                                                                           | 編集後の内容が残る                     |
| 単独利用   | MacのMetroを停止、iPhoneをモバイル通信に切り替えて再度編集                                                             | HTTPS接続、再編集・保存が成功          |
| キーボード | コードを手動編集、別タブへ切り替えて戻る                                                                               | 入力欄が隠れず、自動保存・下書きが保持 |

結果には、端末名・iOSバージョン・Development/PreviewのビルドID・通信回線・プロバイダー/モデル・プロジェクトID・前後のrevision・確認日時を記録します。キーや認証トークンは記録しません。未実施・失敗はそのまま記録します。

## 5. iPhoneのAI編集が確認できた後にE2B

1. 同じ公開サーバーの設定画面でE2Bキーを登録する。
2. テスト用プロジェクトでクラウド環境を起動する。利用料金が発生し得るため、画面の説明・確認に従う。
3. ターミナルで `node --version`、`python3 --version` を確認する。
4. `node -e "require('fs').writeFileSync('src/e2b-check.txt','E2B verified\\n')"` を実行する。
5. コード画面で同ファイルを確認し、履歴・保存を確認する。
6. クラウドを一時停止 → 再起動し、`cat src/e2b-check.txt` とコード画面の内容を確認する。
7. テスト後は一時停止する。環境ID・起動/停止結果・ファイル同期・エラーを報告書へ追記する。

E2Bは今回まだ実接続していません。通信制限やテンプレートの互換性は、実際に起動した環境で別途確認が必要です。

## 参照した公式資料

- [Expo GoとSDKの互換性](https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/)
- [Expo SDK 58の要件](https://docs.expo.dev/versions/v58.0.0/)
- [EASビルド設定](https://docs.expo.dev/build/eas-json/)
- [EASの環境変数](https://docs.expo.dev/eas/environment-variables/)
- [EASの送信除外設定](https://docs.expo.dev/build-reference/easignore/)
- [E2B Sandbox](https://docs.e2b.dev/sandbox)
