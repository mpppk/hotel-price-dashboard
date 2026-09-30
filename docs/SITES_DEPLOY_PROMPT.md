# ChatGPT Sites 初回デプロイ用指示

この文書は、GitHubのCIとコードレビュー済みの `main` を、**ChatGPT Sitesで初めてSite化するとき**の手順です。
Sitesは「保存バージョン作成」と「公開デプロイ」が別操作です。初回はバージョン保存までで止めます。

## ChatGPT Work / @Sites に渡す依頼文

```text
@Sites

GitHub の mpppk/hotel-price-dashboard リポジトリ（main の最新commit）を使って、
「一休 Price Observatory」の ChatGPT Site を新規作成してください。

前提:
- 既存の実装・docs/specification.md と openapi.yaml を優先してください。
- 現行のSitesランタイムとVinextとの互換性を確認し、必要なら最小限の修正を行ってください。
- D1 は Site 管理の binding「DB」にしてください。R2は不要です。
- drizzle/0000_init.sql を適用し、hotels と pricing_profiles の初期データを確認してください。
- D1のマイグレーション適用手段が見つからない場合は、その旨を報告し、
  破壊的な回避策や別DBを作らず、Site公開前に止めてください。
- 初回は「保存バージョン」を作るだけで、公開デプロイ・公開範囲変更はまだ行わないでください。
- サイト用Secret INGEST_TOKEN はユーザーがSite Settingsで登録します。
  トークン値を会話、GitHub、ファイル、URL、ログに入れないでください。
- 最後に、Site管理画面への導線、DB初期化結果、保存したバージョン、
  Secret登録後に必要なデプロイ操作を報告してください。
```

## Site作成後（オーナー作業）

1. ChatGPT の Sites一覧を開き、作成したSiteの **More actions > Settings** に移動する。
2. **Hosted Secret** として `INGEST_TOKEN` を追加する。32文字以上の暗号学的にランダムな値を推奨。トークンを会話に貼らない。
3. 保存済みバージョンを再デプロイして、Secretがランタイムに反映されたことを確認する。
4. 公開対象を確認する。外部の認証なしクローラからAPIにアクセスするには、Site公開設定が外部HTTPSアクセスを許可する必要がある。個人用ダッシュボードの公開範囲に注意する。
5. 取得した本番URLで次の読み取りテストを実行する。

```sh
SITE_URL=https://<your-site>.chatgpt.site npm run smoke:read
```

6. **実際の一休クローラが取得したデータ**を使って書き込み確認する。ダミー価格の投入は禁止（履歴が汚染されるため）。

```sh
SITE_URL=https://<your-site>.chatgpt.site \
INGEST_TOKEN=<set-locally-without-shell-history> \
SNAPSHOT_FILE=/absolute/path/to/actual-crawler-snapshot.json \
npm run smoke:ingest
```

上記 `INGEST_TOKEN` 表記は概念上のプレースホルダーです。実際はシェルの安全な方法で
トークンを環境に渡し、GitHubやシェル履歴に残さないでください。

7. ブラウザで価格カレンダーと価格履歴を確認する。

## 受け入れ条件

- D1にホテル1件、価格条件1件が存在する
- Secret未設定時はBearer認証に必ず失敗する
- 無効なトークンは401
- 正しいトークンと実クローラ出力で200 accepted
- 同一runId・同内容で200 already_processed
- calendar/historyに投入した日時・価格が表示される
- 不正runIdで既存履歴が変更できない
- 非公開プレビューと外部クローラの公開アクセスの違いを確認する

## API

- 取得サンプル: `README.md`
- クライアント契約: `openapi.yaml`
- スモークテスト: `scripts/smoke-test.mjs`
