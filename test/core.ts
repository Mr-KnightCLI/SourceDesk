import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { store, type Query } from "../lib/store";
import { provider, type Evidence } from "../lib/provider";
import { questions,samples } from "../lib/demo";
import { maxBytes } from "../lib/extract";
import { cases,distractors,score } from "./cases";
import { makePdf } from "./fixture";
import { checkRoutes } from "./routes";

function mockVector(text:string) {
  return [
    Number(/standard/i.test(text)), Number(/premium/i.test(text)),
    Number(/notice|cancel/i.test(text)), Number(/support|response|priority/i.test(text)),
    Number(/two plans|either/i.test(text)), 0.01,
  ];
}

async function main() {
  let failEmbedding = false;
  const mock = createServer(async (req,res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input);
    const send = (data:unknown,status=200)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(data));};
    if (req.headers.authorization !== "Bearer test-key") return send({},401);
    if (req.url === "/embeddings") {
      if (failEmbedding) return send({},503);
      return send({data:body.input.map((text:string,index:number)=>({index,embedding:mockVector(text)}))});
    }
    const {question,evidence} = JSON.parse(body.messages[1].content) as {question:string;evidence:Evidence[]};
    let output:unknown = {supported:false};
    if (question === "Invalid citation test") output = {supported:true,answer:"Invented [999]."};
    else if (question === "summarize it" && evidence.some(item=>item.location==="Page 1") && evidence.some(item=>item.location==="Page 3")) {
      output = {supported:true,answer:"The standard guide introduces service terms and cancellation [1, 3]."};
    }
    else if (question === questions[0]) {
      const ids = evidence.filter(item=>/initial response target/i.test(item.excerpt));
      if (ids.length) output = {supported:true,answer:ids.map(item=>item.excerpt+" ["+item.id+"]").join("\n\n")};
    } else if (/notice.*standard|notice period/i.test(question)) {
      const source = evidence.find(item=>/standard subscriptions|14 days/i.test(item.excerpt));
      if (source) output = {supported:true,answer:source.excerpt+" ["+source.id+"]"};
    }
    send({choices:[{message:{content:JSON.stringify(output)}}]});
  });
  mock.listen(0,"127.0.0.1");
  await once(mock,"listening");
  const address = mock.address();
  assert(address && typeof address==="object");
  process.env.CHAT_API_URL = process.env.EMBEDDING_API_URL = "http://127.0.0.1:"+address.port;
  process.env.CHAT_API_KEY = process.env.EMBEDDING_API_KEY = "test-key";
  process.env.EMBEDDING_MODEL = "fixture";
  const db = new PGlite({extensions:{vector}});
  try {
    await db.exec(await readFile("db/001.sql","utf8"));
    const query: Query = async (sql,params)=>(await db.query(sql,params)).rows as never[];
    const owner="00000000-0000-0000-0000-000000000001";
    const other="00000000-0000-0000-0000-000000000002";
    await query("INSERT INTO accounts(id,email,password) VALUES($1,'one@example.test','test'),($2,'two@example.test','test')",[owner,other]);
    const desk=store(query,provider());
    const pdf=await makePdf(["Membership overview","The notice period is 14 days."]);
    const doc=await desk.upload(owner,"Handbook.pdf",pdf);
    assert.equal((await desk.index(owner,doc.id)).status,"ready");
    const answer=await desk.ask(owner,"What is the notice period?",null);
    assert.equal(answer.sources[0]?.location,"Page 2");
    const excerpt=await desk.preview(owner,answer.sources[0].id);
    assert.equal(excerpt.excerpt,"The notice period is 14 days.");
    console.log("PASS PDF upload → pgvector → answer → verified page 2 excerpt");

    assert.deepEqual(await desk.list(other),[]);
    assert.deepEqual(await desk.retrieve(other,"notice period",[doc.id]),[]);
    await assert.rejects(desk.preview(other,excerpt.id),{status:404});
    await assert.rejects(desk.index(other,doc.id),{status:404});
    await assert.rejects(desk.remove(other,doc.id),{status:404});
    const otherDoc=await desk.upload(other,"Private.txt",Buffer.from("Private account text"));
    await desk.index(other,otherDoc.id);
    assert.deepEqual(await desk.retrieve(owner,"private account",[otherDoc.id]),[]);
    console.log("PASS two-way ownership for listing, search, previews, indexing, and deletion");

    await desk.remove(owner,doc.id);
    await assert.rejects(desk.preview(owner,excerpt.id),{status:404});
    assert.deepEqual(await query("SELECT id FROM chunks WHERE document=$1",[doc.id]),[]);
    console.log("PASS document deletion cascades to searchable chunks");

    const indexed=[];
    for (const sample of samples) {
      const file=await readFile("public/samples/"+sample.name);
      const uploaded=await desk.upload(owner,sample.name,file);
      assert.equal((await desk.index(owner,uploaded.id)).status,"ready");
      indexed.push(uploaded);
    }
    const comparison=await desk.ask(owner,questions[0],null);
    assert.equal(comparison.sources.length,2);
    for (const sample of samples) {
      const ref=comparison.sources.find(ref=>ref.name===sample.name);
      assert(ref);
      const source=await desk.preview(owner,ref.id);
      assert.equal(source.location,sample.location);
      assert.equal(source.excerpt.replace(/\s+/g," "),sample.excerpt);
    }
    assert.equal((await desk.ask(owner,questions[0],[indexed[1].id])).sources[0]?.name,samples[1].name);
    assert.equal((await desk.ask(owner,questions[2],null)).supported,false);
    const summary = await desk.ask(owner,"summarize it",[indexed[0].id]);
    assert.deepEqual(summary.sources.map(ref=>ref.location),["Page 1","Page 3"]);
    assert.match(summary.answer,/\[1\]\[3\]/);
    const standardSuggestions=await desk.suggestions(owner,[indexed[0].id]);
    const premiumSuggestions=await desk.suggestions(owner,[indexed[1].id]);
    assert(standardSuggestions.some(question=>question.includes(samples[0].name)));
    assert(premiumSuggestions.some(question=>question.includes(samples[1].name)));
    assert(premiumSuggestions.some(question=>question.includes("Support commitments")));
    assert.deepEqual(await desk.suggestions(other,[indexed[0].id]),[]);
    console.log("PASS cited summaries and document-specific suggestions with owner scoping");
    assert.equal((await desk.ask(owner,"Invalid citation test",null)).supported,false);
    console.log("PASS DOCX heading, comparison with both citations, file selection, refusal, and rejection of invented citation IDs");

    await assert.rejects(desk.upload(owner,"image.png",Buffer.alloc(0)),{status:415});
    await assert.rejects(desk.upload(owner,"large.pdf",Buffer.alloc(maxBytes+1)),{status:413});
    const broken=await desk.upload(owner,"broken.docx",Buffer.from("not a DOCX"));
    assert.match((await desk.index(owner,broken.id)).error??"",/could not be parsed/i);
    const blank=await desk.upload(owner,"scan.pdf",await makePdf([""]));
    assert.match((await desk.index(owner,blank.id)).error??"",/require OCR/i);
    const md=await desk.upload(owner,"notes.md",Buffer.from("# Returns\n\nReturns accepted for 14 days."));
    failEmbedding=true;
    assert.equal((await desk.index(owner,md.id)).status,"failed");
    failEmbedding=false;
    assert.equal((await desk.index(owner,md.id)).status,"ready");
    assert((await desk.retrieve(owner,"Returns",[md.id])).some(s=>s.location==="Returns · Line 3"));
    const plaintext=await desk.retrieve(other,"Private",[otherDoc.id]);
    assert.equal(plaintext[0]?.location,"Paragraph 1");
    console.log("PASS TXT, Markdown, invalid format/size, malformed DOCX, OCR detection, and failed indexing retry");

    const base=provider();
    const attempted:string[]=[];
    const resumable=store(query,{...base,embeddingBatchSize:1,async embed(texts){
      attempted.push(...texts);
      if (attempted.length===2) throw new Error("Simulated provider interruption");
      return base.embed(texts);
    }});
    const resumeDoc=await resumable.upload(owner,"Resume test.txt",Buffer.from("Repeated passage\n\nSecond passage\n\nRepeated passage"));
    assert.equal((await resumable.index(owner,resumeDoc.id)).status,"failed");
    assert.equal((await resumable.list(owner)).find(item=>item.id===resumeDoc.id)?.processed,1);
    assert.deepEqual(await resumable.retrieve(owner,"Repeated passage",[resumeDoc.id]),[]);
    assert.equal((await resumable.index(owner,resumeDoc.id)).status,"ready");
    assert.deepEqual(attempted,["Repeated passage","Second passage","Second passage"]);
    assert.equal((await resumable.retrieve(owner,"Repeated passage",[resumeDoc.id])).length,3);
    await resumable.remove(owner,resumeDoc.id);
    console.log("PASS retries reuse completed and duplicate embeddings while preserving every source location");

    let found=0,total=0;
    const failures:string[]=[];
    const decoy=await desk.upload(owner,"Office notes.txt",Buffer.from(distractors));
    assert.equal((await desk.index(owner,decoy.id)).status,"ready");
    const scope=[...indexed.map(doc=>doc.id),decoy.id];
    for (const item of cases) {
      if (!item.expected.length) {
        assert.equal((await desk.ask(owner,item.question,scope)).supported,false);
        console.log("Expected refusal — "+item.question);
        continue;
      }
      const retrieved=await desk.retrieve(owner,item.question,scope);
      const hits=score(retrieved,item.expected);
      found+=hits; total+=item.expected.length;
      if (hits!==item.expected.length) failures.push(item.question);
      console.log(`Recall@8 ${hits}/${item.expected.length} — ${item.question}`);
    }
    console.log(`Recall@8 ${found}/${total} (${Math.round(100*found/total)}%). Failed cases: ${failures.join("; ")||"none"}.`);
    assert.deepEqual(failures,[]);
    await checkRoutes(db);
  } finally { await db.close(); mock.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
