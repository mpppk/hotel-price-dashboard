import test from "node:test";
import assert from "node:assert/strict";
import {smokeRead,smokeIngest} from "../scripts/smoke-test.mjs";

const SITE="https://hotel-test.chatgpt.site";
const TOKEN="0123456789abcdefghijklmnopqrstuvwxyzSECRET";
const day="2027-01-20";
const payload={
  schemaVersion:1, runId:"real-run-1", hotelId:"ritz-carlton-nikko",
  pricingProfileId:"standard-2a-1r-1n",observedAt:"2026-09-30T00:00:00Z",
  observations:[{stayDate:day,available:true,price:106000}],
};
const response=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"content-type":"application/json"},
});

test("read smoke checks all four routes without writing", async()=>{
  const visited=[];
  const fetcher=async input=>{
    const url=new URL(input); visited.push(url.pathname);
    if(url.pathname.endsWith("/health")) return response({ok:true});
    if(url.pathname.endsWith("/summary")) return response({hotelId:"ritz-carlton-nikko"});
    if(url.pathname.endsWith("/calendar")) return response({days:[]});
    if(url.pathname.endsWith("/history")) return response({observations:[]});
    throw Error("unknown endpoint "+url.pathname);
  };
  await smokeRead(SITE,fetcher,{log(){}});
  assert.equal(visited.length,4);
});

test("ingest checks unauthenticated access, accepts real snapshot, checks replay and persistence",async()=>{
  let validWrites=0, invalidRequests=0;
  const fetcher=async(input,init={})=>{
    const url=new URL(input);
    if(url.pathname.endsWith("/history"))
      return response({observations:[{observedAt:payload.observedAt,price:106000}]});
    if(init.headers.authorization!== "Bearer "+TOKEN) {
      invalidRequests++;
      return response({error:{code:"UNAUTHORIZED"}},401);
    }
    validWrites++;
    return response({runId:payload.runId,status:validWrites===1?"accepted":"already_processed",observations:1});
  };
  const result=await smokeIngest(SITE,TOKEN,payload,fetcher,{log(){}});
  assert.equal(result.status,"accepted");
  assert.equal(invalidRequests,1);
  assert.equal(validWrites,2);
});

test("smoke ingest refuses fabricated or missing data",async()=>{
  await assert.rejects(()=>smokeIngest(SITE,TOKEN,{observations:[]}),/SNAPSHOT_FILE/);
  await assert.rejects(()=>smokeRead("http://example.test"),/HTTPS/);
  await assert.rejects(()=>smokeRead("https://user:password@example.com"),/without credentials/);
});
