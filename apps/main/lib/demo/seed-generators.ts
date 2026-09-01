import { deadId } from './deadbeef.ts';

/**
 * Demo Mode — pure seed generators.
 *
 * Every generator is a pure function of (tenantId, now, rng): deterministic
 * counts, realistic South African restaurant data, and dates RELATIVE TO NOW
 * so dashboards always look fresh. No I/O — the DB writes live in
 * ./seed-store.ts.
 */

// ---------------------------------------------------------------------------
// Deterministic RNG (mulberry32) — same seed, same restaurant, every run.
// ---------------------------------------------------------------------------
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Thabo', 'Naledi', 'Sipho', 'Lerato', 'Kagiso', 'Palesa', 'Tumelo', 'Refilwe', 'Mandla', 'Zanele',
  'Pieter', 'Anri', 'Johan', 'Sunette', 'Willem', 'Chanté', 'Raj', 'Priya', 'Devon', 'Aisha',
  'Karabo', 'Mpho', 'Tshepo', 'Dineo', 'Rendani', 'Nomsa', 'Bongani', 'Sibusiso', 'Ayanda', 'Nomvula',
  'Elena', 'Marco', 'Sofia', 'Dimitri', 'Fatima', 'Ahmed', 'Grace', 'Samuel', 'Olivia', 'Daniel',
];

const LAST_NAMES = [
  'Mokoena', 'Dlamini', 'Khumalo', 'Nkosi', 'Mahlangu', 'Radebe', 'Sithole', 'Ngcobo', 'Zulu', 'Tshabalala',
  'van der Merwe', 'Botha', 'Pretorius', 'du Toit', 'Venter', 'Naidoo', 'Pillay', 'Govender', 'Smith', 'Jacobs',
  'Williams', 'Abrahams', 'Davids', 'Hendricks', 'Marais', 'Steyn', 'Oosthuizen', 'Barnard', 'Le Roux', 'Swanepoel',
];

export function saName(rng: () => number): string {
  return `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]}`;
}

export function saPhone(rng: () => number, index: number): string {
  const prefixes = ['82', '83', '84', '72', '73', '79', '61', '65'];
  const prefix = prefixes[index % prefixes.length];
  return `+27${prefix}${String(1000000 + Math.floor(rng() * 8999999))}`;
}

function daysAgo(now: Date, days: number, hourShift = 0): Date {
  const d = new Date(now.getTime() - days * 24 * 3600 * 1000 + hourShift * 3600 * 1000);
  return d;
}

function daysAhead(now: Date, days: number, hourShift = 0): Date {
  return new Date(now.getTime() + days * 24 * 3600 * 1000 + hourShift * 3600 * 1000);
}

// ---------------------------------------------------------------------------
// 1. Customers — 850 across the four lifecycle segments.
// ---------------------------------------------------------------------------
export interface DemoCustomer {
  id: string;
  name: string;
  phone: string;
  vip: boolean;
  blocklisted: boolean;
  birthday: string | null; // MM-DD
  loyaltyPoints: number;
  // profile fields
  segment: 'vip' | 'regular' | 'at_risk' | 'dormant' | 'new';
  totalVisits: number;
  totalSpendCents: number;
  avgPartySize: string;
  lastVisitAt: Date | null;
  firstVisitAt: Date;
}

export const CUSTOMER_PLAN = { vip: 90, regular: 380, atRisk: 140, dormant: 240 } as const;
export const CUSTOMER_TOTAL =
  CUSTOMER_PLAN.vip + CUSTOMER_PLAN.regular + CUSTOMER_PLAN.atRisk + CUSTOMER_PLAN.dormant;

