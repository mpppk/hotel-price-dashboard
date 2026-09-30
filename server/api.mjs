import {
  ApiError, bad, fingerprint, HOTEL_ID, HOTEL_NAME, HOTEL_URL,
  jstDate, parseSnapshot, plusMonths, PROFILE_ID, validBearer, validDate,
} from "./domain.mjs";

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff" },
});
const error = (status, code, message) => json({ error: { code, message } }, status);

async function ingest(request, env) {
  if (!(await validBearer(request, env.INGEST_TOKEN))) return error(401, "UNAUTHORIZED", "Unauthorized");
  // Protect Workers from unexpectedly large bodies; approximately 400 normalized dates.
  if (Number(request.headers.get("content-length") || 0) > 300_000) throw bad("Request body too large");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 300_000) throw bad("Request body too large");
  let raw;
  try { raw = JSON.parse(body); } catch { throw bad("Malformed JSON"); }
  const data = parseSnapshot(raw);
  const sha = await fingerprint(data);
  const current = await env.DB.prepare("SELECT payload_sha256, observation_count FROM crawl_runs WHERE id = ?").bind(data.runId).first();
  const same = row => {
    if (row.payload_sha256 !== sha) throw new ApiError(409, "RUN_ID_CONFLICT", "runId was already processed with different content");
    return json({ runId: data.runId, status: "already_processed", observations: row.observation_count });
  };
  if (current) return same(current);
  const inserts = [
    env.DB.prepare("INSERT INTO crawl_runs (id,hotel_id,pricing_profile_id,observed_at,ingested_at,crawler_version,payload_sha256,observation_count) VALUES (?,?,?,?,?,?,?,?)")
      .bind(data.runId, data.hotelId, data.pricingProfileId, data.observedAt, new Date().toISOString(), data.crawlerVersion, sha, data.observations.length),
    ...data.observations.map(o =>
      env.DB.prepare("INSERT INTO price_observations (hotel_id,pricing_profile_id,run_id,stay_date,available,price_jpy,room_name,plan_name,source_url,observed_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .bind(data.hotelId, data.pricingProfileId, data.runId, o.stayDate, Number(o.available), o.price, o.roomName, o.planName, o.sourceUrl, data.observedAt)),
  ];
  try {
    // D1.batch executes statements in one transaction; no partially ingested runs.
    await env.DB.batch(inserts);
  } catch (cause) {
    // Another simultaneous request may have committed the same runId.
    const raced = await env.DB.prepare("SELECT payload_sha256, observation_count FROM crawl_runs WHERE id = ?").bind(data.runId).first();
    if (raced) return same(raced);
    throw cause;
  }
  return json({ runId: data.runId, status: "accepted", observations: data.observations.length });
}

async function calendar(db, hotelId, profile, from, to) {
  const { results } = await db.prepare(
    "WITH ranked AS (" +
    " SELECT stay_date,available,price_jpy,room_name,plan_name,observed_at,run_id," +
    " ROW_NUMBER() OVER (PARTITION BY stay_date ORDER BY observed_at DESC,run_id DESC) AS rn," +
    " LAG(price_jpy) OVER (PARTITION BY stay_date ORDER BY observed_at,run_id) AS previous_price," +
    " MIN(CASE WHEN available=1 THEN price_jpy END) OVER (PARTITION BY stay_date) AS historical_minimum," +
    " MAX(CASE WHEN available=1 THEN price_jpy END) OVER (PARTITION BY stay_date) AS historical_maximum" +
    " FROM price_observations WHERE hotel_id=? AND pricing_profile_id=? AND stay_date BETWEEN ? AND ?" +
    ") SELECT stay_date,available,price_jpy,room_name,plan_name,observed_at,previous_price,historical_minimum,historical_maximum" +
    " FROM ranked WHERE rn=1 ORDER BY stay_date"
  ).bind(hotelId, profile, from, to).all();
  return (results || []).map(r => ({
    stayDate: r.stay_date, available: Boolean(r.available), price: r.price_jpy,
    observedAt: r.observed_at, roomName: r.room_name, planName: r.plan_name,
    previousPrice: r.previous_price, historicalMinimum: r.historical_minimum,
    historicalMaximum: r.historical_maximum,
  }));
}

async function readHotel(request, env, hotelId, action) {
  if (hotelId !== HOTEL_ID) throw new ApiError(404, "NOT_FOUND", "Unknown hotel");
  const u = new URL(request.url);
  const profile = u.searchParams.get("pricingProfileId") ?? PROFILE_ID;
  if (profile !== PROFILE_ID) throw new ApiError(404, "NOT_FOUND", "Unknown pricing profile");
  if (action === "history") {
    const day = u.searchParams.get("stayDate");
    if (!validDate(day)) throw bad("stayDate must be YYYY-MM-DD");
    const { results } = await env.DB.prepare(
      "SELECT observed_at,available,price_jpy,room_name,plan_name FROM price_observations" +
      " WHERE hotel_id=? AND pricing_profile_id=? AND stay_date=? ORDER BY observed_at,run_id"
    ).bind(hotelId, profile, day).all();
    return json({
      hotelId, pricingProfileId: profile, stayDate: day,
      observations: (results || []).map(r => ({
        observedAt: r.observed_at, available: Boolean(r.available), price: r.price_jpy,
        roomName: r.room_name, planName: r.plan_name,
      })),
    });
  }
  const from = action === "summary" ? jstDate() : u.searchParams.get("from");
  const to = action === "summary" ? plusMonths(from, 12) : u.searchParams.get("to");
  if (!validDate(from) || !validDate(to) || from > to ||
      (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000 > 400) {
    throw bad("from/to must be valid dates in ascending order covering at most 401 days");
  }
  const days = await calendar(env.DB, hotelId, profile, from, to);
  if (action === "calendar") return json({ hotelId, pricingProfileId: profile, from, to, days });
  const available = days.filter(d => d.available && d.price != null);
  const minDay = [...available].sort((a,b) => a.price - b.price || a.stayDate.localeCompare(b.stayDate))[0];
  const lastRun = await env.DB.prepare(
    "SELECT MAX(observed_at) AS last_observed_at FROM crawl_runs WHERE hotel_id=? AND pricing_profile_id=?"
  ).bind(hotelId, profile).first();
  return json({
    hotelId, pricingProfileId: profile,
    currentMinimum: minDay?.price ?? null,
    currentMinimumStayDate: minDay?.stayDate ?? null,
    availableDays: available.length, coveredDays: days.length,
    lastObservedAt: lastRun?.last_observed_at ?? null,
  });
}

export async function handleApi(request, env) {
  const pathname = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  if (!pathname.startsWith("/api/")) return null;
  try {
    if (!env?.DB) throw new Error("D1 binding DB missing");
    if (pathname === "/api/v1/ingest/snapshots" && request.method === "POST") return await ingest(request, env);
    if (pathname === "/api/v1/health" && request.method === "GET") return json({ ok: true });
    const m = /^\/api\/v1\/hotels\/([^/]+)\/(summary|calendar|history)$/.exec(pathname);
    if (m && request.method === "GET") return await readHotel(request, env, decodeURIComponent(m[1]), m[2]);
    return error(404, "NOT_FOUND", "Endpoint not found");
  } catch (e) {
    if (e instanceof ApiError) return error(e.status, e.code, e.message);
    console.error("API request failed", e);
    return error(503, "SERVICE_UNAVAILABLE", "Temporary backend error");
  }
}
