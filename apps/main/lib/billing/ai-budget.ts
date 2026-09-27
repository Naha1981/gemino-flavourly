import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type AiBudgetPlan = 'trial' | 'starter' | 'casual' | 'premium' | 'signature' | 'group' | string;

const DAILY_TURN_LIMITS: Record<string, number | null> = {
  trial: 100,
  starter: 100,
  casual: 500,
  premium: 1500,
  signature: 5000,
  group: null,
};

export type AiBudgetResult = {
  allowed: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
};

export async function consumeAiRequest(tenantId: string, plan: AiBudgetPlan): Promise<AiBudgetResult> {
  const limit = DAILY_TURN_LIMITS[plan.toLowerCase()] ?? DAILY_TURN_LIMITS.trial;
  if (limit === null) return { allowed: true, limit: null, used: 0, remaining: null };

  const result = await db.execute(sql`
    INSERT INTO ai_usage_daily (tenant_id, usage_date, requests, input_tokens, output_tokens, updated_at)
    VALUES (${tenantId}, CURRENT_DATE, 1, 0, 0, NOW())
    ON CONFLICT (tenant_id, usage_date)
    DO UPDATE SET
      requests = CASE
        WHEN ai_usage_daily.requests < ${limit} THEN ai_usage_daily.requests + 1
        ELSE ai_usage_daily.requests
      END,
      updated_at = NOW()
    RETURNING requests
  `);
  const used = Number(((result as any).rows?.[0] ?? (result as any)[0])?.requests ?? 0);
  return {
    allowed: used <= limit,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

export function aiBudgetLabel(result: AiBudgetResult): string {
  if (result.limit === null) return 'Unlimited plan';
  return `${result.remaining} AI turns remaining today`;
}

export const AI_DAILY_LIMITS = DAILY_TURN_LIMITS;
