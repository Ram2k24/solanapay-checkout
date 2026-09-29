import { describe, expect, it } from "vitest";
import { buildSignInMessage, generateNonce, SIGN_IN_STATEMENT } from "@/lib/auth/siws";

describe("buildSignInMessage", () => {
  it("produces the SIWS format line by line", () => {
    const message = buildSignInMessage({
      domain: "localhost:3000",
      address: "DEdD6CafAz6TtKhKhicX26mKszTt5kaq16An485E5XY",
      uri: "http://localhost:3000",
      chainId: "devnet",
      nonce: "oBbLoEldZs",
      issuedAt: new Date("2026-01-15T10:30:00.000Z"),
      expirationTime: new Date("2026-01-15T10:35:00.000Z"),
    });

    expect(message).toBe(
      [
        "localhost:3000 wants you to sign in with your Solana account:",
        "DEdD6CafAz6TtKhKhicX26mKszTt5kaq16An485E5XY",
        "",
        SIGN_IN_STATEMENT,
        "",
        "URI: http://localhost:3000",
        "Version: 1",
        "Chain ID: devnet",
        "Nonce: oBbLoEldZs",
        "Issued At: 2026-01-15T10:30:00.000Z",
        "Expiration Time: 2026-01-15T10:35:00.000Z",
      ].join("\n"),
    );
  });

  it("uses only characters the SIWS statement grammar allows", () => {
    expect(SIGN_IN_STATEMENT).toMatch(/^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;= ]+$/);
  });
});

describe("generateNonce", () => {
  it("is alphanumeric and at least 8 characters (SIWS requirement)", () => {
    expect(generateNonce()).toMatch(/^[A-Za-z0-9]{8,}$/);
  });

  it("is unique per call", () => {
    const nonces = new Set(Array.from({ length: 100 }, generateNonce));
    expect(nonces.size).toBe(100);
  });
});
