import { z } from "zod";
import { ENABLED_NETWORKS, SOLANA_NETWORKS } from "./networks";
import { parseEnv } from "./parse-env";

// NEXT_PUBLIC_* values are inlined into browser JavaScript at build time.
// Next.js only inlines literal `process.env.NEXT_PUBLIC_X` references,
// so every variable is listed explicitly below.
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.url({ protocol: /^https?$/ }),
  NEXT_PUBLIC_SOLANA_NETWORK: z
    .enum(SOLANA_NETWORKS)
    .refine((network) => ENABLED_NETWORKS.includes(network), {
      message: `network is not enabled in this build (enabled: ${ENABLED_NETWORKS.join(", ")})`,
    }),
  NEXT_PUBLIC_SOLANA_RPC_URL: z.url({ protocol: /^https?$/ }),
  NEXT_PUBLIC_SOLANA_EXPLORER_URL: z.url({ protocol: /^https$/ }),
});

export const publicEnv = parseEnv(
  schema,
  {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK,
    NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    NEXT_PUBLIC_SOLANA_EXPLORER_URL: process.env.NEXT_PUBLIC_SOLANA_EXPLORER_URL,
  },
  "public",
);
