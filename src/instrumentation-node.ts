// Validates configuration at startup so the server fails fast on invalid environment
// variables: better to crash at startup (visible to monitoring) than to serve with bad config.
try {
  const { serverEnv } = await import("@/lib/config/server-env");
  const { logger } = await import("@/lib/log/logger");
  logger.info({ appEnv: serverEnv.APP_ENV, usdcMint: serverEnv.usdcMint }, "server configuration validated");
} catch (error) {
  // The logger may not exist yet (it depends on valid config), so use stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

export {};
