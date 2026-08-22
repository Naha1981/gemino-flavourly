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
import { eq, and } from 'drizzle-orm';

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
  const { tenantId, phone, senderName, text, conversationId, contactId } = ctx;
  const lower = text.toLowerCase().trim();

  // Fetch tenant info
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });

  if (!tenant || !tenant.aiEnabled || tenant.manualMode) {
    return null; // AI disabled or manual mode active
  }

  // 1. POPIA / Unsubscribe Keyword Filter.
  // Was exact-match only (`.includes(lower)` against the whole trimmed
  // message) — "STOP.", "please stop", "Stop messaging me" all fell
  // through to the AI instead of unsubscribing. For a compliance control
  // this needs to catch the keyword anywhere in the message, as a whole
  // word (so "nonstop" or "shopping" don't false-positive).
  const OPT_OUT_PATTERN = /\b(stop|unsubscribe|opt[\s-]?out|cancel subscription|remove me)\b/i;
  const OPT_IN_PATTERN = /\bstart\b/i;

  if (OPT_OUT_PATTERN.test(text)) {
    await db.update(contacts).set({ blocklisted: true }).where(eq(contacts.id, contactId));
    return `You have been successfully unsubscribed from ${tenant.name}. You will no longer receive automated messages. Reply START at any time to re-enable.`;
  }

  if (OPT_IN_PATTERN.test(text)) {
    await db.update(contacts).set({ blocklisted: false }).where(eq(contacts.id, contactId));
    return `Welcome back to ${tenant.name}! How can we assist you today? (e.g. Menu, Bookings, Waitlist, Loyalty points)`;
  }

  // 2. Loyalty Keywords: POINTS, BALANCE, REWARDS
  if (['points', 'balance', 'loyalty', 'my rewards'].includes(lower)) {
    const contact = await db.query.contacts.findFirst({
      where: eq(contacts.id, contactId),
    });
    const pts = contact?.loyaltyPoints || 0;
    return `🌟 Hello ${senderName}! You currently have *${pts} loyalty points* with ${tenant.name}.\n\n• 100 pts: Complimentary Dessert / Coffee\n• 250 pts: R100 Discount on next dine-in\n\nAsk our staff to redeem on your next visit!`;
  }

  // 3. Waitlist Keyword
  if (lower.startsWith('waitlist') || lower.includes('join waitlist') || lower.includes('queue')) {
    // Parse party size if present e.g. "waitlist 4"
    const match = lower.match(/\d+/);
    const size = match ? parseInt(match[0], 10) : 2;

    await db.insert(waitlistEntries).values({
      tenantId,
      contactId,
      customerName: senderName,
      customerPhone: phone,
      partySize: size,
      status: 'waiting',
      estimatedWaitMinutes: 15 + Math.floor(Math.random() * 15),
    });

    return `🎟️ You've been added to our live waitlist for a table of *${size}*!\n\nWe will WhatsApp you the moment your table is ready. Please remain nearby.`;
  }

  // 4. Booking / Reservation Intent
  if (lower.includes('book') || lower.includes('table') || lower.includes('reservation')) {
    return `🍽️ We'd love to host you at ${tenant.name}!\n\nTo reserve a table, please tell us:\n1. Date & Preferred Time\n2. Number of guests\n3. Any special dietary requirements`;
  }

  // 5. Menu & Trading Hours
  if (lower.includes('menu') || lower.includes('food') || lower.includes('drinks')) {
    return `📋 You can explore our full interactive menu and chef specials here: ${process.env.NEXT_PUBLIC_APP_URL || 'https://gemino.app'}/m/${tenant.slug}\n\nCan I help you with any recommendations or table bookings?`;
  }

  if (lower.includes('hour') || lower.includes('open') || lower.includes('location') || lower.includes('address')) {
    const hours = tenant.openingHours || 'Mon - Sun: 11:30 AM - 10:00 PM';
    return `📍 *${tenant.name}*\n🕒 Trading Hours:\n${hours}\n\nWe look forward to welcoming you!`;
  }

  // 6. Intelligent Contextual AI Fallback (Groq / Gemini / OpenAI)
  try {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;

    const basePrompt = tenant.systemPrompt || `You are the ${tenant.aiPersonality || 'warm, friendly, and hospitable'} WhatsApp Concierge for ${tenant.name}.
Business details: ${tenant.description || 'A premier restaurant and hospitality venue.'}
Trading hours: ${tenant.openingHours || 'Monday - Sunday: 11:30 AM - 10:00 PM'}
Customer Name: ${senderName}
Customer Message: "${text}"

Guidelines:
- Keep response concise (1-3 sentences) suited for mobile messaging.
- Match the brand tone: ${tenant.aiPersonality || 'hospitable and professional'}.
- If asking about bookings, invite them to share date, time, and party size.
- If asking for a human manager, inform them our floor manager has been alerted.`;

    // 6a. Try Groq (Llama 3 70B / 8B - ultra-fast)
    if (groqKey) {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
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
      }
    }

    // 6b. Try Gemini 1.5 Flash
    if (geminiKey) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
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
      }
    }
  } catch (err) {
    console.error('AI generation fallback error:', err);
  }

  // Default polite fallback
  return `Hi ${senderName}, thanks for messaging ${tenant.name}! 🌟\n\nOur team has received your message and will get back to you shortly. You can also reply *MENU*, *BOOK*, or *WAITLIST* for instant service.`;
}
