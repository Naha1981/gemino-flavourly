import { redirect } from 'next/navigation';
import { resolveActiveTenant } from '@/lib/tenant-resolver';
import { listMarketingCampaigns } from '@/lib/marketing/campaign-store';
import { reconcileCampaignAttribution } from '@/lib/marketing/attribution-store';

export const dynamic='force-dynamic';

export default async function AttributionPage(){
 const resolved=await resolveActiveTenant();if(!resolved)redirect('/sign-in');
 const tenant=resolved.tenant;
 const [campaigns,summaries]=await Promise.all([listMarketingCampaigns(tenant.id),reconcileCampaignAttribution(tenant.id).catch(()=>[])]);
 const byId=new Map(summaries.map(s=>[s.campaignId,s]));
 const sent=summaries.reduce((n,s)=>n+s.sent,0),responded=summaries.reduce((n,s)=>n+s.responded,0),booked=summaries.reduce((n,s)=>n+s.booked,0);
 const estimated=summaries.reduce((n,s)=>n+s.estimatedRevenueCents,0),realized=summaries.reduce((n,s)=>n+s.realizedRevenueCents,0);
 return <div className="space-y-6">
  <div><h1 className="headline-md">Campaign Attribution</h1><p className="label-sm mt-1 text-app-muted">Trace campaign sends to responses, bookings and realised revenue where the evidence supports it.</p></div>
  <div className="grid gap-4 md:grid-cols-4"><div className="glass-card p-5"><p className="label-sm">Sent</p><p className="headline-lg mt-1">{sent}</p></div><div className="glass-card p-5"><p className="label-sm">Response rate</p><p className="headline-lg mt-1">{sent?Math.round((responded/sent)*100):0}%</p></div><div className="glass-card p-5"><p className="label-sm">Booking rate</p><p className="headline-lg mt-1">{sent?Math.round((booked/sent)*100):0}%</p></div><div className="glass-card p-5"><p className="label-sm">Realised revenue</p><p className="headline-lg mt-1">R{Math.round(realized/100).toLocaleString('en-ZA')}</p></div></div>
  <div className="overflow-hidden rounded-2xl border border-app-border"><table className="w-full text-left text-sm"><thead className="bg-app-surface-1 text-xs uppercase"><tr><th className="px-4 py-3">Campaign</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3">Responses</th><th className="px-4 py-3">Bookings</th><th className="px-4 py-3">Estimated</th><th className="px-4 py-3">Realised</th></tr></thead><tbody className="divide-y divide-app-border">{campaigns.map(c=>{const s=byId.get(c.id);return <tr key={c.id}><td className="px-4 py-3 font-medium">{c.name}</td><td className="px-4 py-3">{s?.sent??0}</td><td className="px-4 py-3">{s?.responded??0}</td><td className="px-4 py-3">{s?.booked??0}</td><td className="px-4 py-3">R{Math.round((s?.estimatedRevenueCents??0)/100).toLocaleString('en-ZA')}</td><td className="px-4 py-3 text-emerald-700">R{Math.round((s?.realizedRevenueCents??0)/100).toLocaleString('en-ZA')}</td></tr>})}</tbody></table>{!campaigns.length&&<div className="p-8 text-center text-sm text-app-muted">Launch a campaign to create attribution data.</div>}</div>
  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">Estimated revenue is a planning value. Realised revenue is only shown when Flavourly can trace a revenue event to the attributed conversation.</div>
 </div>;
}
