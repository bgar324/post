import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { config } from "./config";

const encryptionKey = createHash("sha256").update(config.TOKEN_ENCRYPTION_KEY).digest();
const stateKey = createHash("sha256").update(config.SESSION_SECRET).digest();

export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || ivValue === undefined || tagValue === undefined || encryptedValue === undefined) {
    throw new Error("Unsupported encrypted value");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function signState(payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", stateKey).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyState(value: string): unknown {
  const [encoded, signature] = value.split(".");
  if (encoded === undefined || signature === undefined) throw new Error("Invalid OAuth state");
  const expected = createHmac("sha256", stateKey).update(encoded).digest();
  const received = Buffer.from(signature, "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error("Invalid OAuth state signature");
  }
  const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return parsed;
}
