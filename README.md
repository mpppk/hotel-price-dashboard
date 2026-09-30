# 一休 Price Observatory

ザ・リッツ・カールトン日光の宿泊価格推移ダッシュボード。外部クローラが正規化した価格スナップショットを ChatGPT Sites に送信し、Sites D1 で履歴を管理します。

**状態:** 実装ブランチのMVP。Sitesへのホスト登録・Secrets設定・実データ送信・本番デプロイは別途必要です。

## 構成

- ChatGPT Sites: Vinext + Reactダッシュボード、WorkerのAPIエンドポイント
- Sites D1 binding: \`DB\`
- ローカルクローラ: 一休価格取得、各宿泊日の最安販売価格計算、正規化、認証付きPOST
- 任意SQL API・Apify・外部Cloudflare Workerは不使用

API契約は [openapi.yaml](./openapi.yaml)、設計書は [docs/specification.md](./docs/specification.md)、導入手順は [docs/deployment.md](./docs/deployment.md) を参照してください。

## ローカル開発・検証

Node.js 22.13以降が必要です。

\`\`\`sh
npm install
cp .env.example .dev.vars # 生成したランダムトークンに置換すること
npm test
npm run typecheck
npm run build
npm run dev
\`\`\`

ローカルDBはD1 binding \`DB\` を使います。マイグレーション \`drizzle/\` はSitesにパッケージングされます。ローカルD1にスキーマが未適用なら、利用環境のWrangler/Miniflareから \`drizzle/0000_init.sql\` を適用してください。

## API

\`\`\`http
POST /api/v1/ingest/snapshots
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
\`\`\`

サンプル:

\`\`\`sh
curl -fSs -X POST 'https://YOUR-SITE.chatgpt.site/api/v1/ingest/snapshots' \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{
    "schemaVersion":1,
    "runId":"manual-2026-09-30-001",
    "hotelId":"ritz-carlton-nikko",
    "pricingProfileId":"standard-2a-1r-1n",
    "observedAt":"2026-09-30T03:00:00Z",
    "observations":[{
      "stayDate":"2026-11-20",
      "available":true,
      "price":106000,
      "roomName":"男体山ビュー",
      "planName":"素泊まり",
      "sourceUrl":"https://www.ikyu.com/00002777/"
    }]
  }'
\`\`\`

同一 \`runId\`・同内容は \`already_processed\` で成功、異なる内容は409です。
データ取得方法は本リポジトリのスコープ外です。
