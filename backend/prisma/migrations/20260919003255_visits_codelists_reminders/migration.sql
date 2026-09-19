-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('anc_due', 'anc_missed', 'follow_up', 'medicine');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('sms', 'push');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('pending', 'sent', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "codelist_items" (
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_np" TEXT NOT NULL,
    "meta" JSONB,

    CONSTRAINT "codelist_items_pkey" PRIMARY KEY ("kind","code")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "ref_id" TEXT,
    "kind" "ReminderKind" NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "channel" "Channel" NOT NULL DEFAULT 'sms',
    "recipient_phone" TEXT NOT NULL,
    "recipient_role" TEXT NOT NULL,
    "message_np" TEXT NOT NULL,
    "message_en" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "facility_id" TEXT,
    "facility_name" TEXT,
    "visit_at" TIMESTAMP(3) NOT NULL,
    "chief_complaint_code" TEXT NOT NULL,
    "vitals" JSONB NOT NULL DEFAULT '{}',
    "diagnosis_codes" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "advice" TEXT,
    "follow_up_at" DATE,
    "referral" JSONB,
    "prescriptions" JSONB NOT NULL DEFAULT '[]',
    "supersedes_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminders_patient_id_idx" ON "reminders"("patient_id");

-- CreateIndex
CREATE INDEX "visits_patient_id_visit_at_idx" ON "visits"("patient_id", "visit_at");

-- CreateIndex
CREATE INDEX "visits_updated_at_idx" ON "visits"("updated_at");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_provider_user_id_fkey" FOREIGN KEY ("provider_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_facility_id_fkey" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
