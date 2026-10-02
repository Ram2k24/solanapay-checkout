import { address } from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  TokenInstruction,
  findAssociatedTokenPda,
  getTransferCheckedInstructionDataDecoder,
  getTransferInstructionDataDecoder,
} from "@solana-program/token";
import type { Invoice } from "@/generated/prisma/client";
import type { ChainInstruction, ChainTransaction } from "@/lib/solana/chain-transaction";

// Payment verification, as pure functions: no database, no network. The caller fetches
// the transaction from its own RPC and supplies the stored invoice; nothing here comes
// from a browser.
//
// Step 1, readIncomingTransfer: did this transaction credit the merchant's token
//   account? It's the associated token account (ATA) of the stored recipient wallet for
//   the stored mint under the classic Token program; the Solana Pay spec doesn't allow
//   other accounts. If not, the transaction is irrelevant to this merchant.
// Step 2, matchInvoice: does that credit settle a specific invoice? Only an exact
//   match settles. Anything else that credited the merchant is real money and is
//   recorded for review (unmatched payments), never dropped and never auto-paid.

export type PaymentTerms = Pick<Invoice, "recipientWallet" | "tokenMint" | "tokenDecimals">;

// A top-level Token Transfer/TransferChecked into the merchant's token account.
export type IncomingInstruction = {
  amount: bigint;
  sender: string | null; // owner of the source token account
  // Solana Pay references: extra accounts after the instruction's required ones that are
  // read-only and non-signing (spec). Signers are excluded: wallets may append their own
  // signer there (Phantom does), and a reference never signs.
  references: string[];
};

export type IncomingTransfer = {
  signature: string;
  slot: bigint;
  blockTime: Date | null;
  recipientTokenAccount: string;
  amount: bigint; // net credit to the merchant's token account in this transaction
  senderWallet: string | null;
  instructions: IncomingInstruction[];
  references: string[]; // all references found, in order, without duplicates
};

const TRANSFER_DATA_LENGTH = 9; // discriminator + u64 amount
const TRANSFER_CHECKED_DATA_LENGTH = 10; // discriminator + u64 amount + u8 decimals

export async function readIncomingTransfer(tx: ChainTransaction, terms: PaymentTerms): Promise<IncomingTransfer | null> {
  if (!tx.succeeded) return null; // a failed transaction moves no tokens

  const [ata] = await findAssociatedTokenPda({
    owner: address(terms.recipientWallet),
    mint: address(terms.tokenMint),
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const recipientTokenAccount: string = ata;

  // Net credit from the RPC's balance snapshots: robust to anything else the
  // transaction does. A missing "pre" entry means the account was created here.
  const isMerchantAccount = (b: ChainTransaction["postTokenBalances"][number]) =>
    b.address === recipientTokenAccount &&
    b.mint === terms.tokenMint &&
    (b.programAddress === null || b.programAddress === TOKEN_PROGRAM_ADDRESS) &&
    (b.owner === null || b.owner === terms.recipientWallet);
  const post = tx.postTokenBalances.find(isMerchantAccount)?.amount ?? 0n;
  const pre = tx.preTokenBalances.find(isMerchantAccount)?.amount ?? 0n;
  const amount = post - pre;
  if (amount <= 0n) return null;

  const ownerOf = (tokenAccount: string) =>
    tx.preTokenBalances.find((b) => b.address === tokenAccount && b.mint === terms.tokenMint)?.owner ?? null;

  const instructions = tx.instructions
    .map((ix) => readTransferInto(ix, recipientTokenAccount, terms, ownerOf))
    .filter((ix): ix is IncomingInstruction => ix !== null);

  return {
    signature: tx.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    recipientTokenAccount,
    amount,
    senderWallet: instructions.length === 1 ? instructions[0]!.sender : largestDebitOwner(tx, terms.tokenMint),
    instructions,
    references: [...new Set(instructions.flatMap((ix) => ix.references))],
  };
}

function readTransferInto(
  ix: ChainInstruction,
  destination: string,
  terms: PaymentTerms,
  ownerOf: (tokenAccount: string) => string | null,
): IncomingInstruction | null {
  if (ix.programAddress !== TOKEN_PROGRAM_ADDRESS) return null; // classic Token program only

  let amount: bigint;
  let required: number; // accounts before any references
  if (ix.data[0] === TokenInstruction.TransferChecked && ix.data.length === TRANSFER_CHECKED_DATA_LENGTH) {
    // Accounts: source, mint, destination, authority, ...
    const data = getTransferCheckedInstructionDataDecoder().decode(ix.data);
    if (ix.accounts[1]?.address !== terms.tokenMint || data.decimals !== terms.tokenDecimals) return null;
    if (ix.accounts[2]?.address !== destination) return null;
    amount = data.amount;
    required = 4;
  } else if (ix.data[0] === TokenInstruction.Transfer && ix.data.length === TRANSFER_DATA_LENGTH) {
    // Accounts: source, destination, authority, ... (mint is implied by the accounts)
    if (ix.accounts[1]?.address !== destination) return null;
    amount = getTransferInstructionDataDecoder().decode(ix.data).amount;
    required = 3;
  } else {
    return null;
  }
  if (ix.accounts.length < required) return null;

  const source = ix.accounts[0]!.address;
  const authority = ix.accounts[required - 1]!.address;
  return {
    amount,
    sender: ownerOf(source) ?? authority,
    references: ix.accounts
      .slice(required)
      .filter((a) => !a.signer && !a.writable)
      .map((a) => a.address),
  };
}

// The owner of the token account that lost the most of this mint (for payments that
// didn't come through a recognizable transfer instruction).
function largestDebitOwner(tx: ChainTransaction, mint: string): string | null {
  let best: { owner: string | null; debit: bigint } = { owner: null, debit: 0n };
  for (const pre of tx.preTokenBalances) {
    if (pre.mint !== mint) continue;
    const post = tx.postTokenBalances.find((b) => b.address === pre.address && b.mint === mint)?.amount ?? 0n;
    const debit = pre.amount - post;
    if (debit > best.debit) best = { owner: pre.owner, debit };
  }
  return best.owner;
}

export type InvoiceMatch =
  // Settles the invoice: exactly one transfer carries the reference, and both that
  // transfer and the net credit equal the stored amount.
  | { kind: "settles"; senderWallet: string; late: boolean }
  // The reference is present, but the payment isn't an exact single settlement
  // (over/under payment, or the reference on several transfers).
  | { kind: "amount-mismatch" }
  // The invoice's reference isn't on any transfer into the merchant's account.
  | { kind: "not-this-invoice" };

export function matchInvoice(
  incoming: IncomingTransfer,
  invoice: Pick<Invoice, "reference" | "amount" | "expiresAt">,
): InvoiceMatch {
  const carrying = incoming.instructions.filter((ix) => ix.references.includes(invoice.reference));
  if (carrying.length === 0) return { kind: "not-this-invoice" };

  const [only] = carrying;
  if (carrying.length !== 1 || only!.amount !== invoice.amount || incoming.amount !== invoice.amount || !only!.sender) {
    return { kind: "amount-mismatch" };
  }
  // Paid after expiry: still settles (the money arrived; never drop it), flagged for
  // review. An unknown block time can't prove it was on time, so it's flagged too.
  const late = incoming.blockTime === null || incoming.blockTime > invoice.expiresAt;
  return { kind: "settles", senderWallet: only!.sender, late };
}
