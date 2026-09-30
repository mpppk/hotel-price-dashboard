# 一休ホテル価格推移ダッシュボード 仕様書

## 1. 目的

一休.com のホテル料金を外部クローラで定期取得し、ChatGPT Sites 上の D1 に履歴として保存して、価格カレンダー・価格推移・月別最安値を可視化する。

MVP の対象ホテルは **ザ・リッツ・カールトン日光** とする。

## 2. システム構成

```text
┌───────────────────────────┐
│ 手元の一休クローラ        │
│                           │
│ 1. 一休から価格取得       │
│ 2. 宿泊日ごとの最安値算出 │
│ 3. JSONへ正規化           │
└─────────────┬─────────────┘
              │ HTTPS POST
              │ Authorization: Bearer ...
              ▼
┌──────────────────────────────────────┐
│ ChatGPT Site                         │
│                                      │
│ POST /api/v1/ingest/snapshots        │
│              │                       │
│              ▼                       │
│             D1                       │
│              │                       │
│   ┌──────────┼──────────────┐        │
│   ▼          ▼              ▼        │
│ summary   calendar       history     │
│ API       API            API         │
│   └──────────┼──────────────┘        │
│              ▼                       │
│       Dashboard UI                   │
└──────────────────────────────────────┘
```

Cloudflare Worker、Apify、外部DBは使用しない。

## 3. MVP対象

- ホテル: ザ・リッツ・カールトン日光
- 一休施設URL: https://www.ikyu.com/00002777/
- 取得期間: 今後12か月
- 取得頻度: 原則1日1回
- 価格条件:
  - 1泊
  - 大人2名
  - 子ども0名
  - 1室
  - 食事条件なし
  - 税込
  - ポイント即時利用前
  - 予約可能なプランの最安販売価格

## 4. Pricing Profile

価格条件の意味を履歴の途中で変えないため、`pricing_profile` を明示的に保持する。

初期 profile:

```text
id: standard-2a-1r-1n
adults: 2
children: 0
rooms: 1
nights: 1
meal: any
currency: JPY
taxIncluded: true
pointMode: before_instant_point_discount
aggregation: minimum_available_price
```

将来、朝食付き・ポイント適用後価格・人数違い等を追加する場合は、別 profile として追加する。

## 5. D1スキーマ

### hotels

