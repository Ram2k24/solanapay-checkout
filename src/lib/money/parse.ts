// Parses a decimal amount typed by a person ("10", "10.5", "0.000001") into integer
// token base units, using string and bigint arithmetic only (never floating point).
//   parseAmount("10.00", 6) -> { ok: true, value: 10_000_000n }

export type ParseAmountResult =
  | { ok: true; value: bigint }
  | { ok: false; reason: "format" | "too-many-decimals" | "not-positive" | "too-large" };

const AMOUNT_PATTERN = /^(\d{1,15})(?:\.(\d+))?$/;

export function parseAmount(input: string, decimals: number, max?: bigint): ParseAmountResult {
  const match = AMOUNT_PATTERN.exec(input);
  if (!match) return { ok: false, reason: "format" }; // rejects "", " 1", "-1", "1e3", "1,000", ".5", "1."

  const [, whole = "", fraction = ""] = match;
  if (fraction.length > decimals) return { ok: false, reason: "too-many-decimals" };

  const value = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (value <= 0n) return { ok: false, reason: "not-positive" };
  if (max !== undefined && value > max) return { ok: false, reason: "too-large" };
  return { ok: true, value };
}
