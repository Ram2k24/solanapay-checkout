// Formats an integer amount of token base units as a decimal string, using integer
// arithmetic only (no floating point). Examples, for USDC (6 decimals):
//   formatUnits(10_000_000n, 6) === "10.00"      formatUnits(1_234_567n, 6) === "1.234567"
export function formatUnits(amount: bigint, decimals: number, minFractionDigits = 2): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);

  const whole = (abs / base).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  if (fraction.length < minFractionDigits) fraction = fraction.padEnd(minFractionDigits, "0");

  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
