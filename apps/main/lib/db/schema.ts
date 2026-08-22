import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
  decimal,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// -----------------------------------------------------------------------------
// 1. Tenants (Businesses / Restaurants)
// -----------------------------------------------------------------------------
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  ownerEmail: text('owner_email'),
  description: text('description'),
  openingHours: text('opening_hours'),
  aiPersonality: text('ai_personality').default('friendly and professional'),
  aiEnabled: boolean('ai_enabled').default(true).notNull(),
  manualMode: boolean('manual_mode').default(false).notNull(),
  systemPrompt: text('system_prompt'),
  monthlyFee: decimal('monthly_fee', { precision: 10, scale: 2 }).default('49.00'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 2. WhatsApp Accounts (Linked Device Sockets)
// -----------------------------------------------------------------------------
export const waAccounts = pgTable('wa_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  phoneNumber: text('phone_number'),
  sessionCreds: text('session_creds'),
  isConnected: boolean('is_connected').default(false).notNull(),
  qrCode: text('qr_code'),
  status: text('status', { enum: ['unlinked', 'connecting', 'connected', 'disconnected'] }).default('unlinked'),
  lastConnectedAt: timestamp('last_connected_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 2b. WhatsApp (Baileys) Signal Protocol Keys
//
// `wa_accounts.session_creds` alone is NOT enough for a session to survive a
// restart — Baileys also needs the Signal key store (pre-keys, sender keys,
// app-state sync keys) persisted, or every reconnect silently degrades into
// a broken session / forced re-scan. One row per (account, key type, key id),
// matching the standard Baileys custom-auth-state pattern. Read/written
// directly via `pg` in the operator for latency; modeled here so Drizzle
// migrations create and version it alongside everything else.
// -----------------------------------------------------------------------------
export const waAuthKeys = pgTable(
  'wa_auth_keys',
  {
    waAccountId: uuid('wa_account_id')
      .notNull()
      .references(() => waAccounts.id, { onDelete: 'cascade' }),
    keyType: text('key_type').notNull(),
    keyId: text('key_id').notNull(),
    value: jsonb('value'),
  },
  (table) => ({
    pk: uniqueIndex('wa_auth_keys_pk').on(table.waAccountId, table.keyType, table.keyId),
  })
);

// -----------------------------------------------------------------------------
// 3. Multi-App Account Bindings (1 Shared Operator -> Multiple Apps)
// -----------------------------------------------------------------------------
export const waAccountBindings = pgTable('wa_account_bindings', {
  id: uuid('id').primaryKey().defaultRandom(),
  waAccountId: uuid('wa_account_id').notNull(),
  appId: text('app_id').notNull(), // 'gemino' | 'flavourly' | 'orderly' | 'custom'
  tenantId: uuid('tenant_id').notNull(),
  webhookUrl: text('webhook_url').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 4. Contacts (Customer phone numbers & VIP status)
// -----------------------------------------------------------------------------
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    phone: text('phone').notNull(),
    name: text('name'),
    blocklisted: boolean('blocklisted').default(false).notNull(),
    vip: boolean('vip').default(false).notNull(),
    loyaltyPoints: integer('loyalty_points').default(0).notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantPhoneUniq: uniqueIndex('contacts_tenant_phone_idx').on(table.tenantId, table.phone),
    phoneIdx: index('contacts_phone_idx').on(table.phone),
  })
);

// -----------------------------------------------------------------------------
// 5. Conversations (Live chat sessions)
// -----------------------------------------------------------------------------
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  waAccountId: uuid('wa_account_id').references(() => waAccounts.id, { onDelete: 'set null' }),
  manualTakeover: boolean('manual_takeover').default(false).notNull(),
  isResolved: boolean('is_resolved').default(false).notNull(),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 6. Messages (Inbound customer messages & Outbound AI / manual replies)
// -----------------------------------------------------------------------------
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    content: text('content').notNull(),
    isAIGenerated: boolean('is_ai_generated').default(false).notNull(),
    sentiment: text('sentiment', { enum: ['positive', 'neutral', 'negative'] }),
    messageType: text('message_type').default('text'),
    // WhatsApp's own message id (msg.key.id), stored for inbound messages
    // only. Baileys re-emits messages.upsert on reconnect, and without
    // this the webhook would generate and send a duplicate AI reply for
    // the same customer message every time the operator restarts or
    // flaps. See the idempotency check in the webhook route.
    waMessageId: text('wa_message_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantDateIdx: index('messages_tenant_created_idx').on(table.tenantId, table.createdAt),
    conversationIdx: index('messages_conversation_idx').on(table.conversationId),
    waMessageIdIdx: index('messages_wa_message_id_idx').on(table.tenantId, table.waMessageId),
  })
);

