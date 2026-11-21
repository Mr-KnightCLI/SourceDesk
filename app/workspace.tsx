"use client";
import { useCallback,useEffect,useRef,useState,type FormEvent } from "react";
import { ArrowDownToLine,ArrowRight,ArrowUp,BookOpen,Check,ChevronRight,FileText,Layers3,LoaderCircle,LogOut,Plus,RotateCw,Trash2,X } from "lucide-react";
import { demoAnswer,demoExcerpt,questions,samples,type Answer } from "../lib/demo";
import type { Document } from "../lib/store";

type Ref = Answer["sources"][number];
type Thread = {question:string; result:Answer};
const opening: Thread = {question:questions[0],result:demoAnswer(questions[0],null)};

async function api<T>(path:string, method="GET", body?:object) {
  const response = await fetch("/api/"+path,{
    method,cache:"no-store",headers:body && !(body instanceof FormData)?{"Content-Type":"application/json"}:undefined,
    body:body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data as T;
}

export default function Workspace({uploadLimitMb,workspaceEnabled}: {uploadLimitMb:number;workspaceEnabled:boolean}) {
  const [user,setUser] = useState("");
  const [docs,setDocs] = useState<Document[]>([]);
  const [selection,setScoped] = useState<string[]|null>(null);
  const [suggested,setSuggested] = useState<{key:string;questions:string[]}|null>(null);
  const [threads,setThreads] = useState<Thread[]>([opening]);
  const [source,setSource] = useState<(Ref & {excerpt:string})|null>({...opening.result.sources[0],excerpt:demoExcerpt("standard")});
  const [input,setInput] = useState("");
  const [asking,setAsking] = useState(false);
  const [working,setWorking] = useState(false);
  const [error,setError] = useState("");
  const [auth,setAuth] = useState(false);
  const [register,setRegister] = useState(true);
  const [authError,setAuthError] = useState("");
  const [deleteId,setDeleteId] = useState("");
  const [busyIds,setBusyIds] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const sourcePanel = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const previewRequest = useRef(0);
  const workspaceVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = workspaceVersion.current;
    const documents = await api<Document[]>("documents");
    if (version === workspaceVersion.current) setDocs(documents);
  },[]);
  function enter(email:string) {
    workspaceVersion.current++;
    previewRequest.current++;
    setUser(email); setScoped(null); setThreads(email ? [] : [opening]); setInput(""); setError("");
    setSource(email ? null : {...opening.result.sources[0],excerpt:demoExcerpt("standard")});
    setDocs([]);
  }
  useEffect(() => {
    if (!workspaceEnabled) return;
    const version = workspaceVersion.current;
    api<{user:{email:string}|null}>("session").then(({user})=>{
      if(user && version === workspaceVersion.current) enter(user.email);
    }).catch(()=>{});
  },[workspaceEnabled]);
  useEffect(() => {
    if (user) refresh().catch(error=>setError(error.message));
  },[user,refresh]);
  const listed: Document[] = user ? docs : samples.map(({id,name})=>({id,name,status:"ready",error:null}));
  const ready = listed.filter(doc=>doc.status==="ready");
  const selected = selection?.filter(id=>ready.some(doc=>doc.id===id));
  const scoped = selected?.length ? selected : null;
  const suggestionIds = JSON.stringify(scoped ?? ready.map(doc=>doc.id));
  const suggestionKey = user + suggestionIds;
  useEffect(() => {
    if (!user || suggestionIds === "[]") return;
    let active = true;
    api<string[]>("suggestions","POST",{ids:JSON.parse(suggestionIds)}).then(questions=>{
      if (active) setSuggested({key:suggestionKey,questions});
    }).catch(()=>{ if (active) setSuggested({key:suggestionKey,questions:[]}); });
    return ()=>{ active = false; };
  },[user,suggestionIds,suggestionKey]);
  const inProgress = docs.some(doc=>doc.status==="indexing");
  useEffect(() => {
    if (!user || !inProgress) return;
    const timer = setInterval(()=>refresh().catch(()=>{}),3000);
    return ()=>clearInterval(timer);
  },[user,inProgress,refresh]);
  useEffect(() => {
    if (auth && !dialog.current?.open) dialog.current?.showModal();
    if (!auth && dialog.current?.open) dialog.current.close();
  },[auth]);

  async function login(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(""); setWorking(true);
    const form = new FormData(event.currentTarget);
    try {
      const {user} = await api<{user:{email:string}}>("session","POST",{email:form.get("email"),password:form.get("password"),register});
      enter(user.email); setAuth(false);
    } catch (error) { setAuthError((error as Error).message); }
    finally { setWorking(false); }
  }
  async function index(id:string) {
    setBusyIds(ids=>[...ids,id]);
    setDocs(list=>list.map(doc=>doc.id===id?{...doc,status:"indexing",error:null}:doc));
    try { await api("documents/"+id,"POST"); }
    finally {
      setBusyIds(ids=>ids.filter(value=>value!==id));
      await refresh();
    }
  }
  async function upload(file:File) {
    if (file.size > uploadLimitMb * 1024 * 1024) throw new Error(`This file exceeds the ${uploadLimitMb} MB limit.`);
    const form = new FormData();
    form.set("file",file);
    const doc = await api<Document>("documents","POST",form);
    setDocs(list=>[...list,doc]);
    await index(doc.id);
  }
  async function addSamples() {
    setWorking(true); setError("");
    try {
      const existing = new Set(docs.map(doc=>doc.name));
      for (const sample of samples) {
        if (existing.has(sample.name)) continue;
        const response = await fetch("/samples/"+encodeURIComponent(sample.name));
        if (!response.ok) throw new Error("The sample file is unavailable.");
        await upload(new File([await response.blob()],sample.name));
      }
    } catch(error) { setError((error as Error).message); }
    finally { setWorking(false); }
  }
  async function remove(id:string) {
    setDeleteId("");
    try {
      await api("documents/"+id,"DELETE");
      previewRequest.current++;
      setSource(value=>value?.document===id?null:value);
      setThreads(items=>items.filter(item=>!item.result.sources.some(ref=>ref.document===id)));
      setScoped(ids=>{
        const remaining = ids?.filter(value=>value!==id);
        return remaining?.length ? remaining : null;
      });
      await refresh();
    } catch(error) { setError((error as Error).message); }
  }
  async function ask(question:string) {
    question=question.trim();
    if (!question || asking || (user && !ready.length)) return;
    if (!user && !questions.some(example=>example===question)) {
      setError("The demo supports the three example questions. Sign in to ask your own.");
      return;
    }
    const version = workspaceVersion.current;
    setAsking(true); setError("");
    try {
      const result = user ? await api<Answer>("ask","POST",{question,ids:scoped}) : demoAnswer(question,scoped);
      if (version !== workspaceVersion.current) return;
      setThreads(items=>[...items,{question,result}]); setInput("");
      if (!result.supported) { previewRequest.current++; setSource(null); }
      requestAnimationFrame(()=>end.current?.scrollIntoView({block:"nearest"}));
    } catch(error) { setError((error as Error).message); }
    finally { setAsking(false); }
  }
  async function open(ref:Ref) {
    const request = ++previewRequest.current;
    setError("");
    try {
      const excerpt = user ? (await api<{excerpt:string}>("source/"+ref.id)).excerpt : demoExcerpt(ref.id);
      if(request!==previewRequest.current) return;
      setSource({...ref,excerpt});
      if (window.matchMedia("(max-width: 980px)").matches) {
        requestAnimationFrame(()=>{sourcePanel.current?.focus({preventScroll:true});sourcePanel.current?.scrollIntoView({block:"start"});});
      }
    } catch(error) { if(request===previewRequest.current) setError((error as Error).message); }
  }
  function toggle(id:string) {
    const next = scoped?.includes(id) ? scoped.filter(item=>item!==id) : [...(scoped ?? []),id];
    setScoped(next.length ? next : null);
  }

  const exampleQuestions = user ? (suggested?.key === suggestionKey ? suggested.questions : []) : questions;
  const previewRefs = (source ? [...threads].reverse().find(item=>item.result.sources.some(ref=>ref.id===source.id)) : threads.at(-1))?.result.sources ?? [];
  return <div className="shell">
    <aside className="sidebar" aria-label="Document library">
      <div className="brand"><div className="mark"><Layers3 size={24} strokeWidth={1.7}/></div><span>SourceDesk</span></div>
      <div className="library">
        <div className="side-heading"><h2>Documents</h2><span>{listed.length}</span></div>
        {workspaceEnabled&&<button type="button" className="upload" disabled={working} onClick={()=>user?fileInput.current?.click():setAuth(true)}><Plus size={17}/> Upload document</button>}
        <input hidden type="file" ref={fileInput} accept=".pdf,.docx,.txt,.md,.markdown" onChange={event=>{
          const file=event.target.files?.[0]; event.target.value="";
          if(file){setWorking(true);setError("");upload(file).catch(error=>setError(error.message)).finally(()=>setWorking(false));}
        }}/>
        {workspaceEnabled&&<p className="file-help">PDF, DOCX, TXT, MD · up to {uploadLimitMb} MB</p>}
        <button type="button" className="scope-all" aria-pressed={scoped===null} onClick={()=>setScoped(null)}><Layers3 size={16}/> All indexed documents {scoped===null&&<Check size={15}/>}</button>
        <div className="doc-list">{listed.map(doc=><div key={doc.id} className="doc">
          <div className="doc-row">
            <button type="button" title={doc.name} className="doc-select" disabled={doc.status!=="ready"} aria-pressed={scoped?.includes(doc.id)??false} onClick={()=>toggle(doc.id)}>
              <FileText size={18}/><span><strong>{doc.name}</strong><small>{busyIds.includes(doc.id)||doc.status==="indexing"?(doc.processed?`Indexing · ${doc.processed} passages processed`:"Indexing…"):doc.status==="ready"?"Indexed":doc.status==="pending"?"Awaiting indexing":"Indexing failed"}</small></span>
              {scoped?.includes(doc.id)&&<Check size={15}/>}
            </button>
            {user&&<button type="button" className="icon" disabled={asking} aria-label={"Delete "+doc.name} onClick={()=>setDeleteId(doc.id)}><Trash2 size={15}/></button>}
          </div>
          {doc.error&&<p className="doc-error">{doc.error}</p>}
          {deleteId===doc.id?<div className="small-actions"><button type="button" onClick={()=>remove(doc.id)}>Delete file</button><button type="button" onClick={()=>setDeleteId("")}>Cancel</button></div>:
          user&&doc.status!=="ready"&&!busyIds.includes(doc.id)&&<button type="button" className="retry" onClick={()=>index(doc.id).catch(error=>setError(error.message))}><RotateCw size={12}/> {doc.status==="pending"?"Index now":"Retry indexing"}</button>}
        </div>)}</div>
        {user&&!samples.every(sample=>docs.some(doc=>doc.name===sample.name))&&<button className="sample-load" disabled={working} onClick={addSamples}><Plus size={15}/> Add sample documents</button>}
      </div>
      <div className="account">
        <div><strong>{user||"Sample workspace"}</strong><small>{user?"Private workspace":"Interactive demo"}</small></div>
        {user?<button type="button" className="icon" disabled={working||asking||busyIds.length>0} title="Sign out" aria-label="Sign out" onClick={()=>api("session","DELETE").then(()=>enter("")).catch(error=>setError(error.message))}><LogOut size={17}/></button>:
        workspaceEnabled&&<button type="button" className="plain sign-in" onClick={()=>{setRegister(false);setAuth(true);}}>Sign in <ChevronRight size={14}/></button>}
      </div>
    </aside>
    <main>
      <header className="main-header"><div><h1>Document workspace</h1><p>Ask questions and trace answers back to your documents.</p></div>
      {!workspaceEnabled&&<span className="availability">Demo mode · Sign-in and uploads are offline until a database is connected.</span>}
      {workspaceEnabled&&!user&&<button type="button" className="plain" onClick={()=>{setRegister(true);setAuth(true);}}>Create workspace <ArrowRight size={15}/></button>}</header>
      <div className="desk">
        <section className="conversation" aria-label="Questions and answers">
          <div className="pane-header"><h2>Ask your documents</h2><span>{scoped===null?"All indexed documents":scoped.length+" selected"}</span></div>
          <div className="transcript" aria-live="polite">
            {threads.length===0&&<div className="empty"><BookOpen size={24}/><h3>Start with a question</h3><p>{ready.length?"Choose an example or write a question below.":"Upload and index a document to ask your first question."}</p></div>}
            {threads.map(({question,result},i)=><article key={i} className="thread">
              <div className="question"><small>Question</small><h3>{question}</h3></div>
              <div className="answer"><div className="answer-label"><Layers3 size={16}/> {result.supported?"SourceDesk answer":"Insufficient evidence"}</div>
                <div className="answer-text">{result.answer.split("\n\n").map((paragraph,j)=><p key={j}>{paragraph.split(/(\[\d+\])/g).map((part,k)=>{
                  const ref = /^\[\d+\]$/.test(part)?result.sources.find(item=>item.number===Number(part.slice(1,-1))):null;
                  return ref?<button className="cite" key={k} aria-label={"Citation "+ref.number+": "+ref.name+", "+ref.location} aria-pressed={source?.id===ref.id} onClick={()=>open(ref)}>{ref.number}</button>:part;
                })}</p>)}</div>
              </div>
            </article>)}
            {asking&&<div className="working" role="status"><LoaderCircle className="spin" size={18}/> Reading your sources…</div>}
            <div ref={end}/>
          </div>
          <div className="bottom">
            {exampleQuestions.length>0&&<div className="examples"><h3>Try a question</h3>{exampleQuestions.map(question=><button type="button" key={question} disabled={asking} onClick={()=>ask(question)}>{question}<ArrowRight size={15}/></button>)}</div>}
            {error&&<p className="error" role="alert">{error}</p>}
            <form className="composer" onSubmit={event=>{event.preventDefault();ask(input);}}>
              <input aria-label="Question" placeholder="Ask a question about your documents…" value={input} maxLength={1200} onChange={event=>setInput(event.target.value)}/>
              <button type="submit" className="send" disabled={!input.trim()||asking||(!!user&&!ready.length)} aria-label="Ask question"><ArrowUp size={19}/></button>
            </form>
            <p className="composer-note">{user?"Answers use excerpts from the selected documents.":workspaceEnabled?"Demo uses prewritten answers. Sign in to upload files and ask your own questions.":"Demo uses prewritten answers for the sample documents."}</p>
          </div>
        </section>
        <aside className="source-pane" aria-label="Source preview" tabIndex={-1} ref={sourcePanel}>
          <div className="pane-header"><h2><BookOpen size={17}/> Source preview</h2>{source&&<button type="button" className="icon" aria-label="Close source preview" onClick={()=>{previewRequest.current++;setSource(null);}}><X size={17}/></button>}</div>
          {source?<div className="source-body"><div className="source-title"><FileText size={21}/><div><h3>{source.name}</h3><p>{source.location}</p></div></div>
            <div className="excerpt"><div><span className="cite cite-static">{source.number}</span> Supporting excerpt</div><blockquote>{source.excerpt}</blockquote></div>
            {!user&&<a className="download" href={"/samples/"+encodeURIComponent(source.name)} download><ArrowDownToLine size={15}/> Download sample</a>}
          </div>:<div className="empty source-empty"><BookOpen size={21}/><p>Select a citation to see the original excerpt here.</p></div>}
          {previewRefs.length>0&&<div className="source-index"><h3>Cited in this answer</h3>{previewRefs.map(ref=><button key={ref.id} type="button" aria-pressed={source?.id===ref.id} onClick={()=>open(ref)}>
            <span className="cite cite-static">{ref.number}</span><span>{ref.name}<small>{ref.location}</small></span><ChevronRight size={14}/>
          </button>)}</div>}
        </aside>
      </div>
    </main>
    <dialog ref={dialog} onClose={()=>setAuth(false)}>
      <div className="dialog-header"><h2>{register?"Create a workspace":"Sign in to SourceDesk"}</h2><button type="button" className="icon" aria-label="Close sign in" onClick={()=>setAuth(false)}><X size={19}/></button></div>
      <form onSubmit={login} className="auth-form">
        <label>Email<input name="email" type="email" maxLength={254} required autoComplete="email"/></label>
        <label>Password<input name="password" type="password" minLength={12} maxLength={128} required autoComplete={register?"new-password":"current-password"}/></label>
        {register&&<small>Use at least 12 characters.</small>}
        {authError&&<p role="alert" className="error">{authError}</p>}
        <button className="upload" disabled={working}>{working?"Please wait…":register?"Create account":"Sign in"}</button>
        <button type="button" className="plain" onClick={()=>{setAuthError("");setRegister(!register);}}>{register?"Already have an account? Sign in":"New to SourceDesk? Create an account"}</button>
      </form>
    </dialog>
  </div>;
}