```sql
CREATE TABLE hotels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

初期値:

```text
id: ritz-carlton-nikko
name: ザ・リッツ・カールトン日光
source_url: https://www.ikyu.com/00002777/
```

### pricing_profiles

```sql
CREATE TABLE pricing_profiles (
  id TEXT PRIMARY KEY,
  adults INTEGER NOT NULL,
  children INTEGER NOT NULL,
  rooms INTEGER NOT NULL,
  nights INTEGER NOT NULL,
  meal TEXT NOT NULL,
  point_mode TEXT NOT NULL,
  tax_included INTEGER NOT NULL,
  currency TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

### crawl_runs

1回のクローラ実行を表す。

```sql
CREATE TABLE crawl_runs (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  pricing_profile_id TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  crawler_version TEXT,
  observation_count INTEGER NOT NULL,
  FOREIGN KEY (hotel_id) REFERENCES hotels(id),
  FOREIGN KEY (pricing_profile_id) REFERENCES pricing_profiles(id)
);
```

`observed_at` は一休を観測した時刻、`ingested_at` は Sites API が受信・保存した時刻。価格推移には `observed_at` を使う。

### price_observations

```sql
CREATE TABLE price_observations (
  hotel_id TEXT NOT NULL,
  pricing_profile_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  stay_date TEXT NOT NULL,
  available INTEGER NOT NULL,
  price_jpy INTEGER,
  room_name TEXT,
  plan_name TEXT,
  source_url TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (
    hotel_id,
    pricing_profile_id,
    stay_date,
    run_id
  ),
  FOREIGN KEY (run_id) REFERENCES crawl_runs(id)
);
```

推奨インデックス:

```sql
CREATE INDEX idx_prices_date
ON price_observations (
  hotel_id,
  pricing_profile_id,
  stay_date,
  observed_at DESC
);

CREATE INDEX idx_prices_observed
ON price_observations (
  hotel_id,
  pricing_profile_id,
  observed_at DESC
);
```

## 6. Ingest API

### Endpoint

```http
POST /api/v1/ingest/snapshots
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

`INGEST_TOKEN` は ChatGPT Sites の Hosted Secret に保存する。

SQL文字列自体は受け付けず、用途限定のJSON APIとする。

### Payload

```json
{
  "schemaVersion": 1,
  "runId": "0199a9fc-0000-7000-8000-000000000000",
  "crawlerVersion": "1.2.0",
  "hotelId": "ritz-carlton-nikko",
  "pricingProfileId": "standard-2a-1r-1n",
  "observedAt": "2026-09-30T21:00:12Z",
  "observations": [
    {
      "stayDate": "2026-10-01",
      "available": true,
      "price": 106000,
      "roomName": "男体山ビュー",
      "planName": "素泊まり",
      "sourceUrl": "https://www.ikyu.com/00002777/"
    },
    {
      "stayDate": "2026-10-02",
      "available": false,
      "price": null,
      "roomName": null,
      "planName": null,
      "sourceUrl": "https://www.ikyu.com/00002777/"
    }
  ]
}
```

### Validation

- `schemaVersion` は `1`
- `hotelId` は登録済みホテルのみ
- `pricingProfileId` は登録済み profile のみ
- `runId` は必須
- `observedAt` は ISO 8601
- `stayDate` は `YYYY-MM-DD`
- `available` は boolean
- `available=true` の場合 `price` は正整数
- `available=false` の場合 `price=null` を許容
- 1リクエストの `observations` は最大400件
- 同一リクエスト内の `stayDate` 重複は禁止

## 7. 冪等性

クローラ側で `runId` を生成する。

同じ `runId` の再送は二重登録しない。

初回:

```json
{
  "runId": "abc",
  "status": "accepted",
  "observations": 365
}
```

同一内容の再送:

```json
{
  "runId": "abc",
  "status": "already_processed",
  "observations": 365
}
```

同じ `runId` で内容が異なる場合は `409 Conflict` とする。

## 8. 読み取りAPI

### Summary

```http
GET /api/v1/hotels/ritz-carlton-nikko/summary
```

レスポンス例:

```json
{
  "hotelId": "ritz-carlton-nikko",
  "pricingProfileId": "standard-2a-1r-1n",
  "currentMinimum": 88000,
  "currentMinimumStayDate": "2027-02-03",
  "availableDays": 321,
  "coveredDays": 365,
  "lastObservedAt": "2026-09-30T21:00:12Z"
}
```

### Calendar

```http
GET /api/v1/hotels/ritz-carlton-nikko/calendar?from=2026-10-01&to=2027-09-30
```

各宿泊日の最新観測値を返す。

### History

```http
GET /api/v1/hotels/ritz-carlton-nikko/history?stayDate=2027-01-20
```

指定宿泊日の観測時系列を返す。

## 9. エラー仕様

### 400 Bad Request

Payload不正。

```json
{
  "error": {
    "code": "INVALID_PAYLOAD",
    "message": "observations[12].price must be a positive integer"
  }
}
```

### 401 Unauthorized

Bearer token が不正または欠落。

### 409 Conflict

同じ `runId` で異なる内容が送信された。

### 5xx

D1障害等の一時エラー。クローラ側は exponential backoff で再試行する。

400 / 401 / 409 は自動再試行しない。

## 10. Dashboard UI

1ページ構成とする。

表示項目:

- 12か月の最安値
- 最安宿泊日
- 予約可能日数
- 最終観測日時
- 12か月価格カレンダー
- 価格ヒートマップ
- 宿泊日クリックによる価格推移
- 現在価格
- 前回比
- 過去最安値
- 過去最高値
- 月別最安値
- データ鮮度警告
- 一休施設ページへのリンク

## 11. カレンダーの色

価格の 5 percentile〜95 percentile を色スケールの上下限として、低価格を緑、中間を黄、高価格を赤で表示する。

極端な外れ値によって色分布が崩れないことを目的とする。

## 12. データ鮮度

最終観測から24〜36時間以上更新がない場合、Dashboard上に stale 警告を表示する。

例:

```text
⚠ 価格データが更新されていません
最終取得: 2日前
```

## 13. アクセス制御

MVP:

- Site: public
- 読み取りAPI: public
- `POST /api/v1/ingest/snapshots`: Bearer token 必須

CORSは認証境界として扱わない。

将来 Dashboard を非公開化する場合は、読み取り側に追加認証を導入する。

## 14. クローラ側の責務

クローラは以下だけを担当する。

1. 一休からデータ取得
2. 同じ宿泊日の候補から最安プランを選択
3. API schema へ正規化
4. `runId` を生成
5. SiteへPOST
6. 5xx / network error のみ再試行

一休固有のHTML/GraphQL解析コードはSite側へ置かない。

## 15. セキュリティ

Hosted Secret:

```text
INGEST_TOKEN
```

のみで開始する。

Token rotation時は一時的に新旧2トークンを受け入れ、クローラ切替後に旧トークンを削除する。

任意SQLを実行できるAPIは実装しない。

## 16. MVP範囲

| 機能 | MVP |
|---|---:|
| リッツ日光 | ○ |
| 大人2名・1室 | ○ |
| 12か月 | ○ |
| 日次スナップショット | ○ |
| 現在価格カレンダー | ○ |
| ヒートマップ | ○ |
| 日付別価格推移 | ○ |
| 月別最安値 | ○ |
| 前回比 | ○ |
| 過去最安値 | ○ |
| stale警告 | ○ |
| 複数ホテル | 後 |
| プラン一覧 | 後 |
| 朝食付きフィルタ | 後 |
| 通知 | 後 |
| R2 | 不要 |

## 17. OpenAPI

外部クローラおよびAPIクライアント向けの契約はリポジトリルートの `openapi.yaml` を正とする。