// -----------------------------------------------------------------------------
// 7. Reservations (Bookings & Tables)
// -----------------------------------------------------------------------------
export const reservations = pgTable('reservations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  date: timestamp('date').notNull(),
  partySize: integer('party_size').notNull(),
  status: text('status', { enum: ['confirmed', 'cancelled', 'completed', 'no_show'] }).default('confirmed').notNull(),
  deposit: decimal('deposit', { precision: 10, scale: 2 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 8. Leads (Catering, Corporate, VIP events)
// -----------------------------------------------------------------------------
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
  type: text('type', { enum: ['event', 'catering', 'corporate', 'general'] }).notNull(),
  status: text('status', { enum: ['new', 'quoted', 'confirmed', 'lost'] }).default('new').notNull(),
  data: jsonb('data').default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 9. Loyalty Program & Rewards
// -----------------------------------------------------------------------------
export const loyaltyTransactions = pgTable('loyalty_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['earn', 'redeem', 'bonus', 'adjustment'] }).notNull(),
  amount: integer('amount').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const loyaltyRewards = pgTable('loyalty_rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  pointsCost: integer('points_cost').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 10. Waitlist Entries
// -----------------------------------------------------------------------------
export const waitlistEntries = pgTable('waitlist_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contacts.id, { onDelete: 'cascade' }),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  partySize: integer('party_size').notNull(),
  status: text('status', { enum: ['waiting', 'offered', 'accepted', 'seated', 'expired', 'cancelled'] })
    .default('waiting')
    .notNull(),
  estimatedWaitMinutes: integer('estimated_wait_minutes').default(20),
  notifiedAt: timestamp('notified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 11. Marketing Campaigns (Broadcast & Segmented)
// -----------------------------------------------------------------------------
export const campaigns = pgTable('campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type', { enum: ['fill_quiet_hours', 'win_back', 'vip_reward', 'custom'] }).notNull(),
  audienceFilter: jsonb('audience_filter').default({}),
  message: text('message').notNull(),
  sentCount: integer('sent_count').default(0),
  sentAt: timestamp('sent_at'),
  status: text('status', { enum: ['draft', 'queued', 'sent', 'failed'] }).default('draft').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 12. Outbox Jobs Queue (Guaranteed Delivery)
// -----------------------------------------------------------------------------
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['send_whatsapp', 'slack_notification', 'sync_contacts'] }).notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['pending', 'processing', 'done', 'failed'] }).default('pending').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),
    nextRunAt: timestamp('next_run_at').defaultNow().notNull(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Set on every status transition. Without this, a job that flips to
    // 'processing' and then never completes (serverless function timeout
    // or crash mid-dispatch) sits stuck forever — nothing could tell "just
    // started processing" apart from "processing for 3 days". The outbox
    // cron uses this to reset stuck jobs back to pending.
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    statusNextRunIdx: index('jobs_status_next_run_idx').on(table.status, table.nextRunAt),
  })
);

// -----------------------------------------------------------------------------
// 13. System Settings (Super Admin Master Controls)
// -----------------------------------------------------------------------------
export const systemSettings = pgTable('system_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  masterAiSwitch: boolean('master_ai_switch').default(true).notNull(),
  maintenanceMode: boolean('maintenance_mode').default(false).notNull(),
  globalNotice: text('global_notice'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 14. Staff Members (Roles: super_admin, admin, manager, staff)
// -----------------------------------------------------------------------------
export const staffMembers = pgTable('staff_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .references(() => tenants.id, { onDelete: 'cascade' }),
  clerkUserId: text('clerk_user_id').notNull(),
  email: text('email'),
  name: text('name'),
  role: text('role', { enum: ['super_admin', 'admin', 'manager', 'staff'] })
    .default('staff')
    .notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// RELATIONS
// -----------------------------------------------------------------------------
export const tenantRelations = relations(tenants, ({ many, one }) => ({
  waAccounts: many(waAccounts),
  contacts: many(contacts),
  conversations: many(conversations),
  messages: many(messages),
  reservations: many(reservations),
  waitlistEntries: many(waitlistEntries),
  loyaltyRewards: many(loyaltyRewards),
  campaigns: many(campaigns),
  jobs: many(jobs),
}));

export const waAccountRelations = relations(waAccounts, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [waAccounts.tenantId],
    references: [tenants.id],
  }),
  conversations: many(conversations),
}));

export const contactRelations = relations(contacts, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [contacts.tenantId],
    references: [tenants.id],
  }),
  conversations: many(conversations),
  reservations: many(reservations),
  waitlistEntries: many(waitlistEntries),
  loyaltyTransactions: many(loyaltyTransactions),
}));

export const conversationRelations = relations(conversations, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [conversations.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [conversations.contactId],
    references: [contacts.id],
  }),
  waAccount: one(waAccounts, {
    fields: [conversations.waAccountId],
    references: [waAccounts.id],
  }),
  messages: many(messages),
}));

export const messageRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  tenant: one(tenants, {
    fields: [messages.tenantId],
    references: [tenants.id],
  }),
}));
