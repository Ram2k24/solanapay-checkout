import { describe, expect, it } from "vitest";
import { groupAddress, shortenAddress } from "@/lib/solana/address";

const ADDRESS = "4dqHv2ZtAFhz27n3DEugWzWekC2fLFUvdS496JzQQhZT";

describe("address display", () => {
  it("groups the full address in fours, losing no character", () => {
    const groups = groupAddress(ADDRESS);
    expect(groups.slice(0, 3)).toEqual(["4dqH", "v2Zt", "AFhz"]);
    expect(groups.at(-1)).toBe("QhZT");
    expect(groups.join("")).toBe(ADDRESS);
    expect(groups.every((g) => g.length === 4)).toBe(true); // 44 characters
  });

  it("keeps a shorter last group", () => {
    expect(groupAddress("abcdefghij")).toEqual(["abcd", "efgh", "ij"]);
  });

  it("shortens for compact display", () => {
    expect(shortenAddress(ADDRESS)).toBe("4dqH…QhZT");
  });
});
