#!/usr/bin/env node
/**
 * Post-deployment smoke test.
 *
 * Read-only:
 *   SITE_URL=https://your-site.chatgpt.site npm run smoke:read
 *
 * Ingest, using ACTUAL crawler output (never fake prices in production):
 *   SITE_URL=... INGEST_TOKEN=... SNAPSHOT_FILE=/path/to/real-snapshot.json npm run smoke:ingest
 *
 * Token is read from an environment variable, never CLI args or committed files.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const HOTEL = "ritz-carlton-nikko";
const PROFILE = "standard-2a-1r-1n";
function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
function siteUrl(raw) {
  invariant(raw, "SITE_URL is required");
  const url = new URL(raw);
  invariant(
    url.protocol === "https:" || (url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname)),
    "SITE_URL must be HTTPS except for localhost"
  );
  invariant(!url.username && !url.password && !url.search && !url.hash && url.pathname === "/",
    "SITE_URL must be the origin, without credentials, path or query");
  return url.origin;
}
async function request(base, path, options={}, fetcher=fetch) {
  const response = await fetcher(base + path, {cache:"no-store", ...options});
  const data = await response.json().catch(() => null);
  return {status:response.status, data};
}
export async function smokeRead(base, fetcher=fetch, out=console) {
  base=siteUrl(base);
  const health = await request(base, "/api/v1/health", {}, fetcher);
  invariant(health.status===200 && health.data?.ok===true, "Health check failed: "+health.status);
  out.log("✓ API health");

  const summary = await request(base, "/api/v1/hotels/"+HOTEL+"/summary?pricingProfileId="+PROFILE,{},fetcher);
  invariant(summary.status===200 && summary.data?.hotelId===HOTEL, "Summary failed: "+summary.status);
  out.log("✓ Summary API");

  const date = new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
  const calendar = await request(base,
    "/api/v1/hotels/"+HOTEL+"/calendar?pricingProfileId="+PROFILE+"&from="+date+"&to="+date,{},fetcher);
  invariant(calendar.status===200 && Array.isArray(calendar.data?.days), "Calendar failed: "+calendar.status);
  out.log("✓ Calendar API ("+calendar.data.days.length+" days for "+date+")");

  const history = await request(base,
    "/api/v1/hotels/"+HOTEL+"/history?pricingProfileId="+PROFILE+"&stayDate="+date,{},fetcher);
  invariant(history.status===200 && Array.isArray(history.data?.observations), "History failed: "+history.status);
  out.log("✓ History API");
  return {health:health.data, summary:summary.data};
}
export async function smokeIngest(base, token, payload, fetcher=fetch, out=console) {
  base=siteUrl(base);
  invariant(typeof token==="string" && token.length>=32, "INGEST_TOKEN must have at least 32 characters");
  invariant(payload?.hotelId===HOTEL && payload?.pricingProfileId===PROFILE &&
    Array.isArray(payload?.observations) && payload.observations.length>0,
    "SNAPSHOT_FILE must contain actual crawler output matching hotel/profile; never send fabricated prices");
  const path="/api/v1/ingest/snapshots", body=JSON.stringify(payload);
  const send = bearer => request(base,path,{
    method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+bearer},body,
  },fetcher);
  const unauth = await send("invalid-smoke-test-token");
  invariant(unauth.status===401, "Missing Bearer authorization boundary: expected 401, got "+unauth.status);
  out.log("✓ Wrong token rejected (401)");
  const first = await send(token);
  invariant(first.status===200 && ["accepted","already_processed"].includes(first.data?.status),
    "Ingest failed: "+first.status+" "+JSON.stringify(first.data));
  invariant(first.data.observations===payload.observations.length,"Ingest observation count mismatch");
  out.log("✓ Ingest "+first.data.status+" ("+first.data.observations+" days)");
  const replay = await send(token);
  invariant(replay.status===200 && replay.data?.status==="already_processed",
    "Idempotent replay failed: "+replay.status+" "+JSON.stringify(replay.data));
  out.log("✓ Identical runId replay deduplicated");
  const day=payload.observations[0].stayDate;
  const history=await request(base,
    "/api/v1/hotels/"+HOTEL+"/history?pricingProfileId="+PROFILE+"&stayDate="+encodeURIComponent(day),{},fetcher);
  invariant(history.status===200 && history.data?.observations?.some(
    item => new Date(item.observedAt).getTime()===new Date(payload.observedAt).getTime()
  ),"Ingested observation not found in history for "+day);
  out.log("✓ Persisted observation visible in history");
  return first.data;
}
async function main() {
  const mode=process.argv[2];
  invariant(["read","ingest"].includes(mode),"Usage: node scripts/smoke-test.mjs read|ingest");
  const base=siteUrl(process.env.SITE_URL);
  await smokeRead(base);
  if (mode==="ingest") {
    const file=process.env.SNAPSHOT_FILE;
    invariant(file,"SNAPSHOT_FILE must point to real crawler JSON. Do not ingest fake data.");
    const payload=JSON.parse(await readFile(file,"utf8"));
    await smokeIngest(base,process.env.INGEST_TOKEN,payload);
  }
  console.log("All smoke checks passed.");
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{console.error("Smoke test failed:",e.message);process.exitCode=1;});
}
