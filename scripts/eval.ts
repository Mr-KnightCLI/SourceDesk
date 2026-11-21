import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { store,type Query } from "../lib/store";
import { provider } from "../lib/provider";
import { samples,questions } from "../lib/demo";
import { cases,distractors,score } from "../test/cases";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL first.");
  const db=new Client({connectionString:process.env.DATABASE_URL});
  await db.connect();
  let owner:string|undefined;
  try {
    const query:Query=async(sql,params)=>(await db.query(sql,params)).rows;
    const [account]=await query<{id:string}>("INSERT INTO accounts(email,password) VALUES(gen_random_uuid()::text||'@eval.invalid','disabled') RETURNING id");
    owner=account.id;
    const desk=store(query,provider());
    for (const sample of samples) {
      const document=await desk.upload(owner,sample.name,await readFile("public/samples/"+sample.name));
      const indexed=await desk.index(owner,document.id);
      if(indexed.status!=="ready") throw new Error(indexed.error??"Indexing did not complete.");
    }
    const decoy=await desk.upload(owner,"Office notes.txt",Buffer.from(distractors));
    const indexed=await desk.index(owner,decoy.id);
    if(indexed.status!=="ready") throw new Error(indexed.error??"Distractors did not index.");
    let hits=0,total=0;
    const failures:string[]=[];
    for (const item of cases.filter(item=>item.expected.length)) {
      const found=await desk.retrieve(owner,item.question,null);
      const count=score(found,item.expected);
      hits+=count;total+=item.expected.length;
      const missed=item.expected.filter(target=>!found.some(hit=>hit.name===target.name&&hit.location===target.location));
      console.log(`${count}/${item.expected.length} — ${item.question}`);
      if(missed.length) failures.push(item.question+" Missing: "+missed.map(hit=>hit.name+" / "+hit.location).join(", "));
    }
    const unsupported=await desk.ask(owner,questions[2],null);
    console.log(`Recall@8: ${hits}/${total} (${Math.round(100*hits/total)}%).`);
    if(unsupported.supported) failures.push("Unsupported question produced an answer.");
    console.log("Failed cases: "+(failures.join("\n")||"none"));
    if(failures.length) process.exitCode=1;
  } finally {
    try { if(owner) await db.query("DELETE FROM accounts WHERE id=$1",[owner]); }
    finally { await db.end(); }
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
