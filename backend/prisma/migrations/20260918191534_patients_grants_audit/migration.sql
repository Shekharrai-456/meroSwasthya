-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('female', 'male', 'other');

-- CreateEnum
CREATE TYPE "GrantScope" AS ENUM ('read', 'append');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('grant_created', 'grant_redeemed', 'record_viewed', 'visit_added', 'contact_recorded', 'document_added', 'grant_revoked');

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sex" "Sex" NOT NULL,
    "dob" DATE NOT NULL,
    "blood_group" TEXT,
    "ward" INTEGER,
    "municipality" TEXT,
    "allergies" JSONB NOT NULL DEFAULT '[]',
    "chronic_conditions" JSONB NOT NULL DEFAULT '[]',
    "emergency_contact_phone" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_grants" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "scope" "GrantScope" NOT NULL,
    "token_jti" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "redeemed_by_user_id" TEXT,
    "redeemed_at" TIMESTAMP(3),
    "access_until" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_entries" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "actor_facility_name" TEXT,
    "action" "AuditAction" NOT NULL,
    "grant_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patients_owner_user_id_idx" ON "patients"("owner_user_id");

-- CreateIndex
CREATE INDEX "patients_updated_at_idx" ON "patients"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "access_grants_token_jti_key" ON "access_grants"("token_jti");

-- CreateIndex
CREATE INDEX "access_grants_patient_id_redeemed_by_user_id_access_until_idx" ON "access_grants"("patient_id", "redeemed_by_user_id", "access_until");

-- CreateIndex
CREATE INDEX "audit_entries_patient_id_at_idx" ON "audit_entries"("patient_id", "at");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_redeemed_by_user_id_fkey" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_entries" ADD CONSTRAINT "audit_entries_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
