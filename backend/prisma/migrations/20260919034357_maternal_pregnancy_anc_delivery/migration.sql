-- CreateEnum
CREATE TYPE "PregStatus" AS ENUM ('active', 'delivered', 'ended');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('normal', 'high');

-- CreateEnum
CREATE TYPE "Triage" AS ENUM ('green', 'amber', 'red');

-- CreateEnum
CREATE TYPE "DeliveryPlace" AS ENUM ('home', 'birthing_centre', 'hospital', 'on_the_way');

-- CreateEnum
CREATE TYPE "DeliveryMode" AS ENUM ('normal', 'assisted', 'cs');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('live_birth', 'stillbirth');

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "pregnancy_id" TEXT;

-- CreateTable
CREATE TABLE "pregnancies" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "lmp" DATE,
    "edd" DATE NOT NULL,
    "gravida" INTEGER NOT NULL,
    "para" INTEGER NOT NULL,
    "risk_factors" JSONB NOT NULL DEFAULT '[]',
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'normal',
    "status" "PregStatus" NOT NULL DEFAULT 'active',
    "birth_plan" JSONB,
    "registered_by_user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "pregnancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anc_contacts" (
    "id" TEXT NOT NULL,
    "pregnancy_id" TEXT NOT NULL,
    "contact_no" INTEGER NOT NULL,
    "week_target" INTEGER NOT NULL,
    "due_at" DATE NOT NULL,
    "done_at" TIMESTAMP(3),
    "provider_user_id" TEXT,
    "findings" JSONB,
    "danger_signs" JSONB NOT NULL DEFAULT '[]',
    "triage_level" "Triage",
    "triage_reasons" JSONB NOT NULL DEFAULT '[]',
    "referral" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "anc_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "pregnancy_id" TEXT NOT NULL,
    "delivered_at" TIMESTAMP(3) NOT NULL,
    "place" "DeliveryPlace" NOT NULL,
    "mode" "DeliveryMode" NOT NULL,
    "outcome" "Outcome" NOT NULL,
    "baby_weight_kg" DOUBLE PRECISION,
    "baby_sex" "Sex",
    "complications" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pregnancies_patient_id_status_idx" ON "pregnancies"("patient_id", "status");

-- CreateIndex
CREATE INDEX "pregnancies_updated_at_idx" ON "pregnancies"("updated_at");

-- CreateIndex
CREATE INDEX "anc_contacts_updated_at_idx" ON "anc_contacts"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "anc_contacts_pregnancy_id_contact_no_key" ON "anc_contacts"("pregnancy_id", "contact_no");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_pregnancy_id_key" ON "deliveries"("pregnancy_id");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_pregnancy_id_fkey" FOREIGN KEY ("pregnancy_id") REFERENCES "pregnancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pregnancies" ADD CONSTRAINT "pregnancies_registered_by_user_id_fkey" FOREIGN KEY ("registered_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anc_contacts" ADD CONSTRAINT "anc_contacts_pregnancy_id_fkey" FOREIGN KEY ("pregnancy_id") REFERENCES "pregnancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anc_contacts" ADD CONSTRAINT "anc_contacts_provider_user_id_fkey" FOREIGN KEY ("provider_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pregnancy_id_fkey" FOREIGN KEY ("pregnancy_id") REFERENCES "pregnancies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-added (Prisma's schema DSL has no partial/filtered index syntax).
-- REQ-PREG-002's DB-level enforcement, documented in docs/DATA_MODEL.md's
-- Pregnancy section: the service-layer check alone is race-prone under
-- Postgres's default READ COMMITTED isolation (two concurrent requests could
-- both pass a SELECT-then-INSERT check before either commits).
CREATE UNIQUE INDEX "pregnancies_one_active_per_patient"
  ON "pregnancies" ("patient_id")
  WHERE "status" = 'active' AND "deleted" = false;

-- Hand-added (Prisma's schema DSL has no CHECK clause). REQ-PREG-010's
-- contactNo range, documented in docs/DATA_MODEL.md's AncContact section -
-- CLAUDE.md §9 requires check constraints at the database level, not only
-- in application code.
ALTER TABLE "anc_contacts" ADD CONSTRAINT "anc_contacts_contact_no_range" CHECK ("contact_no" BETWEEN 1 AND 8);
