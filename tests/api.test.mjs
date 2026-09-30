import test from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../server/api.mjs";

const secret="abcdefghijklmnopqrstuvwxyz0123456789abcdef";
class FakeDB {
  constructor(){ this.runs=new Map(); this.observations=[]; this.batchStatementCount=0; }
  prepare(sql) { return {
    bind: (...args) => ({
      sql,args,
      first: async () => {
        if(sql.includes("SELECT payload_sha256")) {
          const row=this.runs.get(args[0]);
          return row?{payload_sha256:row.payload_sha256,observation_count:row.observation_count}:null;
        }
        if(sql.includes("MAX(observed_at)")) return {last_observed_at:null};
        return null;
      },
      all: async () => ({results:[]}),
    }),
  }; }
  async batch(statements) {
    const [s,...obs]=statements;
    if(this.runs.has(s.args[0])) throw Error("UNIQUE constraint");
    this.runs.set(s.args[0],{payload_sha256:s.args[6],observation_count:s.args[7]});
    this.batchStatementCount=statements.length;
    for (const stmt of obs) {
      assert.ok(stmt.args.length <= 100, "D1 parameter limit");
      for (let i=0;i<stmt.args.length;i+=10) this.observations.push(stmt.args.slice(i,i+10));
    }
  }
}
const payload = () => ({
  schemaVersion:1,runId:"test-1",hotelId:"ritz-carlton-nikko",
  pricingProfileId:"standard-2a-1r-1n",observedAt:"2026-09-30T00:00:00Z",
  observations:[{stayDate:"2026-11-20",available:true,price:106000}],
});
function post(body,token=secret) {
  return new Request("https://example.chatgpt.site/api/v1/ingest/snapshots", {
    method:"POST",headers:{"authorization":"Bearer "+token,"content-type":"application/json"},
    body:JSON.stringify(body),
  });
}
test("unauthorized ingestion is rejected before database writes",async()=>{
  const db=new FakeDB();
  const r=await handleApi(post(payload(),"wrong"),{DB:db,INGEST_TOKEN:secret});
  assert.equal(r.status,401); assert.equal(db.runs.size,0);
});
test("ingestion is atomic and identical replays are idempotent",async()=>{
  const db=new FakeDB(),env={DB:db,INGEST_TOKEN:secret};
  let r=await handleApi(post(payload()),env);
  assert.equal(r.status,200);
  assert.equal((await r.json()).status,"accepted");
  assert.equal(db.runs.size,1); assert.equal(db.observations.length,1);
  r=await handleApi(post(payload()),env);
  assert.equal((await r.json()).status,"already_processed");
  assert.equal(db.observations.length,1);
  const changed=payload(); changed.observations[0].price=107000;
  r=await handleApi(post(changed),env);
  assert.equal(r.status,409);
  assert.equal((await r.json()).error.code,"RUN_ID_CONFLICT");
  assert.equal(db.observations.length,1);
});
test("invalid payload returns 400 and unsupported endpoint returns 404",async()=>{
  const db=new FakeDB(),env={DB:db,INGEST_TOKEN:secret};
  const p=payload(); p.observations.push({...p.observations[0]});
  assert.equal((await handleApi(post(p),env)).status,400);
  assert.equal((await handleApi(new Request("https://example.test/api/v1/absent"),env)).status,404);
});
test("read endpoints validate requested date and hotel",async()=>{
  const env={DB:new FakeDB(),INGEST_TOKEN:secret};
  const base="https://example.test/api/v1/hotels/ritz-carlton-nikko/";
  assert.equal((await handleApi(new Request(base+"history?stayDate=bad"),env)).status,400);
  assert.equal((await handleApi(new Request(base+"calendar?from=2026-10-01&to=2026-09-01"),env)).status,400);
  assert.equal((await handleApi(new Request("https://example.test/api/v1/hotels/nope/summary"),env)).status,404);
});

test("400 observation dates use at most 41 write statements",async()=>{
  const db=new FakeDB(),env={DB:db,INGEST_TOKEN:secret};
  const p=payload();
  p.runId="max-400";
  p.observations=Array.from({length:400},(_,i)=>({
    stayDate:new Date(Date.UTC(2027,0,1+i)).toISOString().slice(0,10),
    available:true,price:100000+i,
  }));
  const response=await handleApi(post(p),env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).observations,400);
  assert.equal(db.observations.length,400);
  assert.equal(db.batchStatementCount,41);
});
