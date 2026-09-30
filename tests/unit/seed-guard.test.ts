import { describe, expect, it } from "vitest";
import { seedRefusal } from "@/lib/dev/seed-guard";

const LOCAL = "postgresql://u:p@localhost:5432/solanapay?schema=public";

describe("seedRefusal", () => {
  it("allows development against a local, non-test database", () => {
    expect(seedRefusal({ APP_ENV: "development", DATABASE_URL: LOCAL })).toBeNull();
    expect(seedRefusal({ APP_ENV: "development", DATABASE_URL: "postgresql://u:p@127.0.0.1/solanapay" })).toBeNull();
  });

  it.each([
    ["production", { APP_ENV: "production", DATABASE_URL: LOCAL }],
    ["test", { APP_ENV: "test", DATABASE_URL: LOCAL }],
    ["missing APP_ENV", { DATABASE_URL: LOCAL }],
    ["remote host", { APP_ENV: "development", DATABASE_URL: "postgresql://u:p@db.neon.tech/solanapay" }],
    ["a host that merely starts with localhost", { APP_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost.evil.example/db" }],
    ["test database", { APP_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost/solanapay_test" }],
    ["invalid URL", { APP_ENV: "development", DATABASE_URL: "not a url" }],
  ])("refuses %s", (_label, env) => {
    expect(seedRefusal(env)).not.toBeNull();
  });
});
