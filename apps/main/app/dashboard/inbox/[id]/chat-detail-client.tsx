'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Phone, Send, Bot, User, Sparkles, Loader2, CheckCheck } from 'lucide-react';

interface MessageItem {
  id: string;
  direction: string;
  content: string;
  isAIGenerated: boolean;
  createdAt: Date | string;
}

interface ChatDetailClientProps {
  conversationId: string;
  contactName: string | null;
  contactPhone: string;
  manualTakeover: boolean;
  initialMessages: MessageItem[];
}

export default function ChatDetailClient({
  conversationId,
  contactName,
  contactPhone,
  manualTakeover,
  initialMessages,
}: ChatDetailClientProps) {
  const [messages, setMessages] = useState<MessageItem[]>(initialMessages);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [isManual, setIsManual] = useState(manualTakeover);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim() || sending) return;

    const content = inputText.trim();
    setInputText('');
    setSending(true);

    // Optimistic UI update
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: MessageItem = {
      id: tempId,
      direction: 'outbound',
      content,
      isAIGenerated: false,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    setIsManual(true);

    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setMessages((prev) => prev.map((m) => (m.id === tempId ? data.message : m)));
        }
      }
    } catch (err) {
      console.error('Failed to send manual reply', err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread Header */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/80 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/inbox"
            className="md:hidden p-1.5 rounded-md bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h3 className="font-semibold text-zinc-50 text-sm">{contactName || contactPhone}</h3>
            <p className="text-xs text-zinc-400 flex items-center gap-1">
              <Phone className="w-3 h-3 text-zinc-500" />
              {contactPhone}
            </p>
          </div>
        </div>

        <div>
          {isManual ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-950/80 text-blue-300 border border-blue-800/60 shadow-sm">
              <User className="w-3 h-3" />
              Manual Takeover
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 shadow-sm">
              <Sparkles className="w-3 h-3 text-emerald-400" />
              AI Concierge Active
            </span>
          )}
        </div>
      </div>

      {/* Message Feed */}
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-12">
            No messages in this conversation yet.
          </div>
        ) : (
          messages.map((m) => {
            const isInbound = m.direction === 'inbound';
            const timeStr = m.createdAt
              ? new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '';

            return (
              <div
                key={m.id}
                className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}
              >
                <div
                  className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm shadow-sm leading-relaxed ${
                    isInbound
                      ? 'bg-zinc-800/90 text-zinc-100 rounded-bl-sm border border-zinc-700/50'
                      : m.isAIGenerated
                      ? 'bg-emerald-950/70 text-emerald-100 rounded-br-sm border border-emerald-800/60'
                      : 'bg-zinc-100 text-zinc-950 font-medium rounded-br-sm shadow-md'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                </div>

                <div className="flex items-center gap-1.5 mt-1 px-1 text-[11px] text-zinc-500">
                  {!isInbound && m.isAIGenerated && (
                    <span className="flex items-center gap-1 text-emerald-400 font-medium">
                      <Bot className="w-3 h-3" />
                      AI
                    </span>
                  )}
                  {!isInbound && !m.isAIGenerated && (
                    <span className="flex items-center gap-1 text-zinc-400">
                      <User className="w-3 h-3" />
                      Staff
                    </span>
                  )}
                  <span>{timeStr}</span>
                  {!isInbound && <CheckCheck className="w-3.5 h-3.5 text-emerald-500 ml-0.5" />}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Manual Takeover / Reply Bar */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/90">
        <form onSubmit={handleSend} className="flex items-center gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a manual reply to take over from AI..."
            className="flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-50 placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || sending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 transition-colors disabled:opacity-50 shadow-sm"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">Reply</span>
          </button>
        </form>
      </div>
    </div>
  );
}
