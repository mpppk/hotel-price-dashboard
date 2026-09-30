export const HOTEL_ID = "ritz-carlton-nikko";
export const PROFILE_ID = "standard-2a-1r-1n";
export const HOTEL_NAME = "ザ・リッツ・カールトン日光";
export const HOTEL_URL = "https://www.ikyu.com/00002777/";

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (message) => new ApiError(400, "INVALID_PAYLOAD", message);

function record(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}
function keysOnly(obj, allowed, location) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw bad(location + "." + key + " is not permitted");
  }
}
export function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function textOrNull(value, field, max = 200) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) throw bad(field + " must be a string of at most " + max + " characters");
  return value;
}
export function parseSnapshot(input) {
  if (!record(input)) throw bad("Expected JSON object");
  keysOnly(input, ["schemaVersion","runId","crawlerVersion","hotelId","pricingProfileId","observedAt","observations"], "request");
  if (input.schemaVersion !== 1) throw bad("schemaVersion must be 1");
  if (typeof input.runId !== "string" || !/^[\w.-]{1,128}$/.test(input.runId)) throw bad("runId must be 1-128 ASCII letters, digits, _ . or -");
  if (input.hotelId !== HOTEL_ID) throw bad("Unknown hotelId");
  if (input.pricingProfileId !== PROFILE_ID) throw bad("Unknown pricingProfileId");
  if (typeof input.observedAt !== "string" || !/^\d{4}-\d\d-\d\dT/.test(input.observedAt) || !/(Z|[+-]\d\d:\d\d)$/.test(input.observedAt)) {
    throw bad("observedAt must be an ISO 8601 timestamp with timezone");
  }
  const time = new Date(input.observedAt);
  if (!Number.isFinite(time.getTime())) throw bad("Invalid observedAt");
  if (!Array.isArray(input.observations) || input.observations.length < 1 || input.observations.length > 400) {
    throw bad("observations must contain 1-400 items");
  }
  const seen = new Set();
  const observations = input.observations.map((o, i) => {
    const at = "observations[" + i + "]";
    if (!record(o)) throw bad(at + " must be an object");
    keysOnly(o, ["stayDate","available","price","roomName","planName","sourceUrl"], at);
    if (!validDate(o.stayDate)) throw bad(at + ".stayDate must be YYYY-MM-DD");
    if (seen.has(o.stayDate)) throw bad(at + ".stayDate is duplicated");
    seen.add(o.stayDate);
    if (typeof o.available !== "boolean") throw bad(at + ".available must be boolean");
    if (o.available && (!Number.isSafeInteger(o.price) || o.price <= 0)) {
      throw bad(at + ".price must be a positive integer");
    }
    if (!o.available && o.price !== null) throw bad(at + ".price must be null when unavailable");
    const sourceUrl = textOrNull(o.sourceUrl, at + ".sourceUrl", 2048);
    if (sourceUrl !== null) {
      try {
        const url = new URL(sourceUrl);
        if (!["http:","https:"].includes(url.protocol)) throw new Error("scheme");
      } catch { throw bad(at + ".sourceUrl must be an HTTP(S) URL"); }
    }
    return {
      stayDate: o.stayDate, available: o.available, price: o.price,
      roomName: textOrNull(o.roomName, at + ".roomName"),
      planName: textOrNull(o.planName, at + ".planName"),
      sourceUrl,
    };
  }).sort((a, b) => a.stayDate.localeCompare(b.stayDate));
  return {
    schemaVersion: 1, runId: input.runId, hotelId: HOTEL_ID,
    pricingProfileId: PROFILE_ID,
    crawlerVersion: textOrNull(input.crawlerVersion, "crawlerVersion", 64),
    observedAt: time.toISOString(), observations,
  };
}
export async function fingerprint(normalized) {
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, "0")).join("");
}
export async function validBearer(request, secret) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get("authorization") || "");
  if (!match) return false;
  const digest = async s => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  const [a,b] = await Promise.all([digest(match[1]), digest(secret)]);
  let unequal = 0;
  for (let i = 0; i < a.length; i++) unequal |= a[i] ^ b[i];
  return unequal === 0;
}
export function jstDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const by = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return by.year + "-" + by.month + "-" + by.day;
}
export function plusMonths(iso, count) {
  const [y,m,d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + count + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + count, Math.min(d, last))).toISOString().slice(0, 10);
}
