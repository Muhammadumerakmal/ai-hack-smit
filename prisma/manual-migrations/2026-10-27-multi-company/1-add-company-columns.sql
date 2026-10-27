BEGIN;
-- DropIndex
DROP INDEX "departments_name_key";

-- DropIndex
DROP INDEX "designations_title_key";

-- DropIndex
DROP INDEX "employees_code_key";

-- DropIndex
DROP INDEX "holidays_date_key";

-- DropIndex
DROP INDEX "leave_types_code_key";

-- DropIndex
DROP INDEX "payroll_runs_month_key";

-- AlterTable
ALTER TABLE "ai_logs" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "attendance" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "attendance_corrections" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "chat_conversations" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "designations" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "face_profiles" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "holidays" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "leave_types" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "payslips" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
CREATE SEQUENCE settings_id_seq;
ALTER TABLE "settings" ALTER COLUMN "id" SET DEFAULT nextval('settings_id_seq');
ALTER SEQUENCE settings_id_seq OWNED BY "settings"."id";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "companyId" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "ai_logs_companyId_idx" ON "ai_logs"("companyId");

-- CreateIndex
CREATE INDEX "announcements_companyId_idx" ON "announcements"("companyId");

-- CreateIndex
CREATE INDEX "attendance_companyId_idx" ON "attendance"("companyId");

-- CreateIndex
CREATE INDEX "attendance_corrections_companyId_idx" ON "attendance_corrections"("companyId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_idx" ON "audit_logs"("companyId");

-- CreateIndex
CREATE INDEX "chat_conversations_companyId_idx" ON "chat_conversations"("companyId");

-- CreateIndex
CREATE INDEX "chat_messages_companyId_idx" ON "chat_messages"("companyId");

-- CreateIndex
CREATE INDEX "departments_companyId_idx" ON "departments"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_companyId_name_key" ON "departments"("companyId", "name");

-- CreateIndex
CREATE INDEX "designations_companyId_idx" ON "designations"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "designations_companyId_title_key" ON "designations"("companyId", "title");

-- CreateIndex
CREATE INDEX "employees_companyId_idx" ON "employees"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_code_key" ON "employees"("companyId", "code");

-- CreateIndex
CREATE INDEX "face_profiles_companyId_idx" ON "face_profiles"("companyId");

-- CreateIndex
CREATE INDEX "holidays_companyId_idx" ON "holidays"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_companyId_date_key" ON "holidays"("companyId", "date");

-- CreateIndex
CREATE INDEX "leave_requests_companyId_idx" ON "leave_requests"("companyId");

-- CreateIndex
CREATE INDEX "leave_types_companyId_idx" ON "leave_types"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_companyId_code_key" ON "leave_types"("companyId", "code");

-- CreateIndex
CREATE INDEX "notifications_companyId_idx" ON "notifications"("companyId");

-- CreateIndex
CREATE INDEX "payroll_runs_companyId_idx" ON "payroll_runs"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_companyId_month_key" ON "payroll_runs"("companyId", "month");

-- CreateIndex
CREATE INDEX "payslips_companyId_idx" ON "payslips"("companyId");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "designations" ADD CONSTRAINT "designations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_logs" ADD CONSTRAINT "ai_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "face_profiles" ADD CONSTRAINT "face_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "settings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing company keeps id 1; new companies continue after the highest id.
SELECT setval('settings_id_seq', (SELECT COALESCE(MAX(id), 1) FROM settings));
COMMIT;
