import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 14 (decisions F2, F3): the browser tests' wallet and mock Solana RPC must never
// become part of the app. Nothing under src/ may import from tests/.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("test-only code stays out of the app", () => {
  it("no file under src/ imports from tests/", () => {
    const offenders = sourceFiles("src").filter((file) =>
      // from "…", import "…", import("…") and require("…") alike
      /\b(?:from|import|require)\s*\(?\s*["'][^"']*\btests\//.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
