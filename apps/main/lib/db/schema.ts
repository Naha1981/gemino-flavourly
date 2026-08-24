import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
  decimal,
  numeric,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

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
  outcome: text('outcome', { enum: ['converted', 'missed', 'handled', 'lost'] }),
  estimatedValueCents: integer('estimated_value_cents').default(0).notNull(),
  outcomeClassifiedAt: timestamp('outcome_classified_at'),
  outcomeClassifier: text('outcome_classifier', { enum: ['rule', 'ai', 'manual'] }),
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
    direction: text('direction', { enum: ['inbound', 'outbound', 'system'] }).notNull(),
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
    // Delivery state for OUTBOUND messages.
    //
    // Previously there was no delivery state at all: a staff reply was
    // written here and rendered in the inbox identically whether it
    // reached the customer, was still queued, or had exhausted every
    // retry and died. A restaurant had no way to tell which of its
    // replies actually arrived.
    //
    // Nullable on purpose, and with NO default, so this migration is
    // additive and backward compatible: every pre-existing row keeps
    // NULL, which the UI renders exactly as it does today ("no delivery
    // information"). Only rows written after this change carry a state,
    // so nothing historical is retroactively mislabelled as failed.
    //
    // Inbound messages leave this NULL — delivery state is meaningless
    // for a message the customer sent us.
    //   queued  -> accepted into the outbox, not yet dispatched
    //   sent    -> the operator confirmed dispatch to WhatsApp
    //   failed  -> retries exhausted, or no dispatch route existed
    deliveryStatus: text('delivery_status', { enum: ['queued', 'sent', 'failed'] }),
    // Why a delivery failed, surfaced to staff so the failure is
    // actionable rather than just a red dot. Never contains a secret:
    // it is set from operator/job error strings only.
    deliveryError: text('delivery_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantDateIdx: index('messages_tenant_created_idx').on(table.tenantId, table.createdAt),
    conversationIdx: index('messages_conversation_idx').on(table.conversationId),
    waMessageIdIdx: uniqueIndex('messages_wa_message_id_unique')
      .on(table.tenantId, table.waMessageId)
      .where(sql`${table.waMessageId} IS NOT NULL`),
  })
);

