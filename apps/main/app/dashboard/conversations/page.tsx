import { db } from '@/lib/db';
import { conversations, contacts, messages, tenants, waAccounts } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import Link from 'next/link';
import { ArrowLeft, MessageSquare, Send, User, Bot, Clock, Phone } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: { id?: string };
}) {
  // Fetch conversations with contact details
  const convList = await db
    .select({
      id: conversations.id,
      tenantId: conversations.tenantId,
      contactId: conversations.contactId,
      manualTakeover: conversations.manualTakeover,
      lastMessageAt: conversations.lastMessageAt,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      isBlocklisted: contacts.blocklisted,
    })
    .from(conversations)
    .innerJoin(contacts, eq(conversations.contactId, contacts.id))
    .orderBy(desc(conversations.lastMessageAt))
    .limit(20)
    .catch(() => []);

  const selectedConvId = searchParams.id || (convList.length > 0 ? convList[0].id : null);

  const selectedConv = convList.find((c) => c.id === selectedConvId) || convList[0];

  const threadMessages = selectedConvId
    ? await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, selectedConvId))
        .orderBy(messages.createdAt)
        .catch(() => [])
    : [];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 selection:bg-zinc-800">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-md bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">WhatsApp Conversation Inbox</h1>
              <p className="text-xs text-zinc-400">View live guest interactions and take over manual control anytime.</p>
            </div>
          </div>
        </div>

        {/* 2-Column Split Inbox Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 h-[720px] bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden">
          {/* Thread List Column */}
          <div className="md:col-span-4 border-r border-zinc-800 flex flex-col h-full bg-zinc-950/40">
            <div className="p-4 border-b border-zinc-800">
              <span className="text-xs font-semibold text-zinc-300">Active Customer Threads</span>
              <p className="text-[11px] text-zinc-500 mt-0.5">{convList.length} conversations</p>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/60">
              {convList.length === 0 ? (
                <div className="p-8 text-center text-xs text-zinc-500">No conversations recorded yet.</div>
              ) : (
                convList.map((conv) => (
                  <Link
                    key={conv.id}
                    href={`/dashboard/conversations?id=${conv.id}`}
                    className={`p-4 block transition-colors ${
                      conv.id === selectedConvId ? 'bg-zinc-800/70 border-l-2 border-emerald-400' : 'hover:bg-zinc-800/30'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-zinc-100 flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-zinc-400" />
                        {conv.contactName || 'Guest'}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {conv.lastMessageAt ? new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 font-mono mt-1">+{conv.contactPhone}</p>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Active Message View Column */}
          <div className="md:col-span-8 flex flex-col h-full bg-zinc-900/30">
            {selectedConv ? (
              <>
                {/* Conversation Header */}
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/60">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-800 text-zinc-200 flex items-center justify-center font-semibold text-xs">
                      {(selectedConv.contactName || 'G')[0]}
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-zinc-100">{selectedConv.contactName || 'Guest'}</h3>
                      <p className="text-[11px] text-zinc-400 font-mono">+{selectedConv.contactPhone}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 font-medium">
                      AI Auto-Reply: Active
                    </span>
                  </div>
                </div>

                {/* Messages Timeline */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {threadMessages.length === 0 ? (
                    <div className="text-center text-xs text-zinc-500 py-12">No message history in this thread.</div>
                  ) : (
                    threadMessages.map((msg) => {
                      const isInbound = msg.direction === 'inbound';
                      return (
                        <div
                          key={msg.id}
                          className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}
                        >
                          <div
                            className={`max-w-[75%] rounded-lg p-3.5 text-xs leading-relaxed space-y-1 ${
                              isInbound
                                ? 'bg-zinc-800 text-zinc-100 rounded-tl-none border border-zinc-700/60'
                                : 'bg-emerald-950/70 border border-emerald-800 text-emerald-100 rounded-tr-none'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-4 text-[10px] opacity-70">
                              <span>{isInbound ? 'Customer' : msg.isAIGenerated ? 'AI Concierge' : 'Operator'}</span>
                              <span>
                                {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                            <p className="whitespace-pre-line">{msg.content}</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Reply Input Box */}
                <div className="p-4 border-t border-zinc-800 bg-zinc-950/60">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Type a manual WhatsApp message (will override AI)..."
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded-md px-3.5 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
                    />
                    <button
                      type="button"
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-zinc-950 font-semibold text-xs rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs">
                Select a conversation from the left to view messages
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
