import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { serverEnv } from "@/lib/config/server-env";

function createClient() {
  const adapter = new PrismaPg({
    connectionString: serverEnv.DATABASE_URL,
    // Fail fast instead of hanging when the database is slow or unreachable.
    connectionTimeoutMillis: 5_000, // opening a new connection
    query_timeout: 10_000, // client-side: covers a frozen server or network
    statement_timeout: 10_000, // server-side: PostgreSQL cancels long statements
  });
  return new PrismaClient({ adapter });
}

// In development, Next.js reloads modules on every change. Keeping the client on
// globalThis stops each reload from opening a new connection pool.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db = globalForDb.db ?? createClient();

if (serverEnv.APP_ENV !== "production") globalForDb.db = db;