export function generateCustomers(tenantId: string, now: Date, rng: () => number = makeRng(11)): DemoCustomer[] {
  const rows: DemoCustomer[] = [];
  let i = 0;

  const push = (segment: DemoCustomer['segment'], count: number, mk: (k: number) => Partial<DemoCustomer>) => {
    for (let k = 0; k < count; k++) {
      const name = saName(rng);
      const phone = saPhone(rng, i);
      const base: DemoCustomer = {
        id: deadId('contact', i),
        name,
        phone,
        vip: segment === 'vip',
        blocklisted: false,
        birthday: null,
        loyaltyPoints: 0,
        segment,
        totalVisits: 1,
        totalSpendCents: 35000,
        avgPartySize: '2.0',
        lastVisitAt: daysAgo(now, 5),
        firstVisitAt: daysAgo(now, 200),
        ...mk(k),
      };
      rows.push(base);
      i++;
    }
  };

  // VIPs: LTV R4k–R45k, 10–90 visits.
  push('vip', CUSTOMER_PLAN.vip, (k) => ({
    totalVisits: 10 + Math.floor(rng() * 81),
    totalSpendCents: 400000 + Math.floor(rng() * 4100000),
    avgPartySize: (2 + rng() * 4).toFixed(1),
    lastVisitAt: daysAgo(now, Math.floor(rng() * 21)),
    firstVisitAt: daysAgo(now, 300 + Math.floor(rng() * 400)),
    loyaltyPoints: k < 50 ? 500 + Math.floor(rng() * 9500) : 0, // ~50 with points (R1 = 1pt)
  }));

  // Regulars.
  push('regular', CUSTOMER_PLAN.regular, () => ({
    totalVisits: 3 + Math.floor(rng() * 9),
    totalSpendCents: 90000 + Math.floor(rng() * 310000),
    lastVisitAt: daysAgo(now, Math.floor(rng() * 45)),
    firstVisitAt: daysAgo(now, 120 + Math.floor(rng() * 300)),
  }));

  // At-risk (drifting away).
  push('at_risk', CUSTOMER_PLAN.atRisk, () => ({
    totalVisits: 2 + Math.floor(rng() * 6),
    totalSpendCents: 60000 + Math.floor(rng() * 200000),
    lastVisitAt: daysAgo(now, 45 + Math.floor(rng() * 60)),
    firstVisitAt: daysAgo(now, 200 + Math.floor(rng() * 300)),
  }));

  // Dormant: stale last visit + low engagement.
  push('dormant', CUSTOMER_PLAN.dormant, () => ({
    totalVisits: 1 + Math.floor(rng() * 3),
    totalSpendCents: 30000 + Math.floor(rng() * 90000),
    lastVisitAt: daysAgo(now, 120 + Math.floor(rng() * 180)),
    firstVisitAt: daysAgo(now, 350 + Math.floor(rng() * 300)),
  }));

  // ~12 birthdays inside the next 7 days; a few opt-outs.
  for (let b = 0; b < 12; b++) {
    const target = rows[b * 60 + 5];
    if (target) {
      const d = daysAhead(now, b % 7);
      target.birthday = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  for (let o = 0; o < 6; o++) {
    rows[o * 130 + 40].blocklisted = true;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 2. Revenue — 90 days, R6k–R18k/day with Fri/Sat peaks + recovered revenue.
// ---------------------------------------------------------------------------
export interface DemoRevenueEvent {
  id: string;
  eventType: 'verified_booking' | 'recovered';
  estimatedValueCents: number;
  realizedCents: number;
  occurredAt: Date;
}

export function generateRevenueEvents(tenantId: string, now: Date, rng: () => number = makeRng(22)): DemoRevenueEvent[] {
  const rows: DemoRevenueEvent[] = [];
  let i = 0;
  for (let day = 0; day < 90; day++) {
    const date = daysAgo(now, day, -12);
    const dow = date.getDay(); // 0 Sun ... 6 Sat
    const weekend = dow === 5 || dow === 6;
    const base = weekend ? 11000 + rng() * 7000 : 6000 + rng() * 7000; // R6k–R18k
    rows.push({
      id: deadId('revenue', i++),
      eventType: 'verified_booking',
      estimatedValueCents: Math.round(base * 100),
      realizedCents: Math.round(base * 100 * (0.9 + rng() * 0.1)),
      occurredAt: date,
    });
    // Recovered revenue: reactivations/no-show saves, ~R35k/month (~R105k/90d).
    if (day % 3 === 0) {
      const recovered = 2800 + rng() * 2200; // R2.8–5k every 3 days ≈ R35k/month
      rows.push({
        id: deadId('revenue', i++),
        eventType: 'recovered',
        estimatedValueCents: Math.round(recovered * 100),
        realizedCents: Math.round(recovered * 100 * 0.8),
        occurredAt: date,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 3. Bookings — 120 past (mostly honoured), 40 upcoming, 6 VIPs TODAY.
// ---------------------------------------------------------------------------
export interface DemoBooking {
  id: string;
  customerName: string;
  customerPhone: string;
  date: Date;
  partySize: number;
  status: 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  noShowDetected: boolean;
  cancelledAt: Date | null;
}

export function generateBookings(
  tenantId: string,
  now: Date,
  customers: DemoCustomer[],
  rng: () => number = makeRng(33)
): DemoBooking[] {
  const rows: DemoBooking[] = [];
  let i = 0;
  const pick = (): DemoCustomer => customers[Math.floor(rng() * customers.length)];

  // 120 past bookings over the last 30 days.
  for (let k = 0; k < 120; k++) {
    const c = pick();
    const date = daysAgo(now, Math.floor(rng() * 30), -Math.floor(4 + rng() * 14));
    const bad = k % 15 === 0; // ~8 no-shows/cancels
    const cancelled = k % 30 === 0;
    rows.push({
      id: deadId('booking', i++),
      customerName: c.name,
      customerPhone: c.phone,
      date,
      partySize: 2 + Math.floor(rng() * 5),
      status: cancelled ? 'cancelled' : bad ? 'no_show' : 'completed',
      noShowDetected: bad && !cancelled,
      cancelledAt: cancelled ? date : null,
    });
  }

  // 40 upcoming over the next 7 days.
  for (let k = 0; k < 40; k++) {
    const c = pick();
    rows.push({
      id: deadId('booking', i++),
      customerName: c.name,
      customerPhone: c.phone,
      date: daysAhead(now, Math.floor(rng() * 7), Math.floor(1 + rng() * 12)),
      partySize: 2 + Math.floor(rng() * 6),
      status: 'confirmed',
      noShowDetected: false,
      cancelledAt: null,
    });
  }

  // 6 VIPs booked TODAY (VIP Today page).
  const vips = customers.filter((c) => c.vip);
  for (let k = 0; k < 6; k++) {
    const c = vips[k % vips.length];
    rows.push({
      id: deadId('booking', i++),
      customerName: c.name,
      customerPhone: c.phone,
      date: daysAhead(now, 0, Math.floor(2 + k * 2)),
      partySize: 2 + Math.floor(rng() * 4),
      status: 'confirmed',
      noShowDetected: false,
      cancelledAt: null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 4. WhatsApp conversations — grounded AI replies + approval queue.
// ---------------------------------------------------------------------------
export interface DemoMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string;
  isAIGenerated: boolean;
  deliveryStatus: 'delivered' | 'sent';
  createdAt: Date;
}

export interface DemoConversation {
  id: string;
  customerName: string;
  customerPhone: string;
  outcome: 'booked' | 'waitlisted' | 'deposit' | null;
  estimatedValueCents: number;
  lastMessageAt: Date;
  createdAt: Date;
  messages: DemoMessage[];
  approval: { messageText: string; riskLevel: 'yellow' | 'red'; status: 'pending' } | null;
}

export function generateConversations(
  tenantId: string,
  now: Date,
  customers: DemoCustomer[],
  rng: () => number = makeRng(44)
): DemoConversation[] {
  const rows: DemoConversation[] = [];
  let i = 0;
  let m = 0;
  const outcomes: DemoConversation['outcome'][] = ['booked', 'waitlisted', 'deposit'];

  for (let k = 0; k < 60; k++) {
    const c = customers[Math.floor(rng() * customers.length)];
    const activeToday = k < 25; // 25 active today
    const created = activeToday
      ? daysAgo(now, 0, -Math.floor(1 + rng() * 9))
      : daysAgo(now, Math.floor(rng() * 14), -Math.floor(rng() * 12));
    const outcome = outcomes[k % 3];
    const value = outcome === 'deposit' ? 50000 : outcome === 'booked' ? 18000 : 4000;

    const ask = [
      'Hi! Do you have a table for 4 on Saturday evening?',
      'Good evening — is the tasting menu available tonight?',
      'Can I book for 2 at 7pm on Friday?',
      'Do you take walk-ins for lunch on Sundays?',
      'Hi there, we are 8 people for the 24th — can you fit us?',
    ][k % 5];
    const answer = [
      'Absolutely! I have booked you a table for 4 this Saturday at 19:00. We look forward to hosting you! 🍽️',
      'Yes, the tasting menu is on tonight from 18:00. Shall I reserve your seats?',
      'Done — a table for 2 at 19:00 on Friday is confirmed. See you soon!',
      'We welcome walk-ins for lunch, but bookings get priority. Want me to hold a table?',
      'For 8 guests on the 24th I can offer our long table at 19:30 — a R200 deposit secures it. Shall I send the payment link?',
    ][k % 5];

    const messages: DemoMessage[] = [
      {
        id: deadId('message', m++),
        direction: 'inbound',
        content: ask,
        isAIGenerated: false,
        deliveryStatus: 'delivered',
        createdAt: created,
      },
      {
        id: deadId('message', m++),
        direction: 'outbound',
        content: answer,
        isAIGenerated: true,
        deliveryStatus: 'delivered',
        createdAt: new Date(created.getTime() + 40_000),
      },
    ];

    // 2 YELLOW + 1 RED pending approvals (spec).
    let approval: DemoConversation['approval'] = null;
    if (k === 56) {
      approval = {
        messageText: 'We can offer you a 15% discount if you move your booking to 21:00 — shall I confirm?',
        riskLevel: 'yellow',
        status: 'pending',
      };
    } else if (k === 57) {
      approval = {
        messageText: 'I can hold the table, but please note large parties pay a R150/pp deposit. Payment link: pay.example/d4',
        riskLevel: 'yellow',
        status: 'pending',
      };
    } else if (k === 58) {
      approval = {
        messageText: 'Sorry about last night — please accept a complimentary dinner for two. When suits you?',
        riskLevel: 'red',
        status: 'pending',
      };
    }
    if (approval) {
      messages.push({
        id: deadId('message', m++),
        direction: 'outbound',
        content: approval.messageText,
        isAIGenerated: true,
        deliveryStatus: 'sent', // draft — held for approval, not delivered
        createdAt: new Date(created.getTime() + 80_000),
      });
    }

    rows.push({
      id: deadId('conversation', i++),
      customerName: c.name,
      customerPhone: c.phone,
      outcome,
      estimatedValueCents: value,
      lastMessageAt: messages[messages.length - 1].createdAt,
      createdAt: created,
      messages,
      approval,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 5. Google reviews — avg ≈ 4.6, three unanswered with AI drafts.
// ---------------------------------------------------------------------------
export interface DemoReview {
  id: string;
  authorName: string;
  rating: number;
  text: string;
  time: Date;
  sentiment: 'positive' | 'neutral' | 'negative';
  responseText: string | null;
  responseSentAt: Date | null;
}

export function generateReviews(tenantId: string, now: Date, rng: () => number = makeRng(55)): DemoReview[] {
  const rows: DemoReview[] = [];
  // UI-3R / F7 (S12) — seed reviews must read like real humans: the old
  // arrays cycled 6 praise sentences across 36 positive reviews, so the
  // same sentence appeared under five different names. Every review now
  // composes a DISTINCT text (base + specific detail), deterministically.
  const praiseBases = [
    'Incredible food and warm service',
    'Best breakfast in the neighbourhood',
    'The waiter knew the menu inside out',
    'Great wine list and generous portions',
    'Cosy spot for date night',
    'Quick booking over WhatsApp and a warm welcome',
    'The lamb shoulder is worth the trip alone',
    'Consistently excellent, visit after visit',
    'Beautiful plating and honest prices',
    'The Sunday roast proper rivalled my gran’s',
  ];
  const praiseTails = [
    '— the lamb was perfect!',
    '— will definitely be back.',
    '— lovely evening from start to finish.',
    '— desserts were the highlight.',
    '— five stars, easily.',
    '— staff remembered our usual table.',
    '— even the bread course felt special.',
    '— booking to table took two minutes.',
    '— we lingered long past dessert.',
    '— already recommended it to friends.',
  ];
  const fourBases = [
    'Great food, slight wait for mains on a busy night — the kitchen recovered well.',
    'Lovely ambience and attentive staff; mains were a touch under-seasoned.',
    'Solid neighbourhood spot. The specials board is where the kitchen shines.',
    'Good value set menu, though the room gets loud after eight.',
    'Service was friendly and fast; the seafood starter stole the show.',
    'Enjoyable evening overall — parking remains the only headache.',
  ];
  const midBases = [
    'Food was good, service a little slow on a busy night',
    'Lovely ambience, mains slightly salty for my taste',
    'Nice spot, but parking is tricky on weekends',
    'Decent meal, though the music drowned our conversation',
    'Pleasant lunch, the starter outshone the main',
    'Mixed feelings — great dessert, forgettable starter',
  ];
  const midTails = [
    '— staff apologised for the wait.',
    '— we would return off-peak.',
    '— the manager handled it well.',
    '— worth another try on a quieter night.',
    '— portion sizes were fair.',
    '— the wine pairing helped.',
  ];
  let ratingBag: number[] = [];
  // avg ≈ 4.6: 30×5★, 6×4★, 3×3★, 1×1★ = (150+24+9+1)/40 = 4.6
  ratingBag = ratingBag.concat(Array(30).fill(5), Array(6).fill(4), Array(3).fill(3), [1]);

  let fiveIdx = 0;
  let fourIdx = 0;
  let midIdx = 0;
  for (let k = 0; k < 40; k++) {
    const rating = ratingBag[k];
    const author = saName(rng);
    const text =
      rating === 1
        ? 'Terrible service. We waited 40 minutes and the order arrived wrong. Disappointed.'
        : rating === 3
          ? `${midBases[midIdx % midBases.length]} ${midTails[midIdx % midTails.length]}`
          : rating === 4
            ? fourBases[fourIdx++ % fourBases.length]
            : `${praiseBases[fiveIdx % praiseBases.length]} ${praiseTails[Math.floor(fiveIdx / 10) % praiseTails.length]}`;
    if (rating === 5) fiveIdx += 1;
    if (rating === 3) midIdx += 1;
    const unanswered = k >= 37; // last three unanswered with AI drafts
    rows.push({
      id: deadId('review', k),
      authorName: author,
      rating,
      text,
      time: daysAgo(now, Math.floor(rng() * 60), -Math.floor(rng() * 12)),
      sentiment: rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative',
      responseText: unanswered
        ? rating === 1
          ? 'Thank you for the honest feedback — this is not the standard we hold ourselves to. Please contact us directly so we can make it right; your next visit is on us.'
          : 'Thank you for visiting! We are glad you enjoyed it and would love to welcome you back soon.'
        : 'Thank you so much — we cannot wait to host you again!',
      responseSentAt: unanswered ? null : daysAgo(now, Math.floor(rng() * 30)),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 6. Campaigns, briefs, calendar.
// ---------------------------------------------------------------------------
export interface DemoCampaign {
  id: string;
  name: string;
  type: 'reactivation' | 'vip' | 'seasonal' | 'announcement';
  targetSegment: string;
  offer: string;
  message: string;
  status: 'draft' | 'scheduled' | 'launched' | 'completed';
  launchedAt: Date | null;
  estimatedReach: number;
  estimatedRevenueCents: number;
  attributedCents: number;
}

export function generateCampaigns(tenantId: string, now: Date): DemoCampaign[] {
  return [
    {
      id: deadId('campaign', 0),
      name: 'Winter Reactivation',
      type: 'reactivation',
      targetSegment: 'at_risk',
      offer: 'R100 off mains',
      message: 'We miss you! Come back this week and enjoy R100 off your mains.',
      status: 'launched',
      launchedAt: daysAgo(now, 9),
      estimatedReach: 140,
      estimatedRevenueCents: 180000,
      attributedCents: 240000, // recovered R2,400
    },
    {
      id: deadId('campaign', 1),
      name: 'VIP Appreciation Week',
      type: 'vip',
      targetSegment: 'vip',
      offer: 'Complimentary dessert',
      message: 'Our VIPs eat dessert on us this week. Book your table!',
      status: 'launched',
      launchedAt: daysAgo(now, 4),
      estimatedReach: 90,
      estimatedRevenueCents: 260000,
      attributedCents: 320000, // recovered R3,200
    },
    {
      id: deadId('campaign', 2),
      name: 'Spring Menu Launch',
      type: 'seasonal',
      targetSegment: 'regular',
      offer: 'New menu preview',
      message: 'The new spring menu has landed — be among the first to taste it.',
      status: 'completed',
      launchedAt: daysAgo(now, 25),
      estimatedReach: 380,
      estimatedRevenueCents: 420000,
      attributedCents: 380000,
    },
    {
      id: deadId('campaign', 3),
      name: 'Live Jazz Friday',
      type: 'announcement',
      targetSegment: 'all',
      offer: 'Live music from 19:00',
      message: 'This Friday: live jazz on the terrace. Tables going fast!',
      status: 'draft',
      launchedAt: null,
      estimatedReach: 850,
      estimatedRevenueCents: 300000,
      attributedCents: 0,
    },
    {
      id: deadId('campaign', 4),
      name: 'Kids Eat Free Sunday',
      type: 'seasonal',
      targetSegment: 'regular',
      offer: 'Kids eat free',
      message: 'Sundays are family days — kids eat free with every adult main.',
      status: 'scheduled',
      launchedAt: daysAhead(now, 3),
      estimatedReach: 300,
      estimatedRevenueCents: 220000,
      attributedCents: 0,
    },
    {
      id: deadId('campaign', 5),
      name: 'Birthday Club',
      type: 'vip',
      targetSegment: 'vip',
      offer: 'Free dessert on your birthday',
      message: 'Happy birthday from all of us — your dessert is on the house today!',
      status: 'scheduled',
      launchedAt: daysAhead(now, 6),
      estimatedReach: 120,
      estimatedRevenueCents: 90000,
      attributedCents: 0,
    },
  ];
}

export function generateBriefs(tenantId: string, now: Date): { id: string; brief: object; generatedAt: Date }[] {
  const rows: { id: string; brief: object; generatedAt: Date }[] = [];
  for (let d = 0; d < 8; d++) {
    const date = d === 0 ? now : daysAgo(now, d, -8);
    rows.push({
      id: deadId('brief', d),
      generatedAt: date,
      brief: {
        headline: d === 0 ? 'Busy Friday ahead — 6 VIPs booked tonight' : `Service recap for ${date.toISOString().slice(0, 10)}`,
        revenue: `${6 + Math.floor(Math.random() * 0) + (d % 4) + 8}k verified`,
        suggestion:
          d === 0
            ? 'Send a welcome message to the 6 VIPs booked today and offer the chef&aposs special.'
            : 'Follow up with yesterday&aposs large party about their anniversary visit.',
      },
    });
  }
  return rows;
}

export function generateCalendar(tenantId: string, now: Date): {
  id: string;
  name: string;
  description: string;
  eventType: 'special' | 'live_music' | 'tasting' | 'holiday' | 'custom';
  startsAt: Date;
  endsAt: Date;
  status: 'draft' | 'published';
}[] {
  const types: ('special' | 'live_music' | 'tasting' | 'custom')[] = ['live_music', 'special', 'tasting', 'custom', 'live_music', 'special', 'tasting'];
  const names = [
    'Live Jazz on the Terrace',
    'Chef&aposs Winter Special',
    'Wine Pairing Evening',
    'Family Sunday Roast',
    'Acoustic Night',
    'Harvest Menu Launch',
    'Whisky & Chocolate Tasting',
  ];
  return types.map((eventType, k) => ({
    id: deadId('event', k),
    name: names[k],
    description: 'Auto-generated content calendar entry (demo).',
    eventType,
    startsAt: daysAhead(now, k, 6),
    endsAt: daysAhead(now, k, 10),
    status: k < 3 ? 'published' : 'draft', // some already marked posted
  }));
}

// ---------------------------------------------------------------------------
// 7. Market intelligence — competitors, alerts, opportunities.
// ---------------------------------------------------------------------------
export interface DemoCompetitor {
  id: string;
  name: string;
  distanceKm: string;
  currentRating: string;
  reviewCount: number;
  placeData: object;
}

export function generateCompetitors(tenantId: string): DemoCompetitor[] {
  const specs = [
    { name: 'The Kitchen Door', km: '1.2', rating: '4.5', reviews: 612, price: 'R150–R250' },
    { name: 'Marble Terrace', km: '2.4', rating: '4.3', reviews: 480, price: 'R180–R300' },
    { name: 'Salsa Verde', km: '3.1', rating: '4.1', reviews: 350, price: 'R120–R200' },
    { name: 'Kream House', km: '4.0', rating: '4.6', reviews: 890, price: 'R250–R400' },
    { name: 'The Local Grill', km: '4.8', rating: '4.0', reviews: 270, price: 'R100–R180' },
  ];
  return specs.map((s, k) => ({
    id: deadId('competitor', k),
    name: s.name,
    distanceKm: s.km,
    currentRating: s.rating,
    reviewCount: s.reviews,
    placeData: { priceRange: s.price },
  }));
}

export function generateMarketAlerts(now: Date): {
  snapshots: { id: string; competitorIndex: number; menuText: string; priceRange: string; snapshotAt: Date }[];
  promotions: { id: string; competitorIndex: number; promotionText: string; source: string; detectedAt: Date }[];
} {
  return {
    snapshots: [
      {
        id: deadId('snapshot', 0),
        competitorIndex: 0,
        menuText: 'Added: Truffle gnocchi R185; Removed: Spring lamb',
        priceRange: 'R150–R260',
        snapshotAt: daysAgo(now, 2),
      },
      {
        id: deadId('snapshot', 1),
        competitorIndex: 3,
        menuText: 'Prices raised ~8% across mains',
        priceRange: 'R270–R430',
        snapshotAt: daysAgo(now, 5),
      },
    ],
    promotions: [
      {
        id: deadId('promo', 0),
        competitorIndex: 1,
        promotionText: '2-for-1 burgers every Tuesday',
        source: 'instagram',
        detectedAt: daysAgo(now, 1),
      },
    ],
  };
}

export function generateOpportunities(tenantId: string, now: Date): {
  id: string;
  key: string;
  opportunityType: string;
  title: string;
  description: string;
  confidence: string;
}[] {
  return [
    {
      id: deadId('opportunity', 0),
      key: 'sunday-brunch-gap',
      opportunityType: 'gap',
      title: 'Sunday brunch gap',
      description: 'No competitor within 3km serves brunch after 11:00 on Sundays; review demand mentions brunch 23 times this quarter.',
      confidence: '0.85',
    },
    {
      id: deadId('opportunity', 1),
      key: 'corporate-lunch',
      opportunityType: 'segment',
      title: 'Corporate lunch traffic',
      description: 'Two office parks within 1.5km; a fixed R135 two-course lunch could capture weekday volume.',
      confidence: '0.72',
    },
    {
      id: deadId('opportunity', 2),
      key: 'price-positioning',
      opportunityType: 'pricing',
      title: 'Premium positioning headroom',
      description: 'Average competitor main prices rose 6% this quarter while yours held flat — room for a selective increase.',
      confidence: '0.64',
    },
  ];
}

// ---------------------------------------------------------------------------
// GATE PM-1 — PulseMap demo simulations. Two seeded forecasts for The Grand
// Bistro's own seeded campaigns, generated by the SAME deterministic demo
// forecaster the Simulate button uses in Demo Mode (consistency by
// construction — the chips on the campaign list match what the button
// produces). Segment summaries mirror the customer plan averages above.
// ---------------------------------------------------------------------------
import type { SimulationContext } from '../pulsemap/types.ts';
import { generateDemoForecast } from '../pulsemap/demo-forecast.ts';

export const DEMO_SEGMENT_SUMMARIES = [
  { segment: 'vip', count: 90, avgVisits: 14, avgSpendCents: 260000, avgDaysSinceLastVisit: 25 },
  { segment: 'regular', count: 380, avgVisits: 8, avgSpendCents: 110000, avgDaysSinceLastVisit: 40 },
  { segment: 'at_risk', count: 140, avgVisits: 5, avgSpendCents: 70000, avgDaysSinceLastVisit: 150 },
  { segment: 'dormant', count: 240, avgVisits: 3, avgSpendCents: 45000, avgDaysSinceLastVisit: 260 },
  { segment: 'new', count: 0, avgVisits: 0, avgSpendCents: 0, avgDaysSinceLastVisit: null },
] as const;

export interface DemoPulsemapSimulation {
  id: string;
  campaignId: string;
  inputHash: string;
  forecast: ReturnType<typeof generateDemoForecast>;
  appliedAt: Date | null;
}

export function generatePulsemapSimulations(tenantId: string, now: Date): DemoPulsemapSimulation[] {
  const campaigns = generateCampaigns(tenantId, now);
  const restaurant = { name: 'The Grand Bistro', description: 'A warm, modern bistro in Rosebank.', openingHours: 'Mon - Sun: 11:30 - 22:00' };
  const out: DemoPulsemapSimulation[] = [];
  const plans: Array<{ campaignIndex: number; applied: boolean }> = [
    { campaignIndex: 3, applied: false }, // Live Jazz Friday — the DRAFT campaign (the simulate-me story)
    { campaignIndex: 4, applied: true }, // Kids Eat Free Sunday — already improved + applied
  ];
  let i = 0;
  for (const plan of plans) {
    const campaign = campaigns[plan.campaignIndex];
    if (!campaign) continue;
    const ctx: SimulationContext = {
      draft: {
        title: campaign.name,
        message: campaign.message,
        offer: campaign.offer,
        targetSegment: campaign.targetSegment,
        sendAt: campaign.launchedAt ? new Date(campaign.launchedAt).toISOString() : null,
      },
      restaurant,
      segmentSummaries: DEMO_SEGMENT_SUMMARIES.map((s) => ({ ...s })),
      pastCampaigns: campaigns.slice(0, 3).map((c) => ({
        name: c.name,
        status: c.status === 'launched' || c.status === 'completed' ? 'sent' : c.status,
        targetSegment: c.targetSegment,
        sentCount: c.status === 'launched' || c.status === 'completed' ? c.estimatedReach : 0,
        estimatedReach: c.estimatedReach,
        estimatedRevenueCents: c.estimatedRevenueCents,
      })),
      reviewSignal: { totalReviews: 312, avgRating: 4.6, themes: ['steak', 'service', 'vibe', 'dessert'] },
      marketSignal: { competitorCount: 6, avgCompetitorRating: 4.2, activePromotions: 3 },
    };
    out.push({
      id: deadId('pulsemap', i),
      campaignId: campaign.id,
      inputHash: deadId('hash', i),
      forecast: generateDemoForecast(ctx),
      appliedAt: plan.applied ? daysAgo(now, 1) : null,
    });
    i++;
  }
  return out;
}
