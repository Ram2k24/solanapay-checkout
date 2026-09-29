import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as nonce } from "@/app/api/auth/nonce/route";
import { GET as session } from "@/app/api/auth/session/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { resetDatabase } from "../support/db";
import { createTestWallet } from "../support/wallet";

const APP = "http://localhost:3000";
let ipCounter = 0;

// Builds a request as a browser on our own site would send it. Each test gets its
// own client IP so rate-limit counters don't interfere between tests.
function request(path: string, init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; ip?: string } = {}) {
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": init.ip ?? `10.0.0.${ipCounter}` });
  if (init.origin !== null) headers.set("origin", init.origin ?? APP);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(`${APP}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

function sessionCookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const token = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1];
  if (!token) throw new Error("no session cookie set");
  return `${SESSION_COOKIE}=${token}`;
}

async function signIn(wallet: Awaited<ReturnType<typeof createTestWallet>>) {
  const challenge = await json(await nonce(request("/api/auth/nonce", { body: { walletAddress: wallet.address } })));
  const response = await verify(
    request("/api/auth/verify", { body: { nonce: challenge.nonce, signature: await wallet.sign(challenge.message) } }),
  );
  return { challenge, response };
}

beforeEach(async () => {
  ipCounter += 1;
  await resetDatabase();
});

describe("sign-in flow", () => {
  it("signs in, reports the session, and signs out", async () => {
    const wallet = await createTestWallet();
    const { challenge, response } = await signIn(wallet);

    expect(challenge.message).toContain(`${wallet.address}\n`);
    expect(challenge.message).toContain("Chain ID: devnet");
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ walletAddress: wallet.address });

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);

    const cookie = sessionCookieFrom(response);
    const me = await json(await session(request("/api/auth/session", { method: "GET", cookie })));
    expect(me).toMatchObject({ authenticated: true, walletAddress: wallet.address });

    const out = await logout(request("/api/auth/logout", { cookie }));
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toMatch(/Max-Age=0/i);

    // The old cookie no longer works: the session was revoked server-side.
    const after = await json(await session(request("/api/auth/session", { method: "GET", cookie })));
    expect(after).toEqual({ authenticated: false });

    const actions = (await db.auditLog.findMany({ orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["auth.sign_in", "auth.sign_out"]);
  });

  it("stores only a hash of the session token", async () => {
    const { response } = await signIn(await createTestWallet());
    const token = sessionCookieFrom(response).split("=")[1];
    const stored = await db.session.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates the user once and reuses it on later sign-ins", async () => {
    const wallet = await createTestWallet();
    await signIn(wallet);
    await signIn(wallet);
    expect(await db.user.count()).toBe(1);
    expect(await db.session.count()).toBe(2);
  });
});

describe("rejections", () => {
  it("rejects a reused nonce (replay)", async () => {
    const wallet = await createTestWallet();
    const challenge = await json(await nonce(request("/api/auth/nonce", { body: { walletAddress: wallet.address } })));
    const body = { nonce: challenge.nonce, signature: await wallet.sign(challenge.message) };

    expect((await verify(request("/api/auth/verify", { body }))).status).toBe(200);
    const replay = await verify(request("/api/auth/verify", { body }));
    expect(replay.status).toBe(401);
    expect((await json(replay)).error.code).toBe("ChallengeExpired");
  });

  it("rejects an expired challenge", async () => {
    const wallet = await createTestWallet();
    const challenge = await json(await nonce(request("/api/auth/nonce", { body: { walletAddress: wallet.address } })));
    await db.authNonce.update({ where: { nonce: challenge.nonce }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await verify(
      request("/api/auth/verify", { body: { nonce: challenge.nonce, signature: await wallet.sign(challenge.message) } }),
    );
    expect((await json(response)).error.code).toBe("ChallengeExpired");
  });

  it("rejects a challenge signed by a different wallet", async () => {
    const victim = await createTestWallet();
    const attacker = await createTestWallet();
    const challenge = await json(await nonce(request("/api/auth/nonce", { body: { walletAddress: victim.address } })));

    const response = await verify(
      request("/api/auth/verify", { body: { nonce: challenge.nonce, signature: await attacker.sign(challenge.message) } }),
    );
    expect(response.status).toBe(401);
    expect((await json(response)).error.code).toBe("InvalidSignature");
    expect(await db.session.count()).toBe(0);
  });

  it("rejects a signature over a different message", async () => {
    const wallet = await createTestWallet();
    const challenge = await json(await nonce(request("/api/auth/nonce", { body: { walletAddress: wallet.address } })));
    const tampered = challenge.message.replace("devnet", "mainnet");

    const response = await verify(
      request("/api/auth/verify", { body: { nonce: challenge.nonce, signature: await wallet.sign(tampered) } }),
    );
    expect((await json(response)).error.code).toBe("InvalidSignature");
  });

  it("rejects malformed signatures", async () => {
    const wallet = await createTestWallet();
    const challenge = await json(await nonce(request("/api/auth/nonce", { body: { walletAddress: wallet.address } })));
    const response = await verify(request("/api/auth/verify", { body: { nonce: challenge.nonce, signature: "!!!not-base64!!!" } }));
    expect((await json(response)).error.code).toBe("InvalidSignature");
  });

  it("rejects an invalid wallet address", async () => {
    const response = await nonce(request("/api/auth/nonce", { body: { walletAddress: "0xNotSolana" } }));
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("InvalidRequest");
  });

  it("rejects requests from another origin or with no origin (CSRF)", async () => {
    const wallet = await createTestWallet();
    const foreign = await nonce(request("/api/auth/nonce", { body: { walletAddress: wallet.address }, origin: "https://evil.example" }));
    const missing = await nonce(request("/api/auth/nonce", { body: { walletAddress: wallet.address }, origin: null }));
    expect(foreign.status).toBe(403);
    expect(missing.status).toBe(403);
  });

  it("rate-limits challenge requests per IP (10 per minute)", async () => {
    const wallet = await createTestWallet();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await nonce(request("/api/auth/nonce", { body: { walletAddress: wallet.address }, ip: "10.9.9.9" }))).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("treats forged and expired session cookies as signed out", async () => {
    const forged = await json(
      await session(request("/api/auth/session", { method: "GET", cookie: `${SESSION_COOKIE}=${"A".repeat(43)}` })),
    );
    expect(forged).toEqual({ authenticated: false });

    const { response } = await signIn(await createTestWallet());
    const cookie = sessionCookieFrom(response);
    await db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await json(await session(request("/api/auth/session", { method: "GET", cookie })));
    expect(expired).toEqual({ authenticated: false });
  });

  it("returns a request ID and no-store on every response", async () => {
    const response = await session(request("/api/auth/session", { method: "GET" }));
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
