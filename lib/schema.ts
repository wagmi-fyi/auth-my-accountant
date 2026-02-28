import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  unique,
  integer,
} from "drizzle-orm/pg-core";

export const firms = pgTable("firms", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  stripeAccountId: text("stripe_account_id"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: uuid("firm_id")
      .references(() => firms.id)
      .notNull(),
    token: text("token").notNull().unique(),
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id").notNull(),
    providerClientSecret: text("provider_client_secret").notNull(),
    providerPublishableKey: text("provider_publishable_key"),
    providerConfig: jsonb("provider_config"),
    consent: jsonb("consent").notNull(),
    clientRef: text("client_ref"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);

export const channelResults = pgTable(
  "channel_results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .references(() => channels.id)
      .notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    accountMetadata: jsonb("account_metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("channel_results_channel_account_unique").on(
      table.channelId,
      table.providerAccountId
    ),
  ]
);

export const bundles = pgTable("bundles", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: uuid("firm_id")
    .references(() => firms.id)
    .notNull(),
  token: text("token").notNull().unique(),
  provider: text("provider").notNull(),
  providerPublishableKey: text("provider_publishable_key"),
  providerConfig: jsonb("provider_config"),
  consent: jsonb("consent").notNull(),
  clientRef: text("client_ref"),
  maxSessions: integer("max_sessions").notNull().default(5),
  sessions: jsonb("sessions").notNull(),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    endpoint: text("endpoint").notNull(),
    windowStart: timestamp("window_start").notNull(),
    requestCount: integer("request_count").notNull().default(1),
  },
  (table) => [
    unique("rate_limits_identifier_endpoint_window").on(
      table.identifier,
      table.endpoint,
      table.windowStart
    ),
  ]
);
