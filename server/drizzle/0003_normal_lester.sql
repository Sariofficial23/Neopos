ALTER TABLE "products" ADD COLUMN "cost" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "cost" bigint DEFAULT 0 NOT NULL;