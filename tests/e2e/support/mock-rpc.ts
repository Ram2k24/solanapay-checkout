// A local stand-in for the Solana JSON-RPC API, for the browser tests only (Phase 14,
// decision F3). The E2E server and the browser both point at it, so no test depends on
// public devnet. It answers as devnet would: the devnet genesis hash (the app refuses
// any other cluster), and a tiny in-memory ledger of the transactions sent to it.
//
// sendTransaction checks the fee payer's signature like a validator, then "lands" the
// transaction at once (finalized), with token balances computed from its TransferChecked
// instruction, in the same JSON shape as real devnet transactions (see
// tests/fixtures/solana). The app's verification code reads it unchanged; that code
// is also tested against real devnet transactions. Unknown methods fail loudly.
//
// Never imported by the app; started by playwright.config.ts on 127.0.0.1 only.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  getBase58Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  verifySignature,
  type Address,
  type ReadonlyUint8Array,
  type SignatureBytes,
} from "@solana/kit";
import { GENESIS_HASH } from "../../../src/lib/config/networks";
import { E2E_RPC_PORT } from "./env";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const TRANSFER_CHECKED = 12;
const STARTING_TOKEN_BALANCE = 1_000_000_000n; // 1,000 USDC in any account we haven't seen yet
const LAMPORTS = 1_000_000_000; // 1 SOL in every account
const FEE = 5000;
const BLOCKHASH = "GoCkuX6Zpbz5FvXovJu5fZi3tMUjmt8W7T8pWgKBb4Py"; // any valid 32-byte base58 value

const toBase58 = (bytes: ReadonlyUint8Array) => getBase58Decoder().decode(bytes);
let slot = 400_000_000;

type TokenBalance = { accountIndex: number; mint: string; owner: string; programId: string; uiTokenAmount: { amount: string; decimals: number; uiAmount: number; uiAmountString: string } };
type Landed = { signature: string; slot: number; blockTime: number; accountKeys: string[]; result: unknown };

const ledger: Landed[] = []; // newest last
const tokenBalances = new Map<string, bigint>(); // token account -> base units

