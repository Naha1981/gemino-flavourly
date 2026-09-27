import { db } from '@/lib/db';
import {
  tenants,
  contacts,
  conversations,
  messages,
  reservations,
  waitlistEntries,
  loyaltyTransactions,
} from '@/lib/db/schema';
import { eq, and, or, desc, asc, gt } from 'drizzle-orm';
import { isOptInMessage, isOptOutMessage } from '@/lib/opt-in-out';
import { isCancellationRequest, handleCancellationIntent, type CancelIntentStore, type CancelIntentReservation } from './cancel-intent';
import { markReservationCancelled } from '@/lib/revenue/cancellation-followup';
import { drizzleCancellationFollowupStore } from '@/lib/revenue/cancellation-followup-store';
import { decideBillingGate, type BillingTenantLike } from '@/lib/billing/gate';
import { loyaltyBalanceMessage } from '@/lib/customer/loyalty';
import {
  REWARD_EVENT_TTL_MINUTES,
  buildGeoClaimUrl,
  buildJoinReply,
  buildRedeemInsufficientReply,
  buildRedeemNoLocationReply,
  buildRedeemReply,
} from '@/lib/customer/reward-claim';
import {
  awardWelcomeBonusOnce,
  createPendingRewardEvent,
  listRewardCatalog,
} from '@/lib/customer/reward-claim-store';
import { buildConfirmationReply } from '@/lib/revenue/reminder-ladder';
import { consumeAiRequest } from '@/lib/billing/ai-budget';
import { acceptWaitlistOffer } from '@/lib/revenue/waitlist-auto-offer';
import { retrieveKnowledge } from '@/lib/knowledge/store';
import {
  getActiveBookingDraft,
  upsertBookingDraft,
  confirmReadyDraft,
  draftMissingFields,
} from '@/lib/revenue/booking-drafts';

const SUPER_ADMIN_EMAILS = `${process.env.SUPER_ADMIN_EMAILS ?? ''},${process.env.ADMIN_EMAIL ?? ''}`
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isSuperAdminTenant(ownerEmail: string | null | undefined): boolean {
  if (!ownerEmail) return false;
  const email = ownerEmail.toLowerCase();
  return SUPER_ADMIN_EMAILS.includes(email);
}

interface InboundContext {
  tenantId: string;
  waAccountId: string;
  phone: string;
  senderName: string;
  text: string;
  conversationId: string;
  contactId: string;
}

/**
 * Drizzle adapter for the cancellation intent — the only caller is
 * processInboundAIResponse below. Lives here (and not in cancel-intent.ts)
 * so cancel-intent.ts stays free of `@/lib/db` and unit-testable without a
 * database, mirroring the revenue modules' split between logic and store.
 *
 * `cancelReservation` deliberately routes through `markReservationCancelled`
 * + the Gate #3 Drizzle store: that is the single entry point that stamps
 * `cancelled_at`, so the follow-up cron is guaranteed to see this
 * cancellation. Writing the UPDATE here instead would risk drifting out of
 * sync with the only path the cron reads.
 */
const drizzleCancelIntentStore: CancelIntentStore = {
  async isManualTakeover(conversationId) {
    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    return Boolean(conversation?.manualTakeover);
  },

  async findCandidateReservations({ tenantId, contactId, phone }) {
    // Match by contact OR by the exact phone captured on the reservation
    // (a booking taken over the phone may have no contact row). Newest date
    // first: upcoming reservations have the largest dates, so they are always
    // inside the limit and the handler re-sorts to pick the next one anyway.
    const rows = await db
      .select({
        id: reservations.id,
        tenantId: reservations.tenantId,
        contactId: reservations.contactId,
        customerPhone: reservations.customerPhone,
        date: reservations.date,
        partySize: reservations.partySize,
        status: reservations.status,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          or(eq(reservations.contactId, contactId), eq(reservations.customerPhone, phone))
        )
      )
      .orderBy(desc(reservations.date))
      .limit(25);
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      contactId: row.contactId,
      customerPhone: row.customerPhone,
      date: row.date,
      partySize: row.partySize,
      status: row.status as CancelIntentReservation['status'],
    }));
  },

  async cancelReservation(reservationId, cancelledAt) {
    await markReservationCancelled(drizzleCancellationFollowupStore, reservationId, cancelledAt);
  },
};

