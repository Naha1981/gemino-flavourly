/**
 * GATE 2 — Super Admin DEMO MODE seed dataset.
 *
 * Deterministic, hardcoded, realistic South African restaurant data.
 *
 * ARCHITECTURE INVARIANT: this data is VIEW-ONLY. It is never inserted
 * into any live table — demo mode is a display-time branch in the
 * dashboard pages, so the real Neon database (and the billing gates,
 * analytics, and cron jobs that read it) can never be polluted by fake
 * revenue. Contrast with the pre-existing /api/admin/seed-demo route,
 * which materialises deadbeef-prefixed rows into live tables — a
 * different tool for a different job (populating a scratch tenant), kept
 * strictly separate from this one.
 *
 * Determinism: no Date.now(), no Math.random(), no environment reads —
 * every render, on every machine, produces byte-identical values, so
 * screenshots, tests, and demos never drift.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Platform KPIs (Super Admin overview)
// ─────────────────────────────────────────────────────────────────────────────

export interface PlatformKpis {
  totalTenants: number;
  activeSockets: number;
  messagesProcessed: number;
  /** R/month at the published R699/tenant platform price. */
  mrrZar: number;
  missedRevenueCents: number;
  slowDaysDetected: number;
  totalPriorityValueCents: number;
  platformOpportunityCents: number;
  segmentVip: number;
  segmentRegular: number;
  segmentAtRisk: number;
  segmentDormant: number;
  segmentNew: number;
  vipAlertsToday: number;
  competitorsTracked: number;
  ratingMonitoredCompetitors: number;
  ratingDropAlertsThisWeek: number;
  marketOpportunities: number;
  marketAlertsThisWeek: number;
}

const TENANT_COUNT = 24;
const PRICE_PER_TENANT_ZAR = 699;

export const DEMO_PLATFORM_KPIS: PlatformKpis = {
  totalTenants: TENANT_COUNT,
  activeSockets: 23,
  messagesProcessed: 48_712,
  mrrZar: TENANT_COUNT * PRICE_PER_TENANT_ZAR, // R16,776
  missedRevenueCents: 8_143_000, // R81,430 — unanswered enquiries over 30 days
  slowDaysDetected: 11,
  totalPriorityValueCents: 3_420_000, // R34,200
  platformOpportunityCents: 12_785_000, // R127,850
  segmentVip: 312,
  segmentRegular: 1_847,
  segmentAtRisk: 189,
  segmentDormant: 421,
  segmentNew: 96,
  vipAlertsToday: 7,
  competitorsTracked: 68,
  ratingMonitoredCompetitors: 51,
  ratingDropAlertsThisWeek: 9,
  marketOpportunities: 14,
  marketAlertsThisWeek: 22,
};

// ─────────────────────────────────────────────────────────────────────────────
// Recent tenants (Super Admin onboarding table)
// ─────────────────────────────────────────────────────────────────────────────

export interface DemoTenant {
  name: string;
  slug: string;
  aiEnabled: boolean;
  manualMode: boolean;
  joinedDate: string; // ISO date, fixed
}

