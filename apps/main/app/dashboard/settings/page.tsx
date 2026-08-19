import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { ArrowLeft, Save, Bot, Sliders, Shield, Key } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const tenant = await db.query.tenants.findFirst().catch(() => null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 selection:bg-zinc-800">
      <div className="max-w-4xl mx-auto space-y-6">
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
              <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">AI Concierge Configuration</h1>
              <p className="text-xs text-zinc-400">Configure autonomous response personas, POPIA keywords, and trading rules.</p>
            </div>
          </div>
        </div>

        {/* Configuration Form */}
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-200">Business / Restaurant Name</label>
            <input
              type="text"
              defaultValue={tenant?.name || 'Gemino Bistro & Lounge'}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md px-3.5 py-2 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-zinc-200">Custom AI System Prompt & Personality</label>
            <p className="text-[11px] text-zinc-400">
              Instruct the AI how to greet guests, recommend menu items, and answer table reservation queries.
            </p>
            <textarea
              rows={5}
              defaultValue={
                tenant?.systemPrompt ||
                `You are the friendly, luxury WhatsApp Concierge for our restaurant.
Tone: Warm, courteous, refined hospitality.
Guidelines:
- Keep all WhatsApp answers concise (1-3 sentences).
- If guest mentions booking, request guest count, date, and preferred time.
- If guest asks for dietary specials, highlight vegetarian & halal friendly selections.`
              }
              className="w-full bg-zinc-950 border border-zinc-800 rounded-md p-3.5 text-xs text-zinc-100 font-mono leading-relaxed focus:outline-none focus:border-zinc-600"
            />
          </div>

          <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <Shield className="w-4 h-4 text-emerald-400" />
              POPIA STOP compliance is permanently active.
            </div>
            <button
              type="button"
              className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-semibold text-xs rounded-md transition-colors flex items-center gap-1.5 shadow-sm"
            >
              <Save className="w-3.5 h-3.5" />
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
