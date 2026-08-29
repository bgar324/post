import type { Request, Response } from "express";
import { parseCookie, stringifySetCookie } from "cookie";
import { config } from "./config";
import { query } from "./db";
import { hashToken, randomToken } from "./crypto";

const SESSION_COOKIE = "post_session";
const SECURE_COOKIE = new URL(config.APP_BASE_URL).protocol === "https:";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
};

type SessionRow = {
  id: string;
  email: string;
  display_name: string;
};

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const cookies = parseCookie(request.headers.cookie ?? "");
  const token = cookies[SESSION_COOKIE];
  if (token === undefined) return null;
  const rows = await query<SessionRow>(
    `select u.id, u.email, u.display_name
     from app_sessions s join app_users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  const row = rows[0];
  return row === undefined ? null : { id: row.id, email: row.email, displayName: row.display_name };
}

export async function deleteSession(request: Request): Promise<void> {
  const token = parseCookie(request.headers.cookie ?? "")[SESSION_COOKIE];
  if (token === undefined) return;
  await query("delete from app_sessions where token_hash = $1", [hashToken(token)]);
}

export async function createSession(response: Response, userId: string): Promise<void> {
  const token = randomToken();
  await query(
    `insert into app_sessions (token_hash, user_id, expires_at)
     values ($1, $2, now() + interval '30 days')`,
    [hashToken(token), userId],
  );
  response.setHeader("Set-Cookie", stringifySetCookie({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIE,
    path: "/",
    maxAge: SESSION_SECONDS,
  }));
}

export function getCookie(request: Request, name: string): string | undefined {
  return parseCookie(request.headers.cookie ?? "")[name];
}

export function setHttpOnlyCookie(response: Response, name: string, value: string, maxAge: number): void {
  response.appendHeader("Set-Cookie", stringifySetCookie({
    name,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIE,
    path: "/",
    maxAge,
  }));
}

export function clearCookie(response: Response, name: string): void {
  response.appendHeader("Set-Cookie", stringifySetCookie({
    name,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: SECURE_COOKIE,
    path: "/",
    maxAge: 0,
  }));
}
