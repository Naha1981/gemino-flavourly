import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { conversations, contacts, messages } from '@/lib/db/schema';
import { eq, desc, asc, and } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';
import Link from 'next/link';
import { Phone, ArrowLeft } from 'lucide-react';
import ChatDetailClient from './chat-detail-client';

export const dynamic = 'force-dynamic';

export default async function ConversationDetailPage({ params }: { params: { id: string } }) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const conversationId = params.id;

  // 1. Fetch current conversation details
  const [currentConvo] = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      contactPhone: contacts.phone,
      contactName: contacts.name,
      manualTakeover: conversations.manualTakeover,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(and(eq(conversations.id, conversationId), eq(conversations.tenantId, tenant.id)))
    .limit(1)
    .catch(() => []);

  if (!currentConvo) {
    notFound();
  }

  // 2. Fetch all messages in this conversation
  const messageList = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt))
    .catch(() => []);

  // 3. Fetch all conversations for the left sidebar
  const allConvos = await db
    .select({
      id: conversations.id,
      contactPhone: contacts.phone,
      contactName: contacts.name,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(eq(conversations.tenantId, tenant.id))
    .orderBy(desc(conversations.lastMessageAt))
    .catch(() => []);

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-lg border border-app-border bg-app-surface-0/50 shadow-sm">
      {/* Left Sidebar: Conversations List (Hidden on mobile if viewing chat) */}
      <div className="hidden md:block md:w-1/3 border-r border-app-border overflow-y-auto bg-app-bg/20">
        <div className="p-4 border-b border-app-border bg-app-surface-0/80">
          <h2 className="text-base font-semibold text-app-fg">Live Inbox</h2>
        </div>
        <ul className="divide-y divide-app-border">
          {allConvos.map((c) => (
            <li key={c.id}>
              <Link
                href={`/dashboard/inbox/${c.id}`}
                className={`block p-4 transition-colors ${
                  c.id === conversationId ? 'bg-app-surface-1/80 border-l-2 border-emerald-500' : 'hover:bg-app-surface-1/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-app-fg text-sm">{c.contactName || c.contactPhone}</span>
                  <span className="text-xs text-app-faint">
                    {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
                <p className="text-xs text-app-muted truncate mt-1 flex items-center gap-1">
                  <Phone className="w-3 h-3 text-app-faint" />
                  {c.contactPhone}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Right Side: Interactive Chat Thread & Reply Box */}
      <div className="flex-1 flex flex-col bg-app-bg/60 overflow-hidden">
        <ChatDetailClient
          conversationId={conversationId}
          contactName={currentConvo.contactName}
          contactPhone={currentConvo.contactPhone}
          manualTakeover={currentConvo.manualTakeover}
          initialMessages={messageList}
        />
      </div>
    </div>
  );
}