function tokenBalance(accountIndex: number, mint: string, owner: string, amount: bigint, decimals: number): TokenBalance {
  const ui = Number(amount) / 10 ** decimals;
  return { accountIndex, mint, owner, programId: TOKEN_PROGRAM, uiTokenAmount: { amount: amount.toString(), decimals, uiAmount: ui, uiAmountString: String(ui) } };
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

async function sendTransaction(params: unknown[]): Promise<string> {
  const wire = new Uint8Array(getBase64Encoder().encode(params[0] as string));
  const transaction = getTransactionDecoder().decode(wire);
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  // The app builds version 0 transactions; Kit also knows newer formats this mock doesn't model.
  if (message.version !== "legacy" && message.version !== 0) throw new RpcError(-32602, `Unsupported transaction version ${message.version}`);
  const keys = message.staticAccounts.map(String);
  const feePayer = keys[0]!;

  // Like a validator: the fee payer must have signed exactly these message bytes.
  const signatureBytes = transaction.signatures[feePayer as Address];
  if (!signatureBytes || !(await verifySignature(await getPublicKeyFromAddress(feePayer as Address), signatureBytes as SignatureBytes, transaction.messageBytes))) {
    throw new RpcError(-32003, "Transaction signature verification failure");
  }
  const signature = toBase58(signatureBytes);
  if (ledger.some((t) => t.signature === signature)) throw new RpcError(-32002, "This transaction has already been processed");

  // Token balances, before and after: the TransferChecked moves `amount` from the
  // source to the destination token account. The destination's owner comes from the
  // create-associated-token-account instruction in the same transaction.
  const pre: TokenBalance[] = [];
  const post: TokenBalance[] = [];
  const createAta = message.instructions.find((ix) => keys[ix.programAddressIndex] === ASSOCIATED_TOKEN_PROGRAM);
  for (const ix of message.instructions) {
    const data = ix.data ?? new Uint8Array();
    if (keys[ix.programAddressIndex] !== TOKEN_PROGRAM || data[0] !== TRANSFER_CHECKED) continue;
    const [source, mint, destination, authority] = ix.accountIndices ?? [];
    const amount = new DataView(data.buffer, data.byteOffset + 1, 8).getBigUint64(0, true);
    const decimals = data[9]!;
    const destinationOwner = createAta?.accountIndices?.[2] !== undefined ? keys[createAta.accountIndices[2]]! : "unknown";
    const sourceKey = keys[source!]!;
    const destinationKey = keys[destination!]!;
    const sourceBefore = tokenBalances.get(sourceKey) ?? STARTING_TOKEN_BALANCE;
    const destinationBefore = tokenBalances.get(destinationKey) ?? 0n;
    if (sourceBefore < amount) throw new RpcError(-32002, "Transaction simulation failed: Error processing Instruction 1: custom program error: 0x1");
    tokenBalances.set(sourceKey, sourceBefore - amount);
    tokenBalances.set(destinationKey, destinationBefore + amount);
    pre.push(tokenBalance(source!, keys[mint!]!, keys[authority!]!, sourceBefore, decimals), tokenBalance(destination!, keys[mint!]!, destinationOwner, destinationBefore, decimals));
    post.push(tokenBalance(source!, keys[mint!]!, keys[authority!]!, sourceBefore - amount, decimals), tokenBalance(destination!, keys[mint!]!, destinationOwner, destinationBefore + amount, decimals));
  }

  slot += 1;
  const blockTime = Math.floor(Date.now() / 1000);
  const lamports = keys.map(() => LAMPORTS);
  ledger.push({
    signature,
    slot,
    blockTime,
    accountKeys: keys,
    result: {
      slot,
      blockTime,
      version: message.version === "legacy" ? "legacy" : 0,
      transaction: {
        signatures: [signature],
        message: {
          accountKeys: keys,
          header: {
            numRequiredSignatures: message.header.numSignerAccounts,
            numReadonlySignedAccounts: message.header.numReadonlySignerAccounts,
            numReadonlyUnsignedAccounts: message.header.numReadonlyNonSignerAccounts,
          },
          recentBlockhash: message.lifetimeToken,
          instructions: message.instructions.map((ix) => ({
            programIdIndex: ix.programAddressIndex,
            accounts: ix.accountIndices ?? [],
            data: toBase58(ix.data ?? new Uint8Array()),
            stackHeight: null,
          })),
          addressTableLookups: [],
        },
      },
      meta: {
        err: null,
        status: { Ok: null },
        fee: FEE,
        preBalances: lamports,
        postBalances: lamports.map((l, i) => (i === 0 ? l - FEE : l)),
        preTokenBalances: pre,
        postTokenBalances: post,
        innerInstructions: [],
        loadedAddresses: { readonly: [], writable: [] },
        logMessages: [],
        rewards: [],
        computeUnitsConsumed: 30_000,
      },
    },
  });
  return signature;
}

const context = () => ({ slot });
const status = (t: Landed) => ({ slot: t.slot, confirmations: null, err: null, status: { Ok: null }, confirmationStatus: "finalized" });

const methods: Record<string, (params: unknown[]) => unknown> = {
  getHealth: () => "ok",
  getGenesisHash: () => GENESIS_HASH.devnet,
  getSlot: () => slot,
  getBalance: () => ({ context: context(), value: LAMPORTS }),
  getTokenAccountsByOwner: () => ({ context: context(), value: [] }),
  getAccountInfo: () => ({ context: context(), value: null }), // a fresh wallet: not on-chain yet
  getLatestBlockhash: () => ({ context: context(), value: { blockhash: BLOCKHASH, lastValidBlockHeight: slot + 150 } }),
  sendTransaction,
  getSignaturesForAddress: (params) =>
    ledger
      .filter((t) => t.accountKeys.includes(params[0] as string))
      .reverse()
      .map((t) => ({ signature: t.signature, slot: t.slot, err: null, memo: null, blockTime: t.blockTime, confirmationStatus: "finalized" })),
  getTransaction: (params) => ledger.find((t) => t.signature === params[0])?.result ?? null,
  getSignatureStatuses: (params) => ({
    context: context(),
    value: (params[0] as string[]).map((signature) => {
      const landed = ledger.find((t) => t.signature === signature);
      return landed ? status(landed) : null;
    }),
  }),
};

async function answer(request: { jsonrpc: "2.0"; id: number | string; method: string; params?: unknown[] }) {
  const method = methods[request.method];
  if (!method) {
    console.error(`[mock-rpc] unsupported method: ${request.method}`);
    return { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Method not found: ${request.method}` } };
  }
  try {
    return { jsonrpc: "2.0", id: request.id, result: await method(request.params ?? []) };
  } catch (error) {
    const code = error instanceof RpcError ? error.code : -32603;
    return { jsonrpc: "2.0", id: request.id, error: { code, message: error instanceof Error ? error.message : "Internal error" } };
  }
}

function send(res: ServerResponse, statusCode: number, body?: unknown) {
  // The browser calls this from the app's origin (balances), so allow CORS.
  res.writeHead(statusCode, {
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
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  send(res, 200, Array.isArray(body) ? await Promise.all(body.map(answer)) : await answer(body as Parameters<typeof answer>[0]));
}).listen(E2E_RPC_PORT, "127.0.0.1", () => console.log(`[mock-rpc] listening on http://127.0.0.1:${E2E_RPC_PORT}`));
