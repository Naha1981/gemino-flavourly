import { db } from '@/lib/db';
import { waAccounts, waAccountBindings } from '@/lib/db/schema';
import { and, asc, eq, desc } from 'drizzle-orm';

const DEFAULT_OPERATOR_URL = 'https://my-own-whatsapp-2z5h.onrender.com';
const DEFAULT_APP_ID = 'gemino';
const REQUEST_TIMEOUT_MS = 20_000;
const HEALTH_TIMEOUT_MS = 5_000;

export type CentralOperatorStatus = {
  waAccountId: string;
  status: string;
  isConnected: boolean;
  phoneNumber?: string | null;
};

export type CentralQr = {
  status: string;
  isConnected: boolean;
  qrCode: string | null;
  qrGeneratedAt?: string | null;
  qrExpiresAt?: string | null;
  qrImageUrl?: string | null;
  qrPollIntervalMs?: number;
};

export type CentralPairingCode = {
  waAccountId: string;
  status: string;
  pairingCode: string | null;
  pairingCodeDisplay?: string | null;
  expiresAt?: string | null;
  isConnected?: boolean;
};

type JsonRecord = Record<string, unknown>;

function operatorBaseUrl(): string {
  const raw = process.env.OPERATOR_URL?.trim() || DEFAULT_OPERATOR_URL;
  return raw.replace(/\/+$/, '');
}

function appId(): string {
  return process.env.APP_ID?.trim() || DEFAULT_APP_ID;
}

function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
}

function webhookUrl(): string {
  const url = `${appUrl()}/api/webhooks/whatsapp`;
  if (process.env.NODE_ENV === 'production' && (!appUrl() || !/^https:\/\//i.test(appUrl()))) {
    throw new Error('APP_URL must be a public HTTPS URL in production so the central WhatsApp Operator can deliver inbound webhooks.');
  }
  return url;
}

function requireApiKey(): string {
  const key = process.env.OPERATOR_API_KEY?.trim();
  if (!key) throw new Error('OPERATOR_API_KEY is not configured on the Gemino server.');
  return key;
}

async function request<T>(
  tenantId: string,
  path: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('X-API-Key', requireApiKey());
  headers.set('X-App-Id', appId());
  headers.set('X-Tenant-Id', tenantId);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${operatorBaseUrl()}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`NahaLabs WhatsApp Operator unavailable: ${message}`);
  }

  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as JsonRecord).message)
        : typeof body === 'object' && body !== null && 'error' in body
          ? String((body as JsonRecord).error)
          : `Operator request failed with HTTP ${response.status}`;
    throw new Error(`WhatsApp Operator HTTP ${response.status}: ${message}`);
  }

  return body as T;
}

async function getLocalAccount(tenantId: string, localWaAccountId: string) {
  const [account] = await db
    .select()
    .from(waAccounts)
    .where(and(eq(waAccounts.id, localWaAccountId), eq(waAccounts.tenantId, tenantId)))
    .limit(1);
  if (!account) throw new Error('WhatsApp account is not available for this tenant.');
  return account;
}

async function getBinding(tenantId: string) {
  const [binding] = await db
    .select()
    .from(waAccountBindings)
    .where(and(eq(waAccountBindings.appId, appId()), eq(waAccountBindings.tenantId, tenantId)))
    .orderBy(desc(waAccountBindings.createdAt), desc(waAccountBindings.id))
    .limit(1);
  return binding ?? null;
}

async function saveBinding(tenantId: string, centralWaAccountId: string) {
  const hook = webhookUrl();

  const existing = await getBinding(tenantId);
  if (existing && existing.waAccountId === centralWaAccountId && existing.webhookUrl === hook) return existing;

  if (existing) {
    await db.delete(waAccountBindings).where(eq(waAccountBindings.id, existing.id));
  }

  const [binding] = await db
    .insert(waAccountBindings)
    .values({
      waAccountId: centralWaAccountId,
      appId: appId(),
      tenantId,
      webhookUrl: hook,
    })
    .returning();

  return binding;
}

/** Ensure the Gemino tenant has one centrally-owned WhatsApp identity. */
async function ensureCentralAccount(tenantId: string): Promise<string> {
  const existing = await getBinding(tenantId);
  if (existing) {
    try {
      await request<CentralOperatorStatus>(
        tenantId,
        `/accounts/${encodeURIComponent(existing.waAccountId)}/status`,
        { method: 'GET' },
        10_000,
      );
      return existing.waAccountId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('HTTP 404')) throw error;
      await db.delete(waAccountBindings).where(eq(waAccountBindings.id, existing.id));
    }
  }

  const bootstrapped = await request<{ waAccountId: string }>(tenantId, '/accounts/bootstrap', {
    method: 'POST',
    body: JSON.stringify({
      label: `Gemino WhatsApp — ${tenantId.slice(0, 8)}`,
      appId: appId(),
      tenantId,
      webhookUrl: webhookUrl(),
    }),
  });

  if (!bootstrapped?.waAccountId) {
    throw new Error('Central WhatsApp Operator returned no waAccountId from /accounts/bootstrap.');
  }

  await saveBinding(tenantId, bootstrapped.waAccountId);
  return bootstrapped.waAccountId;
}

