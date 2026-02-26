import { z } from "zod";

export const createFirmSchema = z.object({
  name: z.string().min(1).max(200),
});

export const createChannelSchema = z.object({
  provider: z.enum(["stripe_fc"]),
  provider_config: z.object({
    permissions: z
      .array(
        z.enum(["transactions", "balances", "ownership", "payment_method"])
      )
      .min(1),
    prefetch: z.array(z.string()).optional(),
    customer_id: z.string().optional(),
  }),
  credentials: z.object({
    secret_key: z.string().min(1),
    publishable_key: z.string().min(1),
  }),
  consent: z.object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
    firm_name: z.string().min(1).max(200),
  }),
  client_ref: z.string().max(500).optional(),
  expires_in_hours: z.number().min(1).max(168).default(24),
});

export const submitResultsSchema = z.object({
  accounts: z
    .array(
      z.object({
        id: z.string(),
        institution_name: z.string().optional(),
        last4: z.string().optional(),
        category: z.string().optional(),
        subcategory: z.string().optional(),
        display_name: z.string().nullable().optional(),
        status: z.string().optional(),
      })
    )
    .min(1),
});
