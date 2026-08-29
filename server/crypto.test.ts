import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  signState,
  verifyState,
} from "./crypto";

describe("server credential security", () => {
  it("round-trips encrypted tokens without storing plaintext", () => {
    const plaintext = "refresh-token-value";
    const encrypted = encryptSecret(plaintext);

    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("rejects a modified OAuth state", () => {
    const state = signState({ nonce: "nonce", expiresAt: Date.now() + 60_000 });
    const separator = state.lastIndexOf(".");
    const signature = state.slice(separator + 1);
    const modified = `${state.slice(0, separator + 1)}${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`;

    expect(() => verifyState(modified)).toThrow("Invalid OAuth state signature");
  });
});
