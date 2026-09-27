import type { z } from "zod";

// Validates environment variables against a schema.
// On failure, reports variable names and rules only, never values (they may be secrets).
export function parseEnv<T extends z.ZodType>(schema: T, input: unknown, label: string): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid ${label} environment configuration:\n${problems}\nSee .env.example.`);
  }
  return result.data;
}
