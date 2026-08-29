import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { listChannelConfigs } from '@/lib/operations/channel-config-store';

export const dynamic = 'force-dynamic';

export default async function ChannelConfigsPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const configs = await listChannelConfigs(tenant.id);
  const channels = [
    { key: 'whatsapp', label: 'WhatsApp', icon: '💬' },
    { key: 'email', label: 'Email', icon: '📧' },
    { key: 'instagram', label: 'Instagram', icon: '📷' },
    { key: 'facebook', label: 'Facebook', icon: '👤' },
    { key: 'web', label: 'Web Chat', icon: '🌐' },
  ];

  const enabledCount = configs.filter((c) => c.enabled).length;

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <h1 className="text-xl font-semibold text-zinc-50">Channel Configurations</h1>
        <p className="text-xs text-zinc-400">
          {enabledCount} of {channels.length} channels enabled. Configure credentials for each channel to enable messaging beyond WhatsApp.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {channels.map((ch) => {
          const config = configs.find((c) => c.channel === ch.key);
          const isEnabled = config?.enabled ?? false;
          return (
            <div key={ch.key} className={`rounded-lg border p-4 ${isEnabled ? 'border-emerald-800 bg-zinc-900/80' : 'border-zinc-800 bg-zinc-900/50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ch.icon}</span>
                  <span className="text-sm font-medium text-zinc-100">{ch.label}</span>
                </div>
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${isEnabled ? 'bg-emerald-950 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}`}>
                  {isEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              {config ? (
                <div className="mt-3 space-y-2 text-xs text-zinc-400">
                  <div className="flex justify-between">
                    <span>Credentials</span>
                    <span className={config.credentialsEncrypted ? 'text-emerald-300' : 'text-red-300'}>
                      {config.credentialsEncrypted ? 'Stored' : 'Missing'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Updated</span>
                    <span>{new Date(config.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-xs text-zinc-500">Not configured yet.</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6">
        <p className="text-sm text-zinc-400">
          Channel configuration is managed via the API. Use the <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs text-zinc-200">/api/operations/channel-configs</code> endpoint to add or update credentials.
          Credentials are encrypted at rest and never exposed through the dashboard.
        </p>
      </div>
    </div>
  );
}
