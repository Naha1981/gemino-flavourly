export type EmailInput = { to: string; subject: string; html: string; text?: string; from?: string };

export async function sendResendEmail(input: EmailInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const from = input.from || process.env.QA_ALERT_FROM || 'NahaLabs <onboarding@resend.dev>';
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
  });
  if (!response.ok) return { ok: false, error: (await response.text()).slice(0, 500) };
  const data = await response.json();
  return { ok: true, id: data.id };
}
