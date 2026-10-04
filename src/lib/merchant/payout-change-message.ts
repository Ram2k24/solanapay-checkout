// The message a merchant's wallet signs to confirm a payout wallet change (Phase 11.4,
// decision D5). Built entirely by the server from validated values: no user-written
// text (such as the business name) goes in, so nothing can inject extra lines into what
// the wallet shows. Deliberately not a Sign-In With Solana message, so a wallet can't
// present it as a sign-in.

export type PayoutChangeMessageFields = {
  domain: string; // host[:port] of the app
  address: string; // the signed-in wallet that must sign
  newPayoutWallet: string;
  uri: string;
  chainId: "mainnet" | "testnet" | "devnet";
  nonce: string;
  issuedAt: Date;
  expirationTime: Date;
};

export function buildPayoutChangeMessage(fields: PayoutChangeMessageFields): string {
  return [
    `${fields.domain} asks you to confirm a payout wallet change with your Solana account:`,
    fields.address,
    "",
    "New payout wallet for your SolanaPay Checkout merchant account:",
    fields.newPayoutWallet,
    "",
    "Future invoices will be paid to this wallet. Existing invoices keep their current wallet. " +
      "This request will not trigger a blockchain transaction or cost any fee.",
    "",
    `URI: ${fields.uri}`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt.toISOString()}`,
    `Expiration Time: ${fields.expirationTime.toISOString()}`,
  ].join("\n");
}
