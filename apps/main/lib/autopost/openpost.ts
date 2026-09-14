import 'server-only';

export type OpenPostConfig = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
};

export type CreatePublicationInput = {
  workspaceId: string;
  title: string;
  sourceText: string;
  contentProfile?: string;
  mediaIds?: string[];
  socialAccountIds?: string[];
};

export class OpenPostClient {
  constructor(private readonly config: OpenPostConfig) {}

  async health(): Promise<Record<string, unknown>> {
    return this.request('/api/v1/health', { method: 'GET', authenticated: false });
  }

  async createPublication(input: CreatePublicationInput): Promise<Record<string, unknown>> {
    return this.request('/api/v1/publications', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        title: input.title.slice(0, 80) || 'Untitled',
        content_profile: input.contentProfile ?? 'short_text',
        source_text: input.sourceText,
        social_account_ids: input.socialAccountIds ?? [],
        media: (input.mediaIds ?? []).map((mediaId) => ({ media_id: mediaId })),
      }),
    });
  }

  async schedulePublication(publicationId: string, scheduledAt: string): Promise<Record<string, unknown>> {
    return this.request(`/api/v1/publications/${encodeURIComponent(publicationId)}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduled_at: scheduledAt }),
    });
  }

  private async request(path: string, init: RequestInit & { authenticated?: boolean }): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    if (init.authenticated !== false && this.config.token) {
      headers.set('Authorization', `Bearer ${this.config.token}`);
    }

    const timeout = this.config.timeoutMs ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        cache: 'no-store',
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`OpenPost ${response.status}: ${detail.slice(0, 500)}`);
      }
      if (response.status === 204) return {};
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getOpenPostClient(): OpenPostClient | null {
  const baseUrl = process.env.OPENPOST_BASE_URL?.trim();
  const token = process.env.OPENPOST_API_TOKEN?.trim();
  if (!baseUrl || !token) return null;
  return new OpenPostClient({
    baseUrl,
    token,
    timeoutMs: Number(process.env.OPENPOST_TIMEOUT_MS ?? 30_000),
  });
}
