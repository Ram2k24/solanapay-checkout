import "server-only";
import pino from "pino";
import { serverEnv } from "@/lib/config/server-env";

// Structured JSON logs to stdout. In development, `npm run dev` pipes them through pino-pretty.
export const logger = pino({
  level: serverEnv.LOG_LEVEL,
  base: { service: "solanapay-checkout", env: serverEnv.APP_ENV, network: serverEnv.network },
  redact: {
    paths: [
      "authorization",
      "cookie",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.secret",
      "*.privateKey",
      "*.seedPhrase",
      "*.AUTH_SECRET",
      "*.CRON_SECRET",
      "*.DATABASE_URL",
    ],
    censor: "[REDACTED]",
  },
});
