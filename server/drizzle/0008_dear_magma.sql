CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"method" text DEFAULT '' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tariff" text DEFAULT 'Standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "monthly_fee" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "next_payment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "terminals" ADD COLUMN "password" text;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_payments_tenant_idx" ON "subscription_payments" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "terminals_password_uq" ON "terminals" USING btree ("tenant_id","password");