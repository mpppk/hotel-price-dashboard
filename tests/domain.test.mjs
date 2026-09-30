import test from "node:test";
import assert from "node:assert/strict";
import { parseSnapshot, fingerprint, validDate, plusMonths, validBearer } from "../server/domain.mjs";
const secret = "0123456789abcdefghijklmnopqrstuvwxyzABCDEF";
const sample = () => ({
  schemaVersion:1,runId:"run-1",hotelId:"ritz-carlton-nikko",
  pricingProfileId:"standard-2a-1r-1n",
  observedAt:"2026-09-30T21:00:00Z",
  observations:[
    {stayDate:"2026-11-21",available:false,price:null},
    {stayDate:"2026-11-20",available:true,price:106000,roomName:"男体山ビュー"},
  ],
});
test("normalizes dates and nullable fields", () => {
  const data=parseSnapshot(sample());
  assert.deepEqual(data.observations.map(o=>o.stayDate),["2026-11-20","2026-11-21"]);
  assert.equal(data.observations[0].planName,null);
});
test("duplicate stay date is rejected", () => {
  const d=sample(); d.observations[1].stayDate=d.observations[0].stayDate;
  assert.throws(()=>parseSnapshot(d),/duplicated/);
});
test("invalid price and invalid date are rejected",()=>{
  const d=sample(); d.observations[1].price=-1;
  assert.throws(()=>parseSnapshot(d),/positive integer/);
  const e=sample(); e.observations[1].stayDate="2026-02-30";
  assert.throws(()=>parseSnapshot(e),/stayDate/);
  assert.equal(validDate("2026-02-30"),false);
});
test("unavailable observations require a null price",()=>{
  const d=sample(); d.observations[0].price=1;
  assert.throws(()=>parseSnapshot(d),/must be null/);
});
test("schema forbids arbitrary keys",()=>{
  const d=sample(); d.sql="DROP TABLE crawl_runs";
  assert.throws(()=>parseSnapshot(d),/not permitted/);
});
test("fingerprints ignore observation order but detect content changes",async()=>{
  const d=sample(), e=sample(); e.observations.reverse();
  assert.equal(await fingerprint(parseSnapshot(d)),await fingerprint(parseSnapshot(e)));
  e.observations[0].price=107000;
  assert.notEqual(await fingerprint(parseSnapshot(d)),await fingerprint(parseSnapshot(e)));
});
test("bearer comparison fails closed and checks the complete token",async()=>{
  const req=t=>new Request("https://example.test/api",{headers:{Authorization:"Bearer "+t}});
  assert.equal(await validBearer(req(secret),secret),true);
  assert.equal(await validBearer(req(secret+"wrong"),secret),false);
  assert.equal(await validBearer(req(secret),""),false);
});
test("plusMonths clamps leap-day overflow",()=>{
  assert.equal(plusMonths("2028-02-29",12),"2029-02-28");
  assert.equal(plusMonths("2026-10-30",12),"2027-10-30");
});
