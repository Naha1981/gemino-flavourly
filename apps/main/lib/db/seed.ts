import { eq } from 'drizzle-orm';
import {
  tenants,
  waAccounts,
  contacts,
  conversations,
  messages,
  reservations,
  waitlistEntries,
  loyaltyTransactions,
  loyaltyRewards,
  systemSettings,
  staffMembers,
} from './schema';
import { DEMO_TENANT_SLUG, DEMO_USER } from '@/lib/config';

export async function seedDemoWorkspace(db: any) {
  const existing = await db.query.tenants.findFirst({
    where: eq(tenants.slug, DEMO_TENANT_SLUG),
  });
  if (existing) return existing;

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: 'The Marula Room',
      slug: DEMO_TENANT_SLUG,
      ownerEmail: DEMO_USER.email,
      description:
        'Wood-fired steaks, Highveld herbs, and a courtyard that fills itself on Friday nights. Braamfontein, Johannesburg.',
      openingHours: 'Tue–Thu 12:00–22:00\nFri–Sat 12:00–23:30\nSun 11:00–16:00\nClosed Monday',
      aiPersonality: 'warm, witty, and unhurried — like a host who already knows your usual',
      aiEnabled: true,
      manualMode: false,
      monthlyFee: '49.00',
      menuText: `STARTERS
Marula-cured trout, fennel, buttermilk  —  R145
Charred broccolini, smoked almond, chilli oil  —  R95
Oxtail croquettes, pickled onion  —  R110

FIRE
Dry-aged rump 300g, bone marrow butter  —  R295
Line fish of the day, citrus beurre blanc  —  R275
Mushroom & sorghum risotto, aged gouda  —  R185

SWEET
Malva pudding, Amarula cream  —  R85
Dark chocolate pot, sea salt  —  R80`,
    })
    .returning();

  const [wa] = await db
    .insert(waAccounts)
    .values({
      tenantId: tenant.id,
      phoneNumber: '27821234000',
      isConnected: true,
      status: 'connected',
      lastConnectedAt: new Date(),
    })
    .returning();

  const [thandi] = await db
    .insert(contacts)
    .values({
      tenantId: tenant.id,
      phone: '27821234567',
      name: 'Thandi M.',
      vip: true,
      loyaltyPoints: 180,
    })
    .returning();

  const [johan] = await db
    .insert(contacts)
    .values({
      tenantId: tenant.id,
      phone: '27839876543',
      name: 'Johan V.',
      loyaltyPoints: 40,
    })
    .returning();

  const [conv1] = await db
    .insert(conversations)
    .values({
      tenantId: tenant.id,
      contactId: thandi.id,
      waAccountId: wa.id,
      lastMessageAt: new Date(),
    })
    .returning();

  const [conv2] = await db
    .insert(conversations)
    .values({
      tenantId: tenant.id,
      contactId: johan.id,
      waAccountId: wa.id,
      lastMessageAt: new Date(Date.now() - 36 * 60_000),
    })
    .returning();

  await db.insert(messages).values([
    {
      tenantId: tenant.id,
      conversationId: conv1.id,
      direction: 'inbound',
      content: 'Hi, can I book a table for 2 tomorrow at 7pm?',
      isAIGenerated: false,
    },
    {
      tenantId: tenant.id,
      conversationId: conv1.id,
      direction: 'outbound',
      content:
        'Done, Thandi — table for 2 tomorrow at 19:00 at The Marula Room. We will hold it for 15 minutes. Reply STOP to opt out.',
      isAIGenerated: true,
    },
    {
      tenantId: tenant.id,
      conversationId: conv2.id,
      direction: 'inbound',
      content: 'waitlist 4',
      isAIGenerated: false,
    },
    {
      tenantId: tenant.id,
      conversationId: conv2.id,
      direction: 'outbound',
      content: "You're on the waitlist for 4. We'll WhatsApp the moment a courtyard table frees.",
      isAIGenerated: true,
    },
  ]);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);

  await db.insert(reservations).values({
    tenantId: tenant.id,
    contactId: thandi.id,
    customerName: 'Thandi M.',
    customerPhone: '27821234567',
    date: tomorrow,
    partySize: 2,
    status: 'confirmed',
    notes: 'Captured from WhatsApp',
  });

  await db.insert(waitlistEntries).values({
    tenantId: tenant.id,
    contactId: johan.id,
    customerName: 'Johan V.',
    customerPhone: '27839876543',
    partySize: 4,
    status: 'waiting',
    estimatedWaitMinutes: 25,
  });

  await db.insert(loyaltyRewards).values([
    { tenantId: tenant.id, name: 'Complimentary dessert or filter coffee', pointsCost: 100 },
    { tenantId: tenant.id, name: 'R100 dine-in voucher', pointsCost: 250 },
    { tenantId: tenant.id, name: 'Chef’s table + sparkling', pointsCost: 500 },
  ]);

  await db.insert(loyaltyTransactions).values({
    tenantId: tenant.id,
    contactId: thandi.id,
    type: 'earn',
    amount: 180,
    description: 'Opening balance — regular',
  });

  await db.insert(systemSettings).values({ masterAiSwitch: true });

  await db.insert(staffMembers).values({
    clerkUserId: DEMO_USER.userId,
    email: DEMO_USER.email,
    name: `${DEMO_USER.firstName} ${DEMO_USER.lastName}`,
    role: 'super_admin',
  });

  return tenant;
}
