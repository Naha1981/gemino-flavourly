import { db } from '@/lib/db';
import {
  tenants,
  contacts,
  reservations,
  waitlistEntries,
} from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isOptInCommand, isOptOutCommand } from './popia';
import { extractBooking, looksLikeBooking } from './booking';

interface InboundContext {
  tenantId: string;
  waAccountId: string;
  phone: string;
  senderName: string;
  text: string;
  conversationId: string;
  contactId: string;
}

export async function processInboundAIResponse(ctx: InboundContext): Promise<string | null> {
  const { tenantId, phone, senderName, text, contactId } = ctx;
  const lower = text.toLowerCase().trim();

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant || !tenant.aiEnabled || tenant.manualMode) {
    return null;
  }

  if (isOptOutCommand(text)) {
    await db.update(contacts).set({ blocklisted: true }).where(eq(contacts.id, contactId));
    return `You have been unsubscribed from ${tenant.name}. You will no longer receive automated messages. Reply START to opt back in.`;
  }

  if (isOptInCommand(text)) {
    await db.update(contacts).set({ blocklisted: false }).where(eq(contacts.id, contactId));
    return `Welcome back to ${tenant.name}. How can we help — MENU, BOOK, WAITLIST, or POINTS?`;
  }

  if (['points', 'balance', 'loyalty', 'my rewards'].includes(lower)) {
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, contactId),
    });
    const pts = contact?.loyaltyPoints || 0;
    return [
      `Hello ${senderName} — you have *${pts} loyalty points* at ${tenant.name}.`,
      '',
      '• 100 pts — complimentary dessert or coffee',
      '• 250 pts — R100 off your next dine-in',
      '• 500 pts — chef’s table with sparkling',
      '',
      'Ask the floor team to redeem on your next visit.',
    ].join('\n');
  }

  if (lower.startsWith('waitlist') || lower.includes('join waitlist') || lower === 'queue') {
    const match = lower.match(/\d+/);
    const size = match ? parseInt(match[0], 10) : 2;
    const eta = 15 + Math.floor(Math.random() * 15);

    await db.insert(waitlistEntries).values({
      tenantId,
      contactId,
      customerName: senderName,
      customerPhone: phone,
      partySize: size,
      status: 'waiting',
      estimatedWaitMinutes: eta,
    });

    return `You're on the live waitlist for a table of *${size}* at ${tenant.name}. Estimated wait ~${eta} minutes. We will WhatsApp you the moment a table is ready.`;
  }

  if (looksLikeBooking(text)) {
    const draft = extractBooking(text);
    if (draft.complete && draft.date && draft.partySize) {
      await db.insert(reservations).values({
        tenantId,
        contactId,
        customerName: senderName,
        customerPhone: phone,
        date: draft.date,
        partySize: draft.partySize,
        status: 'confirmed',
        notes: text.trim(),
      });
      const when = draft.date.toLocaleString('en-ZA', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
      return `Reserved. Table for *${draft.partySize}* at ${tenant.name} on *${when}*. We hold it for 15 minutes. Need to change it? Just reply here.`;
    }
    return `We would love to host you at ${tenant.name}. Reply with:\n1. Date (tomorrow / Friday / 2026-08-23)\n2. Time (e.g. 7pm)\n3. Party size`;
  }

  if (lower === 'menu' || lower.includes('menu') || lower === 'food' || lower.includes('drinks')) {
    const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return `Our menu lives here: ${base}/m/${tenant.slug}\n\nWant a table, or shall I put you on the waitlist?`;
  }

  if (lower.includes('hour') || lower === 'open' || lower.includes('location') || lower.includes('address')) {
    const hours = tenant.openingHours || 'Mon - Sun: 11:30 AM - 10:00 PM';
    return `*${tenant.name}*\n${hours}\n\nWe look forward to welcoming you.`;
  }

  try {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;

    const basePrompt =
      tenant.systemPrompt ||
      `You are the ${tenant.aiPersonality || 'warm, friendly, and hospitable'} WhatsApp concierge for ${tenant.name}.
Business: ${tenant.description || 'A restaurant.'}
Hours: ${tenant.openingHours || 'Monday - Sunday: 11:30 AM - 10:00 PM'}
Guest: ${senderName}
Rules:
- 1–3 short sentences. Mobile first.
- Match tone: ${tenant.aiPersonality || 'hospitable'}.
- Never invent prices or dishes that are not in the description.
- For bookings, ask date, time, party size.
- If they want a human, say the floor manager has been pinged.`;

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
        console.error('[AI] Groq OK but empty', JSON.stringify(data).slice(0, 400));
      } else {
        console.error(`[AI] Groq ${groqRes.status}: ${(await groqRes.text()).slice(0, 400)}`);
      }
    }

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
        console.error('[AI] Gemini OK but empty', JSON.stringify(data).slice(0, 400));
      } else {
        console.error(`[AI] Gemini ${response.status}: ${(await response.text()).slice(0, 400)}`);
      }
    }

    if (!groqKey && !geminiKey) {
      console.error('[AI] Neither GROQ_API_KEY nor GOOGLE_GEMINI_API_KEY is configured.');
    }
  } catch (err) {
    console.error('[AI] generation threw:', err);
  }

  return `Hi ${senderName}, ${tenant.name} has your message. Reply *MENU*, *BOOK*, *WAITLIST* or *POINTS* for instant help — or wait and a host will pick this up.`;
}
