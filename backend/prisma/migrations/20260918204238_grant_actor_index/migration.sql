-- CreateIndex
CREATE INDEX "access_grants_redeemed_by_user_id_revoked_at_access_until_idx" ON "access_grants"("redeemed_by_user_id", "revoked_at", "access_until");
