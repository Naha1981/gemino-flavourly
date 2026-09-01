'use client';

import { AlertTriangle, Check, Gauge, Lightbulb, MessageCircle, Sparkles, TrendingUp } from 'lucide-react';

/**
 * GATE PM-1 — the PulseMap results panel.
 *
 * Renders the forecast honestly: score, readiness badge, segment reaction
 * matrix, predicted objections, likely WhatsApp replies, suggested
 * improved copy (accept or keep original), confidence + assumptions. The
 * disclaimer is NOT optional decoration — it is rendered on every state
 * of this panel, by design and by test.
 */

export interface PulseMapSimulation {
  id: string;
  source: 'ai' | 'demo';
  status: 'complete' | 'unavailable';
  score: number | null;
  readiness: 'ready' | 'improve' | 'rework' | null;
  bestSegment: string | null;
  purchaseIntent: string | null;
  objections: string[] | null;
  likelyReplies: string[] | null;
  riskFlags: string[] | null;
  improvedCopy: string | null;
  explanation: string | null;
  confidence: 'low' | 'medium' | 'high' | null;
  assumptions: string[] | null;
  model: string | null;
  appliedAt: string | Date | null;
  createdAt: string | Date;
  segments: Array<{
    segment: string;
    reaction: string;
    purchaseIntent: number;
    primaryObjection: string | null;
  }>;
}

const SEGMENT_LABELS: Record<string, string> = {
  vip: 'VIPs',
  regular: 'Regulars',
  at_risk: 'At-risk guests',
  dormant: 'Dormant guests',
  new: 'New customers',
};

const READINESS_META: Record<string, { label: string; className: string }> = {
  ready: { label: 'Ready to launch', className: 'bg-emerald-950 text-emerald-300' },
  improve: { label: 'Improve first', className: 'bg-amber-950 text-amber-300' },
  rework: { label: 'Rework recommended', className: 'bg-red-950 text-red-300' },
};

const CONFIDENCE_META: Record<string, string> = {
  low: 'Low confidence — thin data',
  medium: 'Medium confidence',
  high: 'High confidence',
};

function intentColor(intent: number): string {
  if (intent >= 70) return 'text-emerald-400';
  if (intent >= 50) return 'text-amber-400';
  return 'text-zinc-500';
}

