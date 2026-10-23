import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// AES-256-GCM. Stored format: v1.<iv>.<tag>.<ciphertext>, each part base64url.

function key(raw = env.encryptionKey()): Buffer {
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return buf;
}

export function encrypt(plaintext: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function decrypt(payload: string, rawKey?: string): string {
  const [version, iv, tag, ct] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

// Signed, expiring tokens for OAuth `state`.
export function sign(data: object, ttlSeconds = 600, rawKey?: string): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ttlSeconds * 1000 })).toString("base64url");
  const mac = createHmac("sha256", key(rawKey)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(token: string, rawKey?: string): T {
  const [body, mac] = token.split(".");
  if (!body || !mac) throw new Error("Malformed state");
  const expected = createHmac("sha256", key(rawKey)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("Bad state signature");
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (typeof data.exp !== "number" || data.exp < Date.now()) throw new Error("State expired");
  return data as T;
}