export async function processInboundAIResponse(ctx: InboundContext): Promise<string | null> {
  const { tenantId, phone, senderName, text, conversationId, contactId } = ctx;
  const lower = text.toLowerCase().trim();

  // Fetch tenant info
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant || !tenant.aiEnabled || tenant.manualMode) {
    return null; // AI disabled or manual mode active
  }

  // Billing gate: past-due / canceled tenants lose AI sending. Super admin
  // tenants are never gated. The gate is pure over the tenant row we already
  // loaded, so this adds no DB round-trip.
  const billingAllowed = isSuperAdminTenant(tenant.ownerEmail)
    || decideBillingGate({
        planStatus: tenant.planStatus,
        trialEndsAt: tenant.trialEndsAt,
        payfastSubscriptionToken: tenant.payfastSubscriptionToken,
      }).allowed;
  if (!billingAllowed) {
    return null; // billing gate: AI sending suspended (renew to resume)
  }

  // 1. POPIA / Unsubscribe Keyword Filter.
  // Was word-boundary regex matching the keyword ANYWHERE in the
  // message — "I can't stop thinking about your ribs" or "when do you
  // start serving?" would incorrectly trigger opt-out/opt-in. Now uses
  // the same shared, whole-message-exact-match helper as the webhook
  // route's blocklist bypass check (previously two separate
  // implementations of this rule existed, only one of which was
  // correct).
  if (isOptOutMessage(text)) {
    await db.update(contacts).set({ blocklisted: true }).where(eq(contacts.id, contactId));
    return `You have been successfully unsubscribed from ${tenant.name}. You will no longer receive automated messages. Reply START at any time to re-enable.`;
  }

  if (isOptInMessage(text)) {
    await db.update(contacts).set({ blocklisted: false }).where(eq(contacts.id, contactId));
    return `Welcome back to ${tenant.name}! How can we assist you today? (e.g. Menu, Bookings, Waitlist, Loyalty points)`;
  }

  // 2. Loyalty Keywords: POINTS, BALANCE, REWARDS, JOIN, REDEEM
  //
  // Order per the O1 gate spec: loyalty keywords run BEFORE the AI
  // concierge (a deterministic reply must never depend on an LLM being
  // reachable) and AFTER the STOP/kill-switch/billing gates above.
  if (['points', 'balance', 'loyalty', 'my rewards'].includes(lower)) {
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, contactId),
    });
    const pts = contact?.loyaltyPoints || 0;
    // PRD rule: R1 spent = 1 point, 100 points = R10 off. Previously the copy
    // offered a dessert at 100 pts / R100 at 250 pts — a mismatch with the
    // documented rewards program.
    return loyaltyBalanceMessage(tenant.name, pts);
  }

  // 2a. Loyalty JOIN — one-time welcome bonus. `awardWelcomeBonusOnce` is
  // idempotent on the loyalty_transactions ref_id unique index, so a
  // double-tap or a retried webhook awards exactly 50 points, once, ever.
  // Exact-match only: "join waitlist" must keep falling through to the
  // waitlist handler below.
  if (lower === 'join' || lower === 'join loyalty') {
    const outcome = await awardWelcomeBonusOnce(tenantId, contactId);
    return buildJoinReply({
      restaurantName: tenant.name,
      awarded: outcome.awarded,
      points: outcome.points,
    });
  }

  // 2b. Loyalty REDEEM — GPS-gated reward claim. Creates a pending
  // reward_event with a single-use token and replies with the geo-claim
  // link the guest opens at the table; points are only deducted when the
  // browser-submitted coordinates verify within 500m of the restaurant.
  if (lower === 'redeem' || lower.startsWith('redeem ')) {
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, contactId),
      columns: { loyaltyPoints: true },
    });
    const pts = contact?.loyaltyPoints ?? 0;
    const catalog = await listRewardCatalog(tenantId);
    const result = await createPendingRewardEvent({
      tenantId,
      contactId,
      conversationId,
      pointsBalance: pts,
      catalog,
    });
    if (!result.ok) {
      if (result.reason === 'restaurant_location_missing') {
        return buildRedeemNoLocationReply(tenant.name);
      }
      return buildRedeemInsufficientReply({
        restaurantName: tenant.name,
        points: result.points,
        needed: result.needed,
      });
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gemino.app';
    return buildRedeemReply({
      restaurantName: tenant.name,
      rewardName: result.reward.name,
      pointsCost: result.reward.pointsCost,
      remainingPoints: result.remainingPoints,
      claimUrl: buildGeoClaimUrl(appUrl, result.token),
      ttlMinutes: REWARD_EVENT_TTL_MINUTES,
    });
  }

  // 3. Waitlist Keyword
  if (lower.startsWith('waitlist') || lower.includes('join waitlist') || lower.includes('queue')) {
    // Parse party size if present e.g. "waitlist 4"
    const match = lower.match(/\d+/);
    const size = match ? parseInt(match[0], 10) : 2;

    await db.insert(waitlistEntries).values({
      tenantId,
      contactId,
      conversationId,
      customerName: senderName,
      customerPhone: phone,
      partySize: size,
      status: 'waiting',
      estimatedWaitMinutes: 15 + Math.floor(Math.random() * 15),
    });

    return `🎟️ You've been added to our live waitlist for a table of *${size}*!\n\nWe will WhatsApp you the moment your table is ready. Please remain nearby.`;
  }

  // 4. Cancellation Intent — let a customer cancel their OWN upcoming booking
  // over WhatsApp. Runs BEFORE the booking intent on purpose: "cancel my
  // booking" / "cancel my reservation" contain the words "booking" and
  // "reservation", so a booking match placed above this would swallow the
  // request and answer with the generic reservation prompt instead of
  // cancelling. When the matcher fires, the handler owns the reply (either a
  // cancellation confirmation or the not-found message), so we return here.
  if (isCancellationRequest(text)) {
    return await handleCancellationIntent(
      { tenantId, contactId, phone, conversationId },
      drizzleCancelIntentStore
    );
  }

  // 4b. Booking CONFIRM / YES — first confirm a ready multi-message draft,
  // otherwise confirm the next existing reservation.
  if (
    ['confirm', 'confirmed', 'yes', 'y', 'c'].includes(lower) ||
    lower.startsWith('confirm ')
  ) {
    const waitlistClaim = await acceptWaitlistOffer(tenantId, contactId);
    if (waitlistClaim) {
      return `✅ Your waitlist table is claimed. We’ve reserved it for you — please arrive as soon as you can.`;
    }

    const draft = await getActiveBookingDraft(conversationId);
    if (draft?.status === 'ready') {
      try {
        const created = await confirmReadyDraft(draft);
        return `✅ Your table is confirmed for ${created.reservationDate.toLocaleString('en-ZA', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        })} for ${draft.partySize} guest${draft.partySize === 1 ? '' : 's'}.
We look forward to seeing you at ${tenant.name}!`;
      } catch (err) {
        console.error('[Booking Draft] failed to confirm ready draft', err);
        return `I have all the details, but I couldn't finalise the booking just yet. Please try CONFIRM again or ask for a staff member.`;
      }
    }
    const upcoming = await db
      .select({
        id: reservations.id,
        date: reservations.date,
        partySize: reservations.partySize,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.tenantId, tenantId),
          eq(reservations.status, 'confirmed'),
          gt(reservations.date, new Date()),
          or(eq(reservations.contactId, contactId), eq(reservations.customerPhone, phone))
        )
      )
      .orderBy(asc(reservations.date))
      .limit(1);

    const next = upcoming[0] ?? null;
    if (next) {
      // Idempotent stamp: re-confirming just refreshes the timestamp on the
      // same booking — never creates rows, never re-sends anything.
      await db
        .update(reservations)
        .set({ customerConfirmedAt: new Date() })
        .where(eq(reservations.id, next.id))
        .catch(() => undefined);
    }

    return buildConfirmationReply({
      restaurantName: tenant.name,
      reservationDate: next?.date ?? null,
      partySize: next?.partySize ?? null,
    });
  }

  // 5. Booking / Reservation Intent. Multi-message booking drafts retain the
  // details already supplied for 30 minutes, then ask only for what is missing.
  if (lower.includes('book') || lower.includes('table') || lower.includes('reservation') || await getActiveBookingDraft(conversationId)) {
    const draft = await upsertBookingDraft({
      tenantId,
      contactId,
      conversationId,
      text,
    });
    const missing = draftMissingFields(draft);
    if (missing.length > 0) {
      const prompts: Record<string, string> = {
        date: 'the date',
        time: 'your preferred time',
        'number of guests': 'the number of guests',
      };
      const ask = missing.map((field) => prompts[field] ?? field);
      return `🍽️ I can help with that. I still need ${ask.join(' and ')}. You can send them together, for example: “Saturday at 19:00 for 4”.`;
    }
    return `Great — I have a table request for ${draft.partySize} guest${draft.partySize === 1 ? '' : 's'} on ${draft.dateText} at ${draft.timeText}.${draft.notes ? ` Note: ${draft.notes}.` : ''}

Reply CONFIRM to book it, or send a change such as “tomorrow at 20:00 for 2”.`;
  }

  // 6. Menu & Trading Hours
  if (lower.includes('menu') || lower.includes('food') || lower.includes('drinks')) {
    return `📋 You can explore our full interactive menu and chef specials here: ${process.env.NEXT_PUBLIC_APP_URL || 'https://gemino.app'}/m/${tenant.slug}\n\nCan I help you with any recommendations or table bookings?`;
  }

  if (lower.includes('hour') || lower.includes('open') || lower.includes('location') || lower.includes('address')) {
    const hours = tenant.openingHours || 'Mon - Sun: 11:30 AM - 10:00 PM';
    return `📍 *${tenant.name}*\n🕒 Trading Hours:\n${hours}\n\nWe look forward to welcoming you!`;
  }

  // 7. Intelligent Contextual AI Fallback. Every external model turn
  // consumes one tenant-scoped daily AI budget unit. Deterministic flows above
  // (menu, booking, loyalty, waitlist, hours) remain available after the budget
  // is exhausted.
  const budget = await consumeAiRequest(tenantId, tenant.plan);
  if (!budget.allowed) {
    console.warn(`[AI Budget] tenant=${tenantId} exhausted daily AI budget of ${budget.limit}`);
    return `Hi ${senderName}, our automated assistant has reached today's message limit. Your request is safely queued for the restaurant team, who can take over this conversation.`;
  }

  // 7a. Intelligent Contextual AI Fallback (Groq / Gemini)
  try {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;

    const knowledge = await retrieveKnowledge(tenantId, text, 5).catch(() => []);
  const knowledgeContext = knowledge.length
    ? "\nVerified restaurant knowledge:\n" + knowledge.map((item) => `[Source: ${item.name}] ${item.content}`).join("\n---\n")
    : "";

  const basePrompt = tenant.systemPrompt || `You are the ${tenant.aiPersonality || 'warm, friendly, and hospitable'} WhatsApp Concierge for ${tenant.name}.
Business details: ${tenant.description || 'A premier restaurant and hospitality venue.'}
Trading hours: ${tenant.openingHours || 'Monday - Sunday: 11:30 AM - 10:00 PM'}
Customer Name: ${senderName}
Customer Message: "${text}"
${knowledgeContext}

Guidelines:
- Keep response concise (1-3 sentences) suited for mobile messaging.
- Match the brand tone: ${tenant.aiPersonality || 'hospitable and professional'}.
- Use verified restaurant knowledge when relevant. Never invent menu items, policies, prices or rules.
- If asking about bookings, invite them to share date, time, and party size.
- If asking for a human manager, inform them our floor manager has been alerted.`;

    // 7a. Try Groq.
    // Was llama-3.1-8b-instant, which Groq shut down on Aug 16, 2026 —
    // every call here was returning an error (this !groqRes.ok branch),
    // so the AI fallback silently degraded to the generic "our team
    // will get back to you" message for every tenant, with nothing
    // logged to reveal why. Migrated to Groq's own recommended
    // replacement (openai/gpt-oss-20b). Also now logs on failure instead
    // of failing silently, so the next provider deprecation shows up in
    // logs immediately instead of being discovered by a customer
    // complaint.
    if (groqKey) {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b',
          messages: [
            { role: 'system', content: basePrompt },
            { role: 'user', content: text },
          ],
          max_tokens: 180,
          temperature: 0.7,
        }),
      });

      if (groqRes.ok) {
        const data = await groqRes.json();
        const generated = data.choices?.[0]?.message?.content;
        if (generated) return generated.trim();
        console.error('[AI] Groq responded OK but returned no message content', JSON.stringify(data).slice(0, 500));
      } else {
        console.error(`[AI] Groq request failed (${groqRes.status}): ${(await groqRes.text()).slice(0, 500)}`);
      }
    }

    // 7b. Try Gemini.
    // Was gemini-1.5-flash, which Google has fully shut down (all
    // requests return 404). Migrated to gemini-3.5-flash — current-gen,
    // no shutdown date announced as of this writing. Google deprecates
    // Gemini models on a roughly 6-9 month cycle; check
    // ai.google.dev/gemini-api/docs/deprecations periodically rather
    // than waiting for this to silently break again.
    if (geminiKey) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${basePrompt}\n\nCustomer: ${text}` }] }],
            generationConfig: { maxOutputTokens: 180, temperature: 0.7 },
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const generated = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (generated) return generated.trim();
        console.error('[AI] Gemini responded OK but returned no message content', JSON.stringify(data).slice(0, 500));
      } else {
        console.error(`[AI] Gemini request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
      }
    }

    if (!groqKey && !geminiKey) {
      console.error('[AI] Neither GROQ_API_KEY nor GOOGLE_GEMINI_API_KEY is configured — AI fallback cannot run.');
    }
  } catch (err) {
    console.error('[AI] generation fallback threw an exception:', err);
  }

  // Default polite fallback
  return `Hi ${senderName}, thanks for messaging ${tenant.name}! 🌟\n\nOur team has received your message and will get back to you shortly. You can also reply *MENU*, *BOOK*, or *WAITLIST* for instant service.`;
}
