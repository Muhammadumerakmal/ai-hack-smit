BEGIN;
-- AlterTable
ALTER TABLE "ai_logs" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "announcements" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "attendance" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "attendance_corrections" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "chat_conversations" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "chat_messages" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "departments" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "designations" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "face_profiles" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "holidays" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "leave_requests" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "leave_types" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payroll_runs" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payslips" ALTER COLUMN "companyId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "companyId" DROP DEFAULT;

COMMIT;
