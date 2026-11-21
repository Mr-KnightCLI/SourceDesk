import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { query } from "./db";
import { UserError } from "./extract";

const derive = promisify(scrypt);
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const cookieName = "sourcedesk_session";

export async function authenticate(email: unknown, password: unknown, register: boolean) {
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.length > 254 ||
      typeof password !== "string" || password.length < 12 || password.length > 128) {
    throw new UserError("Enter a valid email and a password with 12–128 characters.");
  }
  email = email.trim().toLowerCase();
  let account: {id:string; email:string; password:string|null} | undefined;
  if (register) {
    const salt = randomBytes(16).toString("hex");
    const digest = await derive(password,salt,64) as Buffer;
    [account] = await query<typeof account>("INSERT INTO accounts(email,password) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id,email,password",[email,salt+":"+digest.toString("hex")]);
    if (!account) throw new UserError("An account already exists for this email.",409);
  } else {
    [account] = await query<typeof account>("SELECT id,email,password FROM accounts WHERE email=$1",[email]);
    const [salt,value] = account?.password?.split(":") ?? ["no-account","0".repeat(128)];
    const digest = await derive(password,salt,64) as Buffer;
    if (!account?.password || !timingSafeEqual(digest,Buffer.from(value,"hex"))) throw new UserError("Email or password is incorrect.",401);
  }
  const token = randomBytes(32).toString("hex");
  await query("INSERT INTO sessions(token_hash,owner) VALUES($1,$2)",[hash(token),account.id]);
  return { token,email:account.email };
}
export async function identity(token?: string) {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [account] = await query<{id:string;email:string}>(
    "SELECT a.id,a.email FROM sessions s JOIN accounts a ON a.id=s.owner WHERE s.token_hash=$1 AND s.expires>now() AND a.password IS NOT NULL", [hash(token)]);
  return account ?? null;
}
export async function signOut(token?: string) {
  if (token) await query("DELETE FROM sessions WHERE token_hash=$1",[hash(token)]);
}
