import { isAddress } from "@solana/kit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { issueChallenge } from "@/lib/auth/challenge";
import { parseJsonBody } from "@/lib/http/api";
import { enforceRateLimit } from "@/lib/http/rate-limit";
import { assertSameOrigin, clientIp } from "@/lib/http/request";
import { route } from "@/lib/http/route";

const bodySchema = z.object({
  walletAddress: z.string().refine(isAddress, "invalid Solana address"),
});

// Step 1 of sign-in: returns the message the wallet must sign.
export const POST = route("auth.nonce", async (request) => {
  assertSameOrigin(request);
  await enforceRateLimit(`auth:nonce:${clientIp(request)}`, 10, 60);
  const { walletAddress } = await parseJsonBody(request, bodySchema);

  const challenge = await issueChallenge(walletAddress);
  return NextResponse.json(challenge);
});
