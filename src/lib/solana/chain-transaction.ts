import { getBase58Encoder } from "@solana/kit";

// A landed transaction, reduced to what payment verification needs, with every
// account's role (signer / writable) resolved. Built from the RPC's
// getTransaction(signature, { encoding: "json", maxSupportedTransactionVersion: 0 }).
// We deliberately don't use "jsonParsed": its token parser labels a Solana Pay
// reference as a multisig signer (see docs/payment-flow.md).

export type ChainAccount = { address: string; signer: boolean; writable: boolean };

export type ChainInstruction = { programAddress: string; accounts: ChainAccount[]; data: Uint8Array };

export type ChainTokenBalance = {
  address: string;
  mint: string;
  owner: string | null;
  programAddress: string | null;
  amount: bigint; // base units
};

export type ChainTransaction = {
  signature: string;
  slot: bigint;
  blockTime: Date | null;
  succeeded: boolean;
  instructions: ChainInstruction[]; // top-level only; inner (CPI) instructions are not considered
  preTokenBalances: ChainTokenBalance[];
  postTokenBalances: ChainTokenBalance[];
};

// The RPC result shape we read. Numbers are `bigint` from Kit and `number` in raw JSON
// (test fixtures), so both are accepted and the same code path handles both.
type Num = number | bigint;
type RpcTokenBalance = {
  readonly accountIndex: Num;
  readonly mint: string;
  readonly owner?: string;
  readonly programId?: string;
  readonly uiTokenAmount: { readonly amount: string };
};
export type RpcTransactionJson = {
  readonly slot: Num;
  readonly blockTime: Num | null;
  readonly meta: {
    readonly err: unknown;
    readonly preTokenBalances?: readonly RpcTokenBalance[] | null;
    readonly postTokenBalances?: readonly RpcTokenBalance[] | null;
    readonly loadedAddresses?: { readonly writable: readonly string[]; readonly readonly: readonly string[] };
  } | null;
  readonly transaction: {
    readonly signatures: readonly string[];
    readonly message: {
      readonly accountKeys: readonly string[];
      readonly header: {
        readonly numRequiredSignatures: Num;
        readonly numReadonlySignedAccounts: Num;
        readonly numReadonlyUnsignedAccounts: Num;
      };
      readonly instructions: readonly {
        readonly programIdIndex: Num;
        readonly accounts: readonly Num[];
        readonly data: string; // base58
      }[];
    };
  };
};

export class MalformedTransactionError extends Error {
  constructor(detail: string) {
    super(`malformed transaction: ${detail}`);
    this.name = "MalformedTransactionError";
  }
}

export function toChainTransaction(rpc: RpcTransactionJson): ChainTransaction {
  const { message, signatures } = rpc.transaction;
  const signature = signatures[0];
  if (!rpc.meta || !signature) throw new MalformedTransactionError("missing meta or signature");

  // Account order (Solana message format): static keys first, then (version 0) the
  // addresses loaded from lookup tables: writable ones, then read-only ones.
  // Loaded addresses can never sign.
  const loaded = rpc.meta.loadedAddresses ?? { writable: [], readonly: [] };
  const keys = [...message.accountKeys, ...loaded.writable, ...loaded.readonly];
  const staticCount = message.accountKeys.length;
  const signerCount = Number(message.header.numRequiredSignatures);
  const readonlySigners = Number(message.header.numReadonlySignedAccounts);
  const readonlyNonSigners = Number(message.header.numReadonlyUnsignedAccounts);

  const account = (index: Num): ChainAccount => {
    const i = Number(index);
    const address = keys[i];
    if (address === undefined) throw new MalformedTransactionError(`account index ${i} out of range`);
    if (i >= staticCount) return { address, signer: false, writable: i < staticCount + loaded.writable.length };
    const signer = i < signerCount;
    const writable = signer ? i < signerCount - readonlySigners : i < staticCount - readonlyNonSigners;
    return { address, signer, writable };
  };

  const base58 = getBase58Encoder();
  const balances = (list: readonly RpcTokenBalance[] | null | undefined): ChainTokenBalance[] =>
    (list ?? []).map((b) => ({
      address: account(b.accountIndex).address,
      mint: b.mint,
      owner: b.owner ?? null,
      programAddress: b.programId ?? null,
      amount: BigInt(b.uiTokenAmount.amount),
    }));

  return {
    signature,
    slot: BigInt(rpc.slot),
    blockTime: rpc.blockTime === null ? null : new Date(Number(rpc.blockTime) * 1000),
    succeeded: rpc.meta.err === null,
    instructions: message.instructions.map((ix) => ({
      programAddress: account(ix.programIdIndex).address,
      accounts: ix.accounts.map(account),
      data: new Uint8Array(base58.encode(ix.data)),
    })),
    preTokenBalances: balances(rpc.meta.preTokenBalances),
    postTokenBalances: balances(rpc.meta.postTokenBalances),
  };
}
