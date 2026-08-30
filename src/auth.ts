import type { Context, Next } from "hono";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "./types";

const COOKIE_NAME = "exco_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

/**
 * Constant-time string comparison to avoid leaking the password via timing.
 * Compares HMAC digests so length differences don't short-circuit.
 */
async function timingSafeEqual(a: string, b: string, key: string): Promise<boolean> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const macA = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(a)));
  const macB = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(b)));
  if (macA.length !== macB.length) return false;
  let diff = 0;
  for (let i = 0; i < macA.length; i++) diff |= macA[i] ^ macB[i];
  return diff === 0;
}

/** Verify a submitted password against the site password secret. */
export function checkPassword(submitted: string, c: Context<AppEnv>): Promise<boolean> {
  const expected = c.env.SITE_PASSWORD ?? "";
  if (!expected) return Promise.resolve(false);
  return timingSafeEqual(submitted, expected, c.env.SESSION_SECRET);
}

/** Issue a signed session cookie after a successful login. */
export async function startSession(c: Context<AppEnv>): Promise<void> {
  const expires = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  await setSignedCookie(c, COOKIE_NAME, String(expires.getTime()), c.env.SESSION_SECRET, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    expires,
  });
}

/** Clear the session cookie. */
export function endSession(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
}

/** True if the request carries a valid, unexpired session. */
export async function isAuthed(c: Context<AppEnv>): Promise<boolean> {
  const value = await getSignedCookie(c, c.env.SESSION_SECRET, COOKIE_NAME);
  if (!value) return false;
  const expiresAt = Number(value);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() < expiresAt;
}

/** Middleware: require a valid session, else redirect to /login. */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  if (await isAuthed(c)) {
    c.set("authed", true);
    return next();
  }
  return c.redirect("/login");
}
