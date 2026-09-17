CREATE TABLE "firm_provider_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firm_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_ref" text NOT NULL,
	"verified_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "firm_provider_bindings_firm_provider" UNIQUE("firm_id","provider")
);
--> statement-breakpoint
ALTER TABLE "firm_provider_bindings" ADD CONSTRAINT "firm_provider_bindings_firm_id_firms_id_fk" FOREIGN KEY ("firm_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;