ALTER TABLE "users" ADD COLUMN "salary_fixed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "salary_sales_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "salary_service_bp" integer DEFAULT 0 NOT NULL;