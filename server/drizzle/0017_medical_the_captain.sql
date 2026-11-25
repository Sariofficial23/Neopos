ALTER TABLE "audit_log" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD COLUMN "digest_sent_on" text;