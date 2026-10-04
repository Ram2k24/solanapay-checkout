// "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" -> "7xKX…gAsU"
export function shortenAddress(address: string, chars = 4): string {
  return address.length <= chars * 2 + 1 ? address : `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

// "4dqHv2ZtAFhz27n3DE…" -> ["4dqH", "v2Zt", "AFhz", ...]: the full address in groups of 4,
// easier to compare character by character before confirming a payout wallet.
export function groupAddress(address: string, size = 4): string[] {
  return address.match(new RegExp(`.{1,${size}}`, "g")) ?? [];
}
