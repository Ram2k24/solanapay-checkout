import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/http/security-headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Security headers on every route (Phase 13). Next.js loads .env before this file,
  // and evaluates it at build time, like the NEXT_PUBLIC_* values the pages use.
  async headers() {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
    if (!appUrl || !rpcUrl) throw new Error("NEXT_PUBLIC_APP_URL and NEXT_PUBLIC_SOLANA_RPC_URL must be set (see .env.example).");
    return [
      {
        source: "/:path*",
        headers: securityHeaders({ appUrl, rpcUrl, development: process.env.NODE_ENV === "development" }),
      },
    ];
  },
};

export default nextConfig;
