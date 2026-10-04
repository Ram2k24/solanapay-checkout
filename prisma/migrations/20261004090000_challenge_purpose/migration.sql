-- CreateEnum
CREATE TYPE "challenge_purpose" AS ENUM ('SIGN_IN', 'PAYOUT_CHANGE');

-- AlterTable
ALTER TABLE "auth_nonces" ADD COLUMN     "new_payout_wallet" VARCHAR(44),
ADD COLUMN     "purpose" "challenge_purpose" NOT NULL DEFAULT 'SIGN_IN';


-- Hand-written (Phase 11.4): a payout-change challenge always names the new wallet, and
-- no other challenge does. Existing rows are sign-in challenges with no wallet: valid.
ALTER TABLE "auth_nonces" ADD CONSTRAINT "auth_nonces_payout_wallet_matches_purpose"
  CHECK (("purpose" = 'PAYOUT_CHANGE') = ("new_payout_wallet" IS NOT NULL));
