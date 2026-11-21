import { randomUUID } from "node:crypto";
import { extract, maxBytes, split, supported, UserError } from "./extract";
import type { Provider } from "./provider";

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
export type Document = { id: string; name: string; status: string; error: string | null; processed?: number | null };
export type Source = { id: string; document: string; name: string; location: string; excerpt: string };
export const missing = "I couldn’t find enough evidence in the selected documents to answer that question.";
const overviewRequest = /^(?:(?:please|(?:can|could|would) you)\s+)*(?:(?:summari[sz]e|give me (?:a summary|an overview)(?: of)?)(?:\s+(?:it|them|this|these|the|selected|uploaded|my|pdfs?|files?|documents?|chapter|unit|notes|briefly|for me)|\s+[“"][^”"]+[”"])*[.!?]*|(?:summary|overview)(?: please)?[.!?]*|what (?:is|are) (?:it|this|these|the (?:pdfs?|documents?|files?|chapter|unit)) about[?!.]*)$/i;

function vector(values: number[] | undefined) {
  if (!Array.isArray(values) || !values.length || !values.every(Number.isFinite) || !values.some(x => x !== 0)) {
    throw new UserError("The embedding provider returned an invalid vector.", 502);
  }
  return JSON.stringify(values);
}

export function store(query: Query, ai: Provider) {
  const list = (owner: string) => query<Document>(`SELECT d.id,d.name,d.status,d.error,
    CASE WHEN d.status IN ('indexing','failed') THEN (SELECT count(*)::int FROM chunks WHERE document=d.id) END AS processed
    FROM documents d WHERE d.owner=$1 ORDER BY d.created,d.id`, [owner]);
  async function upload(owner: string, name: string, content: Buffer) {
    if (!supported.test(name)) throw new UserError("Upload a PDF, DOCX, TXT, or Markdown file.", 415);
    if (content.length > maxBytes) throw new UserError("This file exceeds the 10 MB limit.", 413);
    const [doc] = await query<Document>("INSERT INTO documents(owner,name,content) VALUES($1,$2,$3) RETURNING id,name,status,error", [owner,name.slice(-240),content]);
    return doc;
  }
  async function index(owner: string, id: string) {
    const attempt = randomUUID();
    const [doc] = await query<Document & { content: Uint8Array }>(
      "UPDATE documents SET status='indexing', attempt=$3,error=NULL,updated=now() WHERE id=$1 AND owner=$2 AND (status IN ('pending','failed') OR (status='indexing' AND updated < now()-interval '20 minutes')) RETURNING id,name,content,status,error",
      [id, owner, attempt]);
    if (!doc) {
      const [existing] = await query<Document>("SELECT id,name,status,error FROM documents WHERE id=$1 AND owner=$2", [id,owner]);
      if (!existing) throw new UserError("Document not found.", 404);
      return existing;
    }
    try {
      const chunks = split(await extract(doc.name, Buffer.from(doc.content)));
      if (chunks.length > 900) throw new UserError("This document contains too much text to index. Split it into smaller files.");
      const batchSize = ai.embeddingBatchSize ?? 64;
      const saved = await query<{ordinal:number;location:string;excerpt:string;embedding:string;model:string}>(
        "SELECT ordinal,location,excerpt,embedding::text,model FROM chunks WHERE document=$1 ORDER BY ordinal", [id]);
      const cached = new Map(saved.filter(row=>row.model===ai.model).map(row=>[row.excerpt,row.embedding]));
      const byOrdinal = new Map(saved.map(row=>[row.ordinal,row]));
      const pending = chunks.map((chunk,ordinal)=>({...chunk,ordinal})).filter(chunk=>{
        const row=byOrdinal.get(chunk.ordinal);
        return !row || row.model!==ai.model || row.location!==chunk.location || row.excerpt!==chunk.excerpt;
      });
      for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);
        const missing = [...new Set(batch.map(p=>p.excerpt))].filter(excerpt=>!cached.has(excerpt));
        if (missing.length) {
          const embeddings = await ai.embed(missing);
          missing.forEach((excerpt,j)=>cached.set(excerpt,vector(embeddings[j])));
        }
        const rows = batch.map(chunk=>({...chunk,embedding:cached.get(chunk.excerpt)}));
        // Save completed work without exposing it to retrieval until the document is ready.
        const [active] = await query(`WITH claimed AS (
          UPDATE documents SET updated=now() WHERE id=$1 AND owner=$2 AND attempt=$3 RETURNING id
        ), saved AS (
          INSERT INTO chunks(document,ordinal,location,excerpt,embedding,model)
          SELECT claimed.id,r.ordinal,r.location,r.excerpt,r.embedding::vector,$5
          FROM claimed CROSS JOIN jsonb_to_recordset($4::jsonb) AS r(ordinal int,location text,excerpt text,embedding text)
          ON CONFLICT(document,ordinal) DO UPDATE SET location=excluded.location,excerpt=excluded.excerpt,embedding=excluded.embedding,model=excluded.model
        ) SELECT id FROM claimed`, [id,owner,attempt,JSON.stringify(rows),ai.model]);
        if (!active) throw new UserError("This indexing attempt is no longer active.",409);
      }
      const [ready] = await query<Document>(`WITH claimed AS (
        UPDATE documents SET status='ready',attempt=NULL,updated=now() WHERE id=$1 AND owner=$2 AND attempt=$3 RETURNING id,name,status,error
      ), pruned AS (
        DELETE FROM chunks WHERE document IN (SELECT id FROM claimed) AND ordinal >= $4
      ) SELECT * FROM claimed`, [id,owner,attempt,chunks.length]);
      return ready ?? { ...doc, status: "indexing", content: undefined };
    } catch (error) {
      const message = error instanceof UserError ? error.message : "Indexing failed. Try again.";
      const [failed] = await query<Document>("UPDATE documents SET status='failed',attempt=NULL,error=$4,updated=now() WHERE id=$1 AND owner=$2 AND attempt=$3 RETURNING id,name,status,error", [id,owner,attempt,message]);
      if (!failed) throw new UserError("This indexing attempt is no longer active.", 409);
      return failed;
    }
  }
  async function remove(owner: string, id: string) {
    const rows = await query("DELETE FROM documents WHERE owner=$1 AND id=$2 RETURNING id", [owner,id]);
    if (!rows.length) throw new UserError("Document not found.", 404);
  }
  async function preview(owner: string, id: string) {
    const [source] = await query<Source>("SELECT c.id,c.document,d.name,c.location,c.excerpt FROM chunks c JOIN documents d ON d.id=c.document WHERE c.id=$1 AND d.owner=$2 AND d.status='ready'", [id,owner]);
    if (!source) throw new UserError("Source not found.", 404);
    return source;
  }
  async function retrieve(owner: string, question: string, ids: string[] | null) {
    const eligible = await query("SELECT id FROM documents WHERE owner=$1 AND status='ready' AND ($2::uuid[] IS NULL OR id=ANY($2)) LIMIT 1", [owner,ids]);
    if (!eligible.length) return [];
    const [embedding] = await ai.embed([question]);
    return query<Source>(`WITH candidates AS (
      SELECT c.id,c.document,d.name,c.location,c.excerpt,c.embedding <=> $3::vector AS distance
      FROM chunks c JOIN documents d ON d.id=c.document
      WHERE d.owner=$1 AND d.status='ready' AND ($2::uuid[] IS NULL OR d.id=ANY($2))
        AND c.model=$4 AND vector_dims(c.embedding)=vector_dims($3::vector)
    ), ranked AS (
      SELECT *,row_number() OVER(PARTITION BY document ORDER BY distance,id) AS rank FROM candidates
    ) SELECT id,document,name,location,excerpt FROM ranked
      ORDER BY distance + (rank-1)*0.025,id LIMIT 8`, [owner,ids,vector(embedding),ai.model]);
  }
  async function sampleSources(owner: string, ids: string[] | null) {
    return query<Source>(`WITH scoped AS (
      SELECT id,name,count(*) OVER () AS documents FROM documents
      WHERE owner=$1 AND status='ready' AND ($2::uuid[] IS NULL OR id=ANY($2))
    ), passages AS (
      SELECT c.id,c.document,d.name,c.location,c.excerpt,
        row_number() OVER (PARTITION BY c.document ORDER BY c.ordinal) AS position,
        count(*) OVER (PARTITION BY c.document) AS total,
        greatest(1,24/d.documents) AS budget
      FROM chunks c JOIN scoped d ON d.id=c.document
    )
    SELECT id,document,name,location,excerpt FROM passages
    WHERE EXISTS (
      SELECT 1 FROM generate_series(0,least(budget,total)-1) AS sample(step)
      WHERE position=1+round(step*(total-1)::numeric/greatest(1,least(budget,total)-1))
    )
    ORDER BY document,position LIMIT 24`, [owner,ids]);
  }
  async function suggestions(owner: string, ids: string[] | null) {
    const sources = await sampleSources(owner,ids);
    if (!sources.length) return [];
    const files = new Set(sources.map(source => source.document));
    const result = [files.size === 1 ? `Summarize “${sources[0].name.replace(/[“”"]/g,"'")}”.` : "Summarize the selected documents."];
    const topics = new Set<string>();
    for (const source of sources) {
      const heading = source.location.includes(" · ") ? source.location.split(" · ")[0] : source.excerpt.split("\n")[0];
      const topic = heading.replace(/^\s*(?:#{1,6}\s+|\d+[.)]\s+)/,"").trim();
      if (!/^[\p{L}][\p{L}\p{N}\s&()'’/-]{8,64}$/u.test(topic) || topic.split(/\s+/).length < 2) continue;
      const key = topic.toLowerCase();
      if (topics.has(key)) continue;
      topics.add(key);
      result.push(`What do the sources say about ${topic}?`);
      if (result.length === 3) return result;
    }
    if (files.size > 1) result.push("What are the main differences between these documents?");
    return result;
  }
  async function ask(owner: string, question: string, ids: string[] | null) {
    const overview = overviewRequest.test(question);
    const sources = overview ? await sampleSources(owner,ids) : await retrieve(owner,question,ids);
    const refusal = { answer: missing, supported: false, sources: [] };
    if (!sources.length) return refusal;
    const evidence = sources.map(({ name,location,excerpt },i) => ({ id:i+1,name,location,excerpt }));
    const result = await ai.answer(question,evidence,overview) as { supported?: unknown; answer?: unknown } | null;
    if (result?.supported !== true || typeof result.answer !== "string") return refusal;
    const answer = result.answer.replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_,group:string)=>group.split(/\s*,\s*/).map(id=>`[${id}]`).join(""));
    const refs = Array.from(answer.matchAll(/\[(\d+)\]/g), match => Number(match[1]));
    if (!refs.length || refs.some(n => n < 1 || n > sources.length)) return refusal;
    return { answer, supported: true, sources: [...new Set(refs)].map(n => {
      const { id, name, location, document } = sources[n-1];
      return { number:n, id, name, location, document };
    }) };
  }
  return { list,upload,index,remove,preview,retrieve,ask,suggestions };
}
