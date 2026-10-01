import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  isAddress,
  isOffCurveAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Base64EncodedWireTransaction,
  type BlockhashLifetimeConstraint,
} from "@solana/kit";
import {
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import type { Invoice } from "@/generated/prisma/client";
import { CIRCLE_USDC_MINT, ENABLED_NETWORKS, USDC_DECIMALS, type SolanaNetwork } from "@/lib/config/networks";

// Solana Pay Transaction Request: the unsigned payment transaction a wallet receives
// after POSTing the customer's account to our endpoint. Spec: solana-foundation/pay,
// typescript/packages/solana-pay/spec/SPEC.md ("Transaction Request").
//
// Invariant: the only input from outside is the customer's account. Every
// payment-critical term (recipient, mint, decimals, amount, reference, network) is
// read from the persisted invoice row passed in by the caller, so a request body can
// never influence what the customer pays or to whom.
//
// The server never signs: the customer is the fee payer and the only signer, and the
// signature slot is left empty for the wallet. The wallet replaces the blockhash.

// The stored invoice columns the transaction is built from (a Prisma Invoice row).
export type StoredInvoiceTerms = Pick<
  Invoice,
  "network" | "tokenMint" | "tokenDecimals" | "amount" | "recipientWallet" | "reference"
>;

export type TransactionRequestErrorCode = "InvalidCustomerAccount" | "CustomerIsRecipient" | "UnsupportedInvoiceTerms";

export class TransactionRequestError extends Error {
  constructor(readonly code: TransactionRequestErrorCode) {
    super(code);
    this.name = "TransactionRequestError";
  }
}

const NETWORK_FROM_DB = { DEVNET: "devnet", TESTNET: "testnet", MAINNET: "mainnet" } as const satisfies Record<
  Invoice["network"],
  SolanaNetwork
>;

// Defence in depth: the invoice was validated when it was created, but a transaction
// is only ever built for an enabled network and Circle's USDC mint for that network.
function assertSupportedTerms(invoice: StoredInvoiceTerms): void {
  const network = NETWORK_FROM_DB[invoice.network];
  const usdcMint = network === "testnet" ? undefined : CIRCLE_USDC_MINT[network];
  const supported =
    ENABLED_NETWORKS.includes(network) &&
    invoice.tokenMint === usdcMint &&
    invoice.tokenDecimals === USDC_DECIMALS &&
    invoice.amount > 0n &&
    isAddress(invoice.recipientWallet) &&
    isAddress(invoice.reference);
  if (!supported) throw new TransactionRequestError("UnsupportedInvoiceTerms");
}

// The customer must be a normal wallet (an on-curve public key that can sign), and
// not the merchant paying themselves. Exported so the route can reject a bad account
// before fetching a blockhash; the builder checks again regardless.
export function parseCustomerAccount(customerAccount: string, invoice: StoredInvoiceTerms): Address {
  if (!isAddress(customerAccount) || isOffCurveAddress(customerAccount)) {
    throw new TransactionRequestError("InvalidCustomerAccount");
  }
  if (customerAccount === invoice.recipientWallet) throw new TransactionRequestError("CustomerIsRecipient");
  return customerAccount;
}

// Builds the unsigned payment transaction (version 0):
//   1. create the merchant's USDC token account if it doesn't exist (idempotent; customer pays rent)
//   2. transferChecked of exactly invoice.amount from the customer's USDC account to the
//      merchant's, with the invoice reference as an extra read-only, non-signer account
export async function buildPaymentTransaction(
  storedInvoice: StoredInvoiceTerms,
  customerAccount: string,
  blockhash: BlockhashLifetimeConstraint,
): Promise<Base64EncodedWireTransaction> {
  assertSupportedTerms(storedInvoice);
  const customer = parseCustomerAccount(customerAccount, storedInvoice);
  const recipient = address(storedInvoice.recipientWallet);
  const mint = address(storedInvoice.tokenMint);

  // Placeholder signer: tells Kit the customer must sign, without any key. It can never sign.
  const payer = createNoopSigner(customer);
  const [source] = await findAssociatedTokenPda({ owner: customer, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  const [destination] = await findAssociatedTokenPda({ owner: recipient, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });

  const createDestination = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner: recipient, mint });
  const transfer = getTransferCheckedInstruction({
    source,
    mint,
    destination,
    authority: payer,
    amount: storedInvoice.amount,
    decimals: storedInvoice.tokenDecimals,
  });
  // Solana Pay reference: appended to the transfer instruction's accounts (spec).
  const transferWithReference = {
    ...transfer,
    accounts: [...transfer.accounts, { address: address(storedInvoice.reference), role: AccountRole.READONLY }],
  };

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions([createDestination, transferWithReference], m),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}