export const centralWhatsApp = {
  async checkHealth(timeoutMs = HEALTH_TIMEOUT_MS): Promise<boolean> {
    try {
      const response = await fetch(`${operatorBaseUrl()}/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  async bootstrap(tenantId: string, label?: string) {
    const local = await getBinding(tenantId);
    if (local) return { waAccountId: local.waAccountId, created: false };

    const result = await request<{ waAccountId: string; created?: boolean }>(tenantId, '/accounts/bootstrap', {
      method: 'POST',
      body: JSON.stringify({
        label: label?.trim() || `Gemino WhatsApp — ${tenantId.slice(0, 8)}`,
        appId: appId(),
        tenantId,
        webhookUrl: webhookUrl(),
      }),
    });
    if (!result?.waAccountId) throw new Error('Central WhatsApp Operator did not return a waAccountId.');
    await saveBinding(tenantId, result.waAccountId);
    return { waAccountId: result.waAccountId, created: result.created ?? true };
  },

  async connect(tenantId: string, localWaAccountId: string) {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<{ waAccountId: string; status: string }>(
      tenantId,
      `/accounts/${encodeURIComponent(centralId)}/connect`,
      { method: 'POST' },
    );
  },

  async status(tenantId: string, localWaAccountId: string): Promise<CentralOperatorStatus> {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<CentralOperatorStatus>(tenantId, `/accounts/${encodeURIComponent(centralId)}/status`);
  },

  async qr(tenantId: string, localWaAccountId: string): Promise<CentralQr> {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<CentralQr>(tenantId, `/accounts/${encodeURIComponent(centralId)}/qr`);
  },

  async pairingCode(tenantId: string, localWaAccountId: string, phoneNumber: string): Promise<CentralPairingCode> {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<CentralPairingCode>(tenantId, `/accounts/${encodeURIComponent(centralId)}/pairing-code`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber }),
    });
  },

  async currentPairingCode(tenantId: string, localWaAccountId: string): Promise<CentralPairingCode> {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<CentralPairingCode>(tenantId, `/accounts/${encodeURIComponent(centralId)}/pairing-code`);
  },

  async reset(tenantId: string, localWaAccountId: string) {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    const result = await request<{ waAccountId: string; status: string }>(
      tenantId,
      `/accounts/${encodeURIComponent(centralId)}/reset`,
      { method: 'POST' },
    );
    return result;
  },

  async disconnect(tenantId: string, localWaAccountId: string) {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<{ waAccountId: string; status: string }>(
      tenantId,
      `/accounts/${encodeURIComponent(centralId)}/disconnect`,
      { method: 'POST' },
    );
  },

  async sendText(tenantId: string, localWaAccountId: string, to: string, text: string) {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<JsonRecord>(tenantId, '/send', {
      method: 'POST',
      body: JSON.stringify({ waAccountId: centralId, to, type: 'text', text }),
    });
  },

  async readMessages(tenantId: string, localWaAccountId: string, payload: JsonRecord) {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<JsonRecord>(tenantId, '/messages/read', {
      method: 'POST',
      body: JSON.stringify({ ...payload, waAccountId: centralId }),
    });
  },

  async setPresence(tenantId: string, localWaAccountId: string, payload: JsonRecord) {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<JsonRecord>(tenantId, '/messages/presence', {
      method: 'POST',
      body: JSON.stringify({ ...payload, waAccountId: centralId }),
    });
  },

  async editMessage(tenantId: string, localWaAccountId: string, payload: JsonRecord) {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<JsonRecord>(tenantId, '/messages/edit', {
      method: 'POST',
      body: JSON.stringify({ ...payload, waAccountId: centralId }),
    });
  },

  async deleteMessage(tenantId: string, localWaAccountId: string, payload: JsonRecord) {
    await getLocalAccount(tenantId, localWaAccountId);
    const centralId = await ensureCentralAccount(tenantId);
    return request<JsonRecord>(tenantId, '/messages/delete', {
      method: 'POST',
      body: JSON.stringify({ ...payload, waAccountId: centralId }),
    });
  },
};

export async function resolveCentralWaAccountId(tenantId: string): Promise<string | null> {
  const binding = await getBinding(tenantId);
  return binding?.waAccountId ?? null;
}

export async function resolveGeminoTenantFromCentralAccount(centralWaAccountId: string): Promise<string | null> {
  const [binding] = await db
    .select({ tenantId: waAccountBindings.tenantId })
    .from(waAccountBindings)
    .where(and(eq(waAccountBindings.waAccountId, centralWaAccountId), eq(waAccountBindings.appId, appId())))
    .orderBy(asc(waAccountBindings.createdAt))
    .limit(1);
  return binding?.tenantId ?? null;
}
