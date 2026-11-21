import { NextRequest, NextResponse } from "next/server";
import { authenticate,cookieName,identity,signOut } from "../../../lib/auth";
import { query } from "../../../lib/db";
import { maxBytes, UserError } from "../../../lib/extract";
import { provider } from "../../../lib/provider";
import { store } from "../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 300;
const deploymentUploadLimit = process.env.VERCEL === "1" ? 4 : 10;
const uploadLimit = Math.min(maxBytes,deploymentUploadLimit * 1024 * 1024);
const uploadLimitError = `This file exceeds the ${deploymentUploadLimit} MB limit.`;
type Context = { params: Promise<{path:string[]}> };
const validId = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const json = (data: unknown, status = 200) => NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});

async function readUpload(request: Request) {
  const limit = uploadLimit+65536;
  if (Number(request.headers.get("content-length")) > limit) throw new UserError(uploadLimitError,413);
  const reader = request.body?.getReader();
  if (!reader) throw new UserError("Choose a file to upload.");
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > limit) {
      await reader.cancel();
      throw new UserError(uploadLimitError,413);
    }
    chunks.push(value);
  }
  try {
    return await new Response(Buffer.concat(chunks),{headers:{"Content-Type":request.headers.get("content-type") ?? ""}}).formData();
  } catch { throw new UserError("Choose a file to upload."); }
}

async function handle(request: NextRequest, context: Context) {
  try {
    const [resource,id,...extra] = (await context.params).path;
    if (extra.length) return json({error:"Not found."},404);
    const method = request.method;
    const token = request.cookies.get(cookieName)?.value;
    const origin = request.headers.get("origin");
    const allowedOrigin = process.env.APP_ORIGIN ?? request.nextUrl.origin;
    if (method !== "GET" && origin && origin !== allowedOrigin) throw new UserError("Request origin is not allowed.",403);
    if (resource === "session" && !id) {
      if (method === "GET") return json({user:await identity(token)});
      const cookie = {httpOnly:true,sameSite:"lax" as const,secure:allowedOrigin.startsWith("https://"),path:"/"};
      if (method === "DELETE") {
        await signOut(token);
        const response = json({ok:true});
        response.cookies.set(cookieName,"",{...cookie,maxAge:0});
        return response;
      }
      if (method === "POST") {
        const {email,password,register} = await request.json();
        const user = await authenticate(email,password,register===true);
        const response = json({user:{email:user.email}});
        response.cookies.set(cookieName,user.token,{...cookie,maxAge:604800});
        return response;
      }
    }

    const user = await identity(token);
    if (!user) throw new UserError("Sign in to access your workspace.",401);
    const desk = store(query,provider());
    if (resource === "documents") {
      if (!id && method === "GET") return json(await desk.list(user.id));
      if (!id && method === "POST") {
        const form = await readUpload(request);
        const file = form.get("file");
        if (!(file instanceof File)) throw new UserError("Choose a file to upload.");
        if (file.size > uploadLimit) throw new UserError(uploadLimitError,413);
        return json(await desk.upload(user.id,file.name,Buffer.from(await file.arrayBuffer())),201);
      }
      if (id && validId.test(id) && method === "POST") return json(await desk.index(user.id,id));
      if (id && validId.test(id) && method === "DELETE") {
        await desk.remove(user.id,id);
        return json({ok:true});
      }
    }
    if (resource === "source" && id && validId.test(id) && method === "GET") return json(await desk.preview(user.id,id));
    if ((resource === "ask" || resource === "suggestions") && !id && method === "POST") {
      const {question,ids=null} = await request.json();
      if (ids !== null && (!Array.isArray(ids) || ids.length > 200 || !ids.every(id => typeof id === "string" && validId.test(id)))) throw new UserError("Choose valid documents.");
      if (resource === "suggestions") return json(await desk.suggestions(user.id,ids));
      if (typeof question !== "string" || !question.trim() || question.length > 1200) throw new UserError("Enter a question of up to 1,200 characters.");
      return json(await desk.ask(user.id,question.trim(),ids));
    }
    return json({error:"Not found."},404);
  } catch (error) {
    if (error instanceof UserError) return json({error:error.message},error.status);
    if (error instanceof SyntaxError) return json({error:"Invalid request body."},400);
    console.error("SourceDesk request failed", error instanceof Error ? error.name : "Unknown error");
    return json({error:"The workspace service is unavailable. Check the database configuration or try again."},503);
  }
}

export { handle as GET,handle as POST,handle as DELETE };
