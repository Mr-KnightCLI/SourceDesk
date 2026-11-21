import { Pool } from "pg";
import type { Query } from "./store";

const holder = globalThis as typeof globalThis & { sourceDeskPool?: Pool };
export const query: Query = async (sql, params) => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing.");
  const pool = holder.sourceDeskPool ??= new Pool({connectionString:process.env.DATABASE_URL,max:8});
  return (await pool.query(sql,params)).rows;
};
