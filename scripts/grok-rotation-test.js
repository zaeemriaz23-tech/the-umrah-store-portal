'use strict';
/* Exercises OpenRouter multi-key fallback without contacting the live API. */
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tus-openrouter-'));
process.env.CRM_TEST_MODE='1';process.env.NODE_ENV='test';process.env.DATA_DIR=dir;
process.env.OPENROUTER_API_KEYS='mock-key-one\nmock-key-two';
process.env.OPENROUTER_BASE_URL='https://mock.openrouter/v1';
const AI=require('../lib/assistant'),calls=[];
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
(async()=>{
 try{
  const cfg=AI.orCfg();
  assert.deepStrictEqual(cfg.keys.map(x=>x.key),['mock-key-one','mock-key-two']);
  global.fetch=async(url,options)=>{
   calls.push({url:String(url),key:options.headers.authorization,body:JSON.parse(options.body||'{}')});
   if(options.headers.authorization==='Bearer mock-key-one')return json(429,{error:{message:'rate limit reached'}});
   return json(200,{choices:[{finish_reason:'stop',message:{role:'assistant',content:'backup key worked'}}]});
  };
  const state={};
  const out=await AI.orRequest(cfg,{model:cfg.model,temperature:.2,max_tokens:3000,messages:[{role:'user',content:'test'}]},state);
  assert.strictEqual(calls.length,2,'second API key is tried after first key receives 429');
  assert.strictEqual(calls[1].key,'Bearer mock-key-two');
  assert.strictEqual(calls[1].url,'https://mock.openrouter/v1/chat/completions');
  assert.strictEqual(calls[1].body.max_tokens,3000);
  assert.strictEqual(out.choices[0].message.content,'backup key worked');
  assert.match(state.notice,/backup OpenRouter key/i);
  console.log('PASS openrouter-key-pool-test: key list, 429 failover, backup-key response and notice');
 }finally{try{fs.rmSync(dir,{recursive:true,force:true});}catch{}}
})().catch(e=>{console.error(e);process.exitCode=1;});