// -----------------------------------------------------------------------------
// 7. Reservations (Bookings & Tables)
// -----------------------------------------------------------------------------
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    customerName: text('customer_name'),
    customerPhone: text('customer_phone'),
    date: timestamp('date').notNull(),
    partySize: integer('party_size').notNull(),
    status: text('status', { enum: ['confirmed', 'cancelled', 'completed', 'no_show'] }).default('confirmed').notNull(),
    deposit: decimal('deposit', { precision: 10, scale: 2 }),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // ── Gate #3: cancellation follow-up ─────────────────────────────────
    //
    // When the cancellation happened. Nothing in the schema recorded this
    // before: `status` could be flipped to 'cancelled' with no trace of
    // when, and the follow-up cron needs "cancelled more than 24h ago but
    // less than 7 days ago" — `created_at` is when the booking was MADE
    // (often weeks earlier) and `date` is when the table was FOR, so
    // neither can answer it.
    //
    // Nullable with NO default, so this migration is additive: every
    // pre-existing row keeps NULL. Rows cancelled before this column
    // existed are therefore never followed up, which is the safe
    // direction — back-filling a guessed timestamp would send "sorry we
    // missed you" messages for cancellations nobody remembers making.
    // Cancellation paths must stamp it (see
    // lib/revenue/cancellation-followup.ts#markReservationCancelled).
    cancelledAt: timestamp('cancelled_at'),
    // Set once the follow-up has been handed to the outbox, so a cron run
    // every 6 hours can never send the same customer the same message
    // twice — deduplication lives on the reservation row, not on the job
    // queue, because the queue retries and a retried job must not produce
    // a second follow-up.
    cancellationFollowupSent: boolean('cancellation_followup_sent').default(false).notNull(),
    cancellationFollowupSentAt: timestamp('cancellation_followup_sent_at'),
    // ── Gate #4: no-show monitoring ─────────────────────────────────────
    //
    // A confirmed booking whose start time passed more than 2 hours ago
    // without the customer arriving. Detection does NOT touch `status`:
    // flipping it to 'no_show' is a staff decision (the customer may still
    // walk in and be marked 'completed'), so the cron records its own
    // flags alongside instead of rewriting the restaurant's book.
    //
    // `no_show_detected` is the deduplication key for the detection scan
    // and the timestamp the follow-up's 2-hour delay is measured from, so
    // a 30-minute cron can never detect — or message — the same booking
    // twice. The timestamps are nullable with NO default so this migration
    // is additive: every pre-existing row keeps NULL.
    noShowDetected: boolean('no_show_detected').default(false).notNull(),
    noShowDetectedAt: timestamp('no_show_detected_at'),
    noShowFollowupSent: boolean('no_show_followup_sent').default(false).notNull(),
    noShowFollowupSentAt: timestamp('no_show_followup_sent_at'),
  },
  (table) => ({
    // The follow-up cron runs every 6 hours against a table that only ever
    // grows. A partial index keeps that scan to the handful of rows that
    // could possibly match instead of every booking ever taken.
    cancellationFollowupIdx: index('reservations_cancellation_followup_idx')
      .on(table.cancelledAt)
      .where(sql`${table.status} = 'cancelled' AND ${table.cancellationFollowupSent} = false`),
    // The no-show cron runs every 30 minutes. Two partial indexes keep
    // each of its scans to the rows that could possibly match:
    //   detection  — confirmed bookings not yet flagged, by start time
    //   follow-up  — detected bookings not yet messaged, by detection time
    noShowDetectionIdx: index('reservations_no_show_detection_idx')
      .on(table.date)
      .where(sql`${table.status} = 'confirmed' AND ${table.noShowDetected} = false`),
    noShowFollowupIdx: index('reservations_no_show_followup_idx')
      .on(table.noShowDetectedAt)
      .where(sql`${table.noShowFollowupSent} = false AND ${table.noShowDetectedAt} IS NOT NULL`),
  })
);

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
  conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
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
// 11. Revenue Events (Revenue Intelligence Engine)
// -----------------------------------------------------------------------------
export const revenueEvents = pgTable(
  'revenue_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventType: text('event_type', {
      enum: ['booking', 'waitlist', 'reactivation', 'missed_enquiry'],
    }).notNull(),
    conversationId: uuid('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
    estimatedValueCents: integer('estimated_value_cents').default(0).notNull(),
    realizedCents: integer('realized_cents').default(0).notNull(),
    occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantOccurredIdx: index('revenue_events_tenant_occurred_idx').on(table.tenantId, table.occurredAt),
    conversationIdx: index('revenue_events_conversation_idx').on(table.conversationId),
  })
);

// -----------------------------------------------------------------------------
// 12. Marketing Campaigns (Broadcast & Segmented)
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
// 13. Outbox Jobs Queue (Guaranteed Delivery)
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
// 14. System Settings (Super Admin Master Controls)
// -----------------------------------------------------------------------------
export const systemSettings = pgTable('system_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  masterAiSwitch: boolean('master_ai_switch').default(true).notNull(),
  maintenanceMode: boolean('maintenance_mode').default(false).notNull(),
  globalNotice: text('global_notice'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// -----------------------------------------------------------------------------
// 15. Staff Members (Roles: super_admin, admin, manager, staff)
// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// 16. Customer 360 Profiles (Gate #7)
// -----------------------------------------------------------------------------
export const customerProfiles = pgTable(
  'customer_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    contactId: uuid('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
    customerPhone: text('customer_phone').notNull(),
    customerName: text('customer_name'),
    totalVisits: integer('total_visits').default(0).notNull(),
    totalSpendCents: integer('total_spend_cents').default(0).notNull(),
    avgPartySize: numeric('avg_party_size').default('0').notNull(),
    lastVisitAt: timestamp('last_visit_at'),
    firstVisitAt: timestamp('first_visit_at'),
    preferences: jsonb('preferences').default({}).notNull(),
    // Gate #8 — computed customer lifecycle segment. The default keeps
    // profile creation backward-compatible; the segmentation cron replaces
    // it with the first calculated value for every profile.
    segment: text('segment', { enum: ['vip', 'regular', 'at_risk', 'dormant', 'new'] })
      .default('new')
      .notNull(),
    segmentConfidence: numeric('segment_confidence').default('0').notNull(),
    segmentUpdatedAt: timestamp('segment_updated_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index('customer_profiles_tenant_idx').on(table.tenantId),
    phoneIdx: index('customer_profiles_phone_idx').on(table.customerPhone),
    contactIdx: index('customer_profiles_contact_idx').on(table.contactId),
    segmentIdx: index('customer_profiles_segment_idx').on(table.segment),
  })
);

// -----------------------------------------------------------------------------
// 16b. Reactivation Campaigns (Gate #9)
// -----------------------------------------------------------------------------
// One row per reactivation message queued to a dormant / at-risk customer.
//
// `sent_at` is NULL from creation until the message is actually handed to the
// outbox — a campaign row exists BEFORE the send so a crash between "decided
// to message" and "message dispatched" leaves a visible pending row (in the
// dashboard and in the next cron run) instead of silently vanishing.
//
// `responded` is set by the inbound webhook when the customer replies to a
// recently-sent campaign, and is the numerator of the response-rate metric.
export const reactivationCampaigns = pgTable(
  'reactivation_campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerPhone: text('customer_phone').notNull(),
    // Only the two win-back segments are campaign audiences; 'dormant' is
    // 180+ days, 'at_risk' is 120-180 days (see lib/customer/segmentation.ts).
    segment: text('segment', { enum: ['dormant', 'at_risk'] }).notNull(),
    messageText: text('message_text').notNull(),
    sentAt: timestamp('sent_at'),
    responded: boolean('responded').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index('reactivation_campaigns_tenant_idx').on(table.tenantId),
    phoneIdx: index('reactivation_campaigns_phone_idx').on(table.customerPhone),
    // The cron's cooldown check ("was this customer campaigned in the last
    // 90 days?") and the dashboard's "pending" view both scan by tenant; a
    // partial index keeps those scans to rows that could still match.
    pendingIdx: index('reactivation_campaigns_pending_idx')
      .on(table.tenantId, table.sentAt)
      .where(sql`${table.sentAt} IS NULL`),
  })
);

