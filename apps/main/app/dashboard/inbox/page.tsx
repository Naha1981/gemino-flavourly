import { auth, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { conversations, contacts, messages } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { MessageSquare, Phone } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  let tenant = await getOrCreateTenant();
  const tenantId = tenant?.id;

  if (!tenantId) {
    redirect('/sign-in');
  }

  // Fetch conversations with their latest contact and last message
  const convos = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      contactPhone: contacts.phone,
      contactName: contacts.name,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(eq(conversations.tenantId, tenantId))
    .orderBy(desc(conversations.lastMessageAt))
    .catch(() => []);

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 shadow-sm">
      {/* Left Sidebar: Conversations List */}
      <div className="w-1/3 border-r border-zinc-800 overflow-y-auto">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/80">
          <h2 className="text-base font-semibold text-zinc-100">Live Inbox</h2>
        </div>
        {convos.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500 leading-relaxed">
            No conversations yet. <br />
            When customers message you on WhatsApp, they will appear here in real-time.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {convos.map((c) => (
              <li key={c.id} className="p-4 hover:bg-zinc-800/50 cursor-pointer transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-50 text-sm">{c.contactName || c.contactPhone}</span>
                  <span className="text-xs text-zinc-500">
                    {c.lastMessageAt?.toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 truncate mt-1 flex items-center gap-1">
                  <Phone className="w-3 h-3 text-zinc-500" />
                  {c.contactPhone}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right Side: Chat Window */}
      <div className="flex-1 flex flex-col bg-zinc-950/40">
        {convos.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3 p-6 text-center">
            <div className="p-3 bg-zinc-900 rounded-full border border-zinc-800">
              <MessageSquare className="h-8 w-8 text-emerald-400" />
            </div>
            <h3 className="text-sm font-medium text-zinc-300">No conversation selected</h3>
            <p className="text-xs text-zinc-500 max-w-sm">
              Your AI concierge is actively monitoring your connected WhatsApp line.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b border-zinc-800 bg-zinc-900/80">
              <h3 className="font-semibold text-zinc-100 text-sm">{convos[0].contactName || convos[0].contactPhone}</h3>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              <div className="text-center text-xs text-zinc-500 py-8">
                Conversation thread active. AI is auto-replying to customer inquiries.
              </div>
            </div>
            <div className="p-4 border-t border-zinc-800 bg-zinc-950">
              <input 
                type="text" 
                placeholder="Type a manual reply to take over from AI..." 
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
