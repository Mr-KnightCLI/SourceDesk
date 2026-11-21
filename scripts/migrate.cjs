const { readFile } = require("node:fs/promises");
const { Client } = require("pg");

(async () => {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env.local.");
  const db = new Client({ connectionString:process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(await readFile("db/001.sql","utf8"));
    await db.query("COMMIT");
    console.log("Applied 001.sql");
  } finally { await db.end(); }
})().catch(error => { console.error(error.message);process.exitCode=1; });
