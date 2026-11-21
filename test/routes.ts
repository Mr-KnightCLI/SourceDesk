import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import type { Pool } from "pg";
import { NextRequest } from "next/server";
import { GET,POST,DELETE } from "../app/api/[...path]/route";
import { makePdf } from "./fixture";

export async function checkRoutes(db:PGlite) {
  const server = new PGLiteSocketServer({db,host:"127.0.0.1",port:0});
  await server.start();
  try {
    process.env.DATABASE_URL = "postgresql://postgres@"+server.getServerConn()+"/postgres";
    const origin="http://localhost:3000";
    process.env.APP_ORIGIN=origin;
    async function request(path:string, method:"GET"|"POST"|"DELETE", cookie="", body?:object) {
      const multipart=body instanceof FormData;
      const headers=new Headers({origin});
      if(cookie) headers.set("cookie",cookie);
      if(body&&!multipart) headers.set("content-type","application/json");
      const req=new NextRequest(origin+"/api/"+path,{method,headers,body:multipart?body:body?JSON.stringify(body):undefined});
      return {GET,POST,DELETE}[method](req,{params:Promise.resolve({path:path.split("/")})});
    }
    async function signIn(email:string, register=false) {
      const response=await request("session","POST","",{email,password:"a long test password",register});
      assert.equal(response.status,200,await response.clone().text());
      const cookie=response.headers.get("set-cookie")!;
      assert.match(cookie,/HttpOnly/i);
      assert.match(cookie,/SameSite=Lax/i);
      return cookie.split(";")[0];
    }
    assert.equal((await request("documents","GET")).status,401);
    const email="a@routes.test";
    const a=await signIn(email,true);
    const b=await signIn("b@routes.test",true);
    const body=new FormData();
    body.set("file",new Blob([new Uint8Array(await makePdf(["Overview","The notice period is 14 days."]))]),"Routes.pdf");
    const upload=await request("documents","POST",a,body);
    assert.equal(upload.status,201,await upload.clone().text());
    const {id}=await upload.json();
    const indexed=await request("documents/"+id,"POST",a);
    assert.equal((await indexed.json()).status,"ready");
    const question="What is the notice period?";
    const reply=await request("ask","POST",a,{question});
    const {sources}=await reply.json();
    assert.equal(sources[0]?.location,"Page 2");
    const route="source/"+sources[0].id;
    assert.equal((await (await request(route,"GET",a)).json()).excerpt,"The notice period is 14 days.");
    assert.equal((await request(route,"GET",b)).status,404);
    assert.equal((await request("documents/"+id,"DELETE",b)).status,404);
    assert.equal((await (await request("ask","POST",b,{question,ids:[id]})).json()).supported,false);
    assert.equal((await request("session","DELETE",a)).status,200);
    assert.equal((await request("documents","GET",a)).status,401);
    const returning=await signIn(email);
    assert((await (await request("documents","GET",returning)).json()).some((doc:{id:string})=>doc.id===id));
    assert.equal((await request("documents/"+id,"DELETE",returning)).status,200);
    assert.equal((await request(route,"GET",returning)).status,404);
    console.log("PASS password registration and sign-in, document persistence, signed-in API, and account isolation");
  } finally {
    await (globalThis as typeof globalThis & { sourceDeskPool?: Pool }).sourceDeskPool?.end();
    await server.stop();
  }
}
