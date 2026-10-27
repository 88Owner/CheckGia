import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { UserRole } from "../../../shared/types";

function b64url(input: Buffer | string): string {
  const buffer = typeof input === "string" ? Buffer.from(input) : input;
  return buffer.toString("base64url");
}

export interface AccessClaims {
  sub: string;
  username: string;
  role: UserRole;
  exp: number;
}

export function signAccessToken(claims: Omit<AccessClaims, "exp">, secret: string, ttlSec: number): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...claims, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const signature = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${signature}`;
}

export function verifyAccessToken(token: string, secret: string): AccessClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessClaims;
    if (!claims.sub || !claims.exp || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
