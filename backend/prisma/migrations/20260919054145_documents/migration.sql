-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('prescription', 'lab', 'discharge', 'referral', 'other');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('pending_upload', 'uploaded');

-- CreateEnum
CREATE TYPE "AiStatus" AS ENUM ('none', 'queued', 'done', 'failed');

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "type" "DocType" NOT NULL,
    "title" TEXT NOT NULL,
    "taken_at" DATE NOT NULL,
    "status" "DocStatus" NOT NULL DEFAULT 'pending_upload',
    "object_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "ai_summary" TEXT,
    "ai_summary_status" "AiStatus" NOT NULL DEFAULT 'none',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "documents_patient_id_idx" ON "documents"("patient_id");

-- CreateIndex
CREATE INDEX "documents_updated_at_idx" ON "documents"("updated_at");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