// -----------------------------------------------------------------------------
// 16c. VIP Recognition Alerts (Gate #10)
// -----------------------------------------------------------------------------
// One row per VIP customer who walks in (first message of a new conversation).
// `sent_at` is the moment the staff-facing alert was raised; `served_at` and
// `note` support the quick actions on the VIP-today dashboard ("Mark as
// served" / "Add note") without dispatching anything to the customer.
export const vipAlerts = pgTable(
  'vip_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    customerPhone: text('customer_phone').notNull(),
    customerName: text('customer_name'),
    totalVisits: integer('total_visits').notNull(),
    totalSpendCents: integer('total_spend_cents').notNull(),
    lastVisitAt: timestamp('last_visit_at').notNull(),
    preferences: jsonb('preferences').default({}).notNull(),
    sentAt: timestamp('sent_at').defaultNow().notNull(),
    // ── Gate #10 quick actions ──────────────────────────────────────────
    servedAt: timestamp('served_at'),
    note: text('note'),
  },
  (table) => ({
    tenantIdx: index('vip_alerts_tenant_idx').on(table.tenantId),
    phoneIdx: index('vip_alerts_phone_idx').on(table.customerPhone),
    sentIdx: index('vip_alerts_sent_idx').on(table.sentAt),
  })
);

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
  revenueEvents: many(revenueEvents),
  loyaltyRewards: many(loyaltyRewards),
  campaigns: many(campaigns),
  jobs: many(jobs),
  customerProfiles: many(customerProfiles),
  reactivationCampaigns: many(reactivationCampaigns),
  vipAlerts: many(vipAlerts),
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
  customerProfiles: many(customerProfiles),
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
  reservations: many(reservations),
  waitlistEntries: many(waitlistEntries),
  revenueEvents: many(revenueEvents),
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

export const reservationRelations = relations(reservations, ({ one }) => ({
  tenant: one(tenants, {
    fields: [reservations.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [reservations.contactId],
    references: [contacts.id],
  }),
  conversation: one(conversations, {
    fields: [reservations.conversationId],
    references: [conversations.id],
  }),
}));

export const waitlistEntryRelations = relations(waitlistEntries, ({ one }) => ({
  tenant: one(tenants, {
    fields: [waitlistEntries.tenantId],
    references: [tenants.id],
  }),
  contact: one(contacts, {
    fields: [waitlistEntries.contactId],
    references: [contacts.id],
  }),
  conversation: one(conversations, {
    fields: [waitlistEntries.conversationId],
    references: [conversations.id],
  }),
}));

export const revenueEventRelations = relations(revenueEvents, ({ one }) => ({
  tenant: one(tenants, {
    fields: [revenueEvents.tenantId],
    references: [tenants.id],
  }),
  conversation: one(conversations, {
    fields: [revenueEvents.conversationId],
    references: [conversations.id],
  }),
}));