export function PulseMapPanel({
  simulation,
  unavailableReason,
  applied,
  busy,
  onApply,
  onKeep,
}: {
  simulation: PulseMapSimulation | null;
  unavailableReason: string | null;
  applied: boolean;
  busy: 'apply' | null;
  onApply: () => void;
  onKeep: () => void;
}) {
  const disclaimer = (
    <p className="mt-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
      Forecast only. Real results are measured after launch.
    </p>
  );

  if (!simulation) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Simulation unavailable right now</h3>
            <p className="mt-1 text-xs text-zinc-400">
              {unavailableReason ??
                'No scores were generated and nothing was sent — try again in a moment.'}
            </p>
            <p className="mt-2 text-xs text-zinc-500">
              Your draft is saved. You can still launch it as-is whenever you are ready.
            </p>
            {disclaimer}
          </div>
        </div>
      </div>
    );
  }

  const readiness = simulation.readiness ? READINESS_META[simulation.readiness] : null;
  const isDemo = simulation.source === 'demo';

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      {/* Header: score + readiness + source */}
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-4">
        <Gauge className="h-5 w-5 text-emerald-400" />
        <h3 className="text-sm font-semibold text-zinc-50">PulseMap forecast</h3>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
            isDemo ? 'bg-amber-950 text-amber-300' : 'bg-blue-950 text-blue-300'
          }`}
        >
          {isDemo ? 'Demo forecast — sample data' : 'AI forecast'}
        </span>
        {readiness && (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${readiness.className}`}>
            {readiness.label}
          </span>
        )}
        {applied && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950 px-2 py-0.5 text-xs text-emerald-300">
            <Check className="h-3 w-3" /> Improved copy applied
          </span>
        )}
        {typeof simulation.score === 'number' && (
          <span className="ml-auto flex items-baseline gap-1">
            <span className="text-2xl font-bold text-zinc-50">{simulation.score}</span>
            <span className="text-xs text-zinc-500">/ 100 campaign score</span>
          </span>
        )}
      </div>

      {/* Purchase intent summary */}
      {simulation.purchaseIntent && (
        <div className="flex items-start gap-2 text-sm text-zinc-300">
          <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <p>{simulation.purchaseIntent}</p>
        </div>
      )}

      {/* Segment reaction matrix */}
      {simulation.segments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="py-2 pr-3 font-medium">Segment</th>
                <th className="py-2 pr-3 font-medium">Predicted reaction</th>
                <th className="py-2 pr-3 font-medium">Intent</th>
                <th className="py-2 font-medium">Main objection</th>
              </tr>
            </thead>
            <tbody>
              {simulation.segments.map((row) => (
                <tr key={row.segment} className="border-b border-zinc-800/60 align-top">
                  <td className="py-2.5 pr-3 font-medium text-zinc-200">
                    {SEGMENT_LABELS[row.segment] ?? row.segment}
                    {simulation.bestSegment === row.segment && (
                      <span className="ml-1.5 rounded-full bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        best fit
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-zinc-400">{row.reaction}</td>
                  <td className={`py-2.5 pr-3 font-semibold ${intentColor(row.purchaseIntent)}`}>
                    {row.purchaseIntent}
                  </td>
                  <td className="py-2.5 text-zinc-500">{row.primaryObjection ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Objections + replies side by side on desktop */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400" /> Likely objections
          </h4>
          <ul className="mt-2 space-y-1.5">
            {(simulation.objections ?? []).map((o, i) => (
              <li key={i} className="text-xs text-zinc-400">• {o}</li>
            ))}
            {(simulation.objections ?? []).length === 0 && (
              <li className="text-xs text-zinc-500">No objections predicted.</li>
            )}
          </ul>
        </div>
        <div className="rounded-lg border border-zinc-800/70 bg-zinc-950/40 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <MessageCircle className="h-3.5 w-3.5 text-blue-400" /> Likely WhatsApp replies
          </h4>
          <ul className="mt-2 space-y-1.5">
            {(simulation.likelyReplies ?? []).map((r, i) => (
              <li key={i} className="rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
                “{r}”
              </li>
            ))}
            {(simulation.likelyReplies ?? []).length === 0 && (
              <li className="text-xs text-zinc-500">No replies predicted.</li>
            )}
          </ul>
        </div>
      </div>

      {/* Risk flags */}
      {(simulation.riskFlags ?? []).length > 0 && (
        <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" /> Risk flags
          </h4>
          <ul className="mt-1.5 space-y-1">
            {(simulation.riskFlags ?? []).map((f, i) => (
              <li key={i} className="text-xs text-red-200/80">• {f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Improved copy + apply/keep */}
      {simulation.improvedCopy && !applied && (
        <div className="rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-4">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" /> Suggested improved version
          </h4>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-200">
            {simulation.improvedCopy}
          </pre>
          {simulation.explanation && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-400">
              <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              {simulation.explanation}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onApply}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy === 'apply' ? 'Applying…' : 'Use improved version'}
            </button>
            <button
              type="button"
              onClick={onKeep}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              Keep my original
            </button>
          </div>
        </div>
      )}

      {/* Confidence + assumptions */}
      <div className="border-t border-zinc-800 pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span className="rounded-full bg-zinc-800 px-2 py-0.5">
            {simulation.confidence ? CONFIDENCE_META[simulation.confidence] : 'Confidence unknown'}
          </span>
          {simulation.model && <span>via {simulation.model}</span>}
          <span>run {new Date(simulation.createdAt).toLocaleString('en-ZA')}</span>
        </div>
        {(simulation.assumptions ?? []).length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-zinc-400">Assumptions</summary>
            <ul className="mt-1.5 space-y-1">
              {(simulation.assumptions ?? []).map((a, i) => (
                <li key={i} className="text-xs text-zinc-500">• {a}</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {disclaimer}
    </div>
  );
}
