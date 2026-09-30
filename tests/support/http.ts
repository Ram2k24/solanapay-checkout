import { NextRequest } from "next/server";
import { POST as nonce } from "@/app/api/auth/nonce/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { POST as createMerchant } from "@/app/api/merchant/route";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { createTestWallet } from "./wallet";

export const APP = "http://localhost:3000";
let ipCounter = 0;

// A request as our own pages would send it. Each call uses a fresh client IP so
// per-IP rate limits don't interfere between tests.
export function apiRequest(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; origin?: string | null; headers?: Record<string, string> } = {},
) {
  ipCounter += 1;
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`, ...init.headers });
  if (init.origin !== null) headers.set("origin", init.origin ?? APP);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(`${APP}${path}`, {
    method: init.method ?? "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export async function json(response: Response) {
  return (await response.json()) as Record<string, any>;
}

// Signs in a fresh throwaway wallet; returns its session cookie.
export async function signInNewWallet() {
  const wallet = await createTestWallet();
  const challenge = await json(await nonce(apiRequest("/api/auth/nonce", { body: { walletAddress: wallet.address } })));
  const response = await verify(
    apiRequest("/api/auth/verify", { body: { nonce: challenge.nonce, signature: await wallet.sign(challenge.message) } }),
  );
  const token = (response.headers.get("set-cookie") ?? "").match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1];
  if (!token) throw new Error("sign-in failed in test helper");
  return { wallet, cookie: `${SESSION_COOKIE}=${token}` };
}

// Signs in and creates a merchant profile (payout wallet = the signed-in wallet).
export async function newMerchant(name = "Test Shop") {
  const user = await signInNewWallet();
  const response = await createMerchant(apiRequest("/api/merchant", { cookie: user.cookie, body: { name } }));
  if (response.status !== 201) throw new Error(`merchant creation failed: ${response.status}`);
  return { ...user, merchant: await json(response) };
}
