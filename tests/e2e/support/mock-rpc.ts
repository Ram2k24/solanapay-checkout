// A local stand-in for the Solana JSON-RPC API, for the browser tests only (Phase 14,
// decision F3). The E2E server and the browser both point at it, so no test depends on
// public devnet. It answers as devnet would for an empty chain: the devnet genesis hash
// (the app refuses any other cluster), no balances, no accounts, no transactions.
// Unknown methods fail loudly, so a new RPC call in the app shows up as a test failure.
//
// Never imported by the app; started by playwright.config.ts on 127.0.0.1 only.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { GENESIS_HASH } from "../../../src/lib/config/networks";

const PORT = Number(process.env.MOCK_RPC_PORT ?? 3299);
const SLOT = 400_000_000;
const BLOCKHASH = "GoCkuX6Zpbz5FvXovJu5fZi3tMUjmt8W7T8pWgKBb4Py"; // any valid 32-byte base58 value

type Request = { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown[] };
const context = { slot: SLOT };

const methods: Record<string, (params: unknown[]) => unknown> = {
  getHealth: () => "ok",
  getGenesisHash: () => GENESIS_HASH.devnet,
  getSlot: () => SLOT,
  getBalance: () => ({ context, value: 0 }),
  getTokenAccountsByOwner: () => ({ context, value: [] }),
  getAccountInfo: () => ({ context, value: null }), // a fresh wallet: not on-chain yet
  getLatestBlockhash: () => ({ context, value: { blockhash: BLOCKHASH, lastValidBlockHeight: SLOT + 150 } }),
  getSignaturesForAddress: () => [],
  getSignatureStatuses: (params) => ({ context, value: (params[0] as unknown[]).map(() => null) }),
  getTransaction: () => null,
};

function answer(request: Request) {
  const method = methods[request.method];
  if (!method) {
    console.error(`[mock-rpc] unsupported method: ${request.method}`);
    return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
  }
  return { jsonrpc: "2.0", id: request.id, result: method(request.params ?? []) };
}

function send(res: ServerResponse, status: number, body?: unknown) {
  // The browser calls this from the app's origin (balances), so allow CORS.
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, solana-client",
    "access-control-allow-methods": "POST, GET, OPTIONS",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204);
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  try {
    const body = JSON.parse(await readBody(req)) as Request | Request[];
    send(res, 200, Array.isArray(body) ? body.map(answer) : answer(body));
  } catch {
    send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`[mock-rpc] listening on http://127.0.0.1:${PORT}`));
