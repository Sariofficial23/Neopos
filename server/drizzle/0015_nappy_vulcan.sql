ALTER TABLE "receipts" ADD COLUMN "locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "terminals" ADD COLUMN "sync_at" timestamp with time zone;