export const DEMO_TENANTS: DemoTenant[] = [
  { name: 'The Test Kitchen', slug: 'the-test-kitchen-ct', aiEnabled: true, manualMode: false, joinedDate: '2026-08-28' },
  { name: 'Marble', slug: 'marble-jhb', aiEnabled: true, manualMode: false, joinedDate: '2026-08-26' },
  { name: 'Salsi', slug: 'salsi-parkhurst', aiEnabled: true, manualMode: false, joinedDate: '2026-08-24' },
  { name: 'La Colombe', slug: 'la-colombe-constantia', aiEnabled: true, manualMode: false, joinedDate: '2026-08-21' },
  { name: 'FYN', slug: 'fyn-on-upper-cape-town', aiEnabled: true, manualMode: false, joinedDate: '2026-08-19' },
  { name: 'Gold Restaurant', slug: 'gold-heritage-square', aiEnabled: true, manualMode: false, joinedDate: '2026-08-15' },
  { name: 'Wolfgat', slug: 'wolfgat-paternoster', aiEnabled: false, manualMode: true, joinedDate: '2026-08-12' },
  { name: 'Mzansi Braai House', slug: 'mzansi-braai-soweto', aiEnabled: true, manualMode: false, joinedDate: '2026-08-09' },
  { name: 'The Potluck Club', slug: 'potluck-club-bree', aiEnabled: true, manualMode: false, joinedDate: '2026-08-05' },
  { name: 'Kloof Street House', slug: 'kloof-street-house', aiEnabled: true, manualMode: true, joinedDate: '2026-08-02' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Inbox conversations (tenant dashboard, WhatsApp transcripts)
// ─────────────────────────────────────────────────────────────────────────────

export interface DemoMessage {
  from: 'customer' | 'ai';
  text: string;
  at: string; // fixed HH:MM
}

export interface DemoConversation {
  id: string;
  contactName: string;
  phone: string;
  channel: 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'web';
  subject: string;
  valueCents: number;
  status: 'open' | 'pending' | 'closed' | 'waiting';
  isVip: boolean;
  unread: number;
  lastActive: string;
  transcript: DemoMessage[];
}

export const DEMO_CONVERSATIONS: DemoConversation[] = [
  {
    id: 'demo-conv-1',
    contactName: 'Thandi Mkhize',
    phone: '+27 82 551 0043',
    channel: 'whatsapp',
    subject: 'Birthday dinner, table for 8, Saturday 19:00',
    valueCents: 486_000,
    status: 'open',
    isVip: true,
    unread: 1,
    lastActive: '2 min ago',
    transcript: [
      { from: 'customer', text: 'Hi! I would like to book a table for 8 this Saturday at 19:00 — it is my birthday 🎂', at: '18:41' },
      { from: 'ai', text: 'Happy birthday, Thandi! 🎉 Saturday 19:00 for 8 is available. Would you like our chef’s tasting menu at R595 per guest, or à la carte?', at: '18:41' },
      { from: 'customer', text: 'Tasting menu sounds perfect. One guest is vegetarian.', at: '18:43' },
      { from: 'ai', text: 'Noted — one vegetarian tasting menu, seven classic. See you Saturday! Reservation reference GEM-4021.', at: '18:43' },
      { from: 'customer', text: 'Can we also get a window table if possible?', at: '18:52' },
    ],
  },
  {
    id: 'demo-conv-2',
    contactName: 'Sipho Dlamini',
    phone: '+27 71 330 9912',
    channel: 'whatsapp',
    subject: 'Valentine’s set menu enquiry',
    valueCents: 299_000,
    status: 'waiting',
    isVip: false,
    unread: 2,
    lastActive: '11 min ago',
    transcript: [
      { from: 'customer', text: 'Morning, do you have a Valentine’s set menu? Price per couple?', at: '09:02' },
      { from: 'ai', text: 'We do! Our Valentine’s pairing menu is R1,495 per couple — five courses with two paired wines. Slots at 18:00 and 20:30.', at: '09:03' },
      { from: 'customer', text: 'Is the 20:30 one still open for 2 people?', at: '09:14' },
    ],
  },
  {
    id: 'demo-conv-3',
    contactName: 'Ayesha Patel',
    phone: '+27 83 774 1120',
    channel: 'whatsapp',
    subject: 'Loyalty points redemption + dessert',
    valueCents: 85_000,
    status: 'open',
    isVip: true,
    unread: 0,
    lastActive: '26 min ago',
    transcript: [
      { from: 'customer', text: 'REDEEM', at: '13:05' },
      { from: 'ai', text: 'You have 350 loyalty points — a free dessert (150 pts) or R150 off your bill (300 pts). Reply 1 or 2.', at: '13:05' },
      { from: 'customer', text: '2 please', at: '13:06' },
      { from: 'ai', text: 'Done — R150 off applied to table 14. GPS verification will confirm when you arrive. Enjoy! 🍨', at: '13:06' },
    ],
  },
  {
    id: 'demo-conv-4',
    contactName: 'Johan van der Merwe',
    phone: '+27 60 918 2277',
    channel: 'whatsapp',
    subject: 'Cancellation — Friday booking GEM-3987',
    valueCents: -120_000,
    status: 'pending',
    isVip: false,
    unread: 1,
    lastActive: '1 hour ago',
    transcript: [
      { from: 'customer', text: 'Unfortunately we need to cancel Friday’s table for 4. Family emergency.', at: '07:22' },
      { from: 'ai', text: 'So sorry to hear that, Johan. Your booking is cancelled — no fee charged. Would you like me to offer the slot to the waitlist and rebook you for next week?', at: '07:23' },
      { from: 'ai', text: 'Approval requested: manual follow-up with a rebooking offer (YELLOW reply).', at: '07:24' },
    ],
  },
  {
    id: 'demo-conv-5',
    contactName: 'Nomvula Khumalo',
    phone: '+27 84 220 5566',
    channel: 'whatsapp',
    subject: 'Vip walk-in alert — 5th visit this month',
    valueCents: 460_000,
    status: 'closed',
    isVip: true,
    unread: 0,
    lastActive: '3 hours ago',
    transcript: [
      { from: 'ai', text: '⭐ VIP ARRIVAL: Nomvula Khumalo (5th visit this month, lifetime spend R12,400) just walked in. Greet by name, offer the corner table she prefers.', at: '12:08' },
      { from: 'ai', text: 'Staff acknowledged. Loyalty earn applied: +40 points for visit.', at: '12:09' },
    ],
  },
  {
    id: 'demo-conv-6',
    contactName: 'Restaurant Week SA',
    phone: '+27 21 400 0100',
    channel: 'email',
    subject: 'Partnership: Restaurant Week September listings',
    valueCents: 0,
    status: 'pending',
    isVip: false,
    unread: 1,
    lastActive: '5 hours ago',
    transcript: [
      { from: 'customer', text: 'Dear Marble team, your Restaurant Week listing is pending confirmation. 300 covers over 10 days — please confirm participation by Friday.', at: '08:15' },
    ],
  },
  {
    id: 'demo-conv-7',
    contactName: 'Lebo Mokoena',
    phone: '+27 73 118 6634',
    channel: 'whatsapp',
    subject: 'Dietary allergy — Saturday tasting menu',
    valueCents: 595_000,
    status: 'closed',
    isVip: false,
    unread: 0,
    lastActive: '8 hours ago',
    transcript: [
      { from: 'customer', text: 'Hi, I have a shellfish allergy — is the Saturday tasting menu safe for me?', at: '15:30' },
      { from: 'ai', text: 'Yes — Chef can substitute the prawn course with the linefish alternative. I have flagged the allergy on your booking GEM-4021 so the kitchen sees it on the pass.', at: '15:31' },
      { from: 'customer', text: 'Amazing, thank you!', at: '15:33' },
    ],
  },
  {
    id: 'demo-conv-8',
    contactName: 'Katlego Mabaso',
    phone: '+27 65 447 8890',
    channel: 'whatsapp',
    subject: 'Sunday lunch for the family (12 people)',
    valueCents: 732_000,
    status: 'waiting',
    isVip: false,
    unread: 2,
    lastActive: 'yesterday',
    transcript: [
      { from: 'customer', text: 'Dumela! Can we do Sunday lunch for 12? Two toddlers included.', at: '16:44' },
      { from: 'ai', text: 'Dumela, Katlego! For 12 we can set the long table on the terrace. Kids menu available. Would 12:30 or 13:30 suit?', at: '16:45' },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Google reviews (Reputation widget)
// ─────────────────────────────────────────────────────────────────────────────

export interface DemoReview {
  reviewer: string;
  rating: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  text: string;
  date: string;
  replied: boolean;
}

export const DEMO_REVIEWS: DemoReview[] = [
  {
    reviewer: 'Pieter S.',
    rating: 5,
    sentiment: 'positive',
    text: 'The WhatsApp concierge booked our anniversary table in under a minute and remembered my wife’s wine preference from last time. Best-run restaurant in Joburg.',
    date: '2026-08-29',
    replied: true,
  },
  {
    reviewer: 'Chantelle V.',
    rating: 5,
    sentiment: 'positive',
    text: 'Wood-fired dishes are exceptional. The loyalty R150-off via WhatsApp felt effortless — no apps, no cards.',
    date: '2026-08-27',
    replied: true,
  },
  {
    reviewer: 'David K.',
    rating: 4,
    sentiment: 'positive',
    text: 'Great food, slight wait for mains on Saturday. They messaged us mid-wait offering a complimentary dessert — classy recovery.',
    date: '2026-08-25',
    replied: true,
  },
  {
    reviewer: 'Fatima A.',
    rating: 5,
    sentiment: 'positive',
    text: 'Booked a work lunch of 10 over WhatsApp while stuck in traffic. Confirmation and reminders were flawless.',
    date: '2026-08-24',
    replied: false,
  },
  {
    reviewer: 'Sven L.',
    rating: 3,
    sentiment: 'neutral',
    text: 'Food was good but the terrace was noisy with the large table next to us. Staff did their best.',
    date: '2026-08-22',
    replied: true,
  },
  {
    reviewer: 'Mandisa N.',
    rating: 2,
    sentiment: 'negative',
    text: 'Our booking was double-booked on Friday night. They apologised and comped the meal, but we lost an hour waiting.',
    date: '2026-08-20',
    replied: true,
  },
  {
    reviewer: 'Rob T.',
    rating: 1,
    sentiment: 'negative',
    text: 'Waited 20 minutes past our slot with no update. Left before ordering.',
    date: '2026-08-18',
    replied: false,
  },
  {
    reviewer: 'Zanele M.',
    rating: 5,
    sentiment: 'positive',
    text: 'The 48-hour and same-day WhatsApp reminders are genius — we have not missed a booking since we started using them.',
    date: '2026-08-15',
    replied: true,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// VIPs + campaigns (Customers / Marketing widgets)
// ─────────────────────────────────────────────────────────────────────────────

export interface DemoVip {
  name: string;
  phone: string;
  visits: number;
  lifetimeSpendCents: number;
  favourite: string;
  lastVisit: string;
}

export const DEMO_VIPS: DemoVip[] = [
  { name: 'Thandi Mkhize', phone: '+27 82 551 0043', visits: 34, lifetimeSpendCents: 1_240_000, favourite: 'Chef’s tasting menu · Chenin Blanc', lastVisit: '2026-08-24' },
  { name: 'Nomvula Khumalo', phone: '+27 84 220 5566', visits: 28, lifetimeSpendCents: 986_000, favourite: 'Corner table · Rib-eye (medium-rare)', lastVisit: '2026-08-30' },
  { name: 'Ayesha Patel', phone: '+27 83 774 1120', visits: 19, lifetimeSpendCents: 612_000, favourite: 'Linefish · elderflower spritz', lastVisit: '2026-08-29' },
  { name: 'Johan van der Merwe', phone: '+27 60 918 2277', visits: 12, lifetimeSpendCents: 348_000, favourite: 'Oxtail · Cabernet', lastVisit: '2026-08-16' },
  { name: 'Katlego Mabaso', phone: '+27 65 447 8890', visits: 9, lifetimeSpendCents: 271_000, favourite: 'Sunday terrace lunch · kids menu', lastVisit: '2026-08-10' },
];

export interface DemoCampaign {
  name: string;
  audience: string;
  sent: number;
  opened: number;
  redeemed: number;
  revenueCents: number;
}

export const DEMO_CAMPAIGNS: DemoCampaign[] = [
  { name: 'Winter Warm-up: 2-for-1 mulled wine', audience: 'At-risk (189 contacts)', sent: 189, opened: 142, redeemed: 47, revenueCents: 286_000 },
  { name: 'VIP early access — Spring tasting menu', audience: 'VIP (312 contacts)', sent: 312, opened: 288, redeemed: 96, revenueCents: 1_242_000 },
  { name: 'We miss you — R150 loyalty credit', audience: 'Dormant 90+ days (421 contacts)', sent: 421, opened: 233, redeemed: 58, revenueCents: 431_000 },
  { name: 'Sunday family lunch, kids eat free', audience: 'Families with kids (84 contacts)', sent: 84, opened: 71, redeemed: 31, revenueCents: 389_000 },
];
