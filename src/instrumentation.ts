// Runs once when the Next.js server starts, before it handles any request.
// Node.js-only startup code lives in instrumentation-node.ts (Next.js docs pattern).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
