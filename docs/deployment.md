# ChatGPT Sites への導入

## 前提

- ChatGPT Sitesの作成・バージョン保存ができるアカウント
- 外部クローラがHTTPS POSTを発行できること
- Node 22.13+ / npm（ローカル検証）

## 手順

1. PRをマージ後、ChatGPT Work/CodexからこのリポジトリをSites互換のローカルプロジェクトとして取り込む。
2. \`.openai/hosting.json\` の \`d1: "DB"\` を維持して新しいSiteを作成する。既存の \`project_id\` はありません。Site生成時に書き込まれます。
3. SitesのD1を追加する。\`drizzle/0000_init.sql\` と \`drizzle/meta/_journal.json\` がホストビルドに同梱されること、およびマイグレーション成功を確認する。**価格送信の前にseed 2件が反映されていることを確認する。**
4. 32文字以上のランダムな値を生成し、Sitesの **Hosted Secret** に \`INGEST_TOKEN\` として保存する（公開環境変数ではなくSecret）。
5. サイトはまずバージョン保存し、API/画面をプレビューする。ローカルクローラから呼べる公開Siteとして提供する場合、公開範囲を明示的に設定する。**Saved versionは公開デプロイではありません。**
6. 初回デプロイ後に \`GET /api/v1/health\` を確認し、\`POST /api/v1/ingest/snapshots\` に1宿泊日のテストデータを送る。ダッシュボードのカレンダーを確認する。
7. クローラを日次で実行し、今後12か月の各日の最安価格をJSONで一括送信する。

### セキュリティと公開範囲

公開SiteのGET APIは誰でも参照できます。POSTはBearer tokenが必須です。CORSは認証を代替しません。TokenをブラウザJS、GitHub、URLパラメータ、ログに出さないでください。

Sitesの公開設定がAPIにも適用される場合、private Siteではヘッドレスなクローラが送信できない可能性があります。**本番稼働前に外部端末から認証付きPOSTが届くことを確認してください。** 通信経路が確保できない場合、取得JSONの手動インポートや別の認証付きAPIホスト構成を検討します。

### 動作確認

- 認証なしPOST → 401
- 正しいトークンとペイロード → 200 / accepted
- 同じrunId + 同じペイロード → 200 / already_processed（観測数は増えない）
- 同じrunId + 異なるペイロード → 409
- summary / calendar / history が同じ観測を参照
- 36時間更新なしで鮮度警告
- 公開URLからリードAPIは閲覧可、任意SQL endpointは存在しない

API仕様: \`openapi.yaml\`。
