'use client';

import { useEffect, useState } from 'react';
import { UserPlus, ShieldCheck } from 'lucide-react';

type Staff = { id:string; name:string|null; email:string|null; role:string; clerkUserId:string; createdAt:string };

export default function StaffPage(){
 const [staff,setStaff]=useState<Staff[]>([]);
 const [role,setRole]=useState('none');
 const [email,setEmail]=useState('');
 const [inviteRole,setInviteRole]=useState('staff');
 const [inviteUrl,setInviteUrl]=useState('');
 const [error,setError]=useState('');
 async function load(){const r=await fetch('/api/staff',{cache:'no-store'});const d=await r.json();setStaff(d.staff??[]);if(!r.ok)setError(d.error||'Could not load staff');}
 useEffect(()=>{void load()},[]);
 async function invite(){setError('');const r=await fetch('/api/staff/invite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,role:inviteRole})});const d=await r.json();if(!r.ok){setError(d.error||'Invite failed');return;}setInviteUrl(window.location.origin+d.inviteUrl);}
 return <div className="space-y-6"><div><h1 className="headline-md flex items-center gap-2"><ShieldCheck className="h-5 w-5"/> Staff & Roles</h1><p className="label-sm mt-1 text-app-muted">Owners and managers can invite restaurant staff. Role checks are enforced on the server.</p></div><div className="glass-card p-5"><h2 className="label-md mb-3">Invite someone</h2><div className="flex flex-col gap-3 md:flex-row"><input value={email} onChange={e=>setEmail(e.target.value)} placeholder="staff@restaurant.co.za" className="flex-1 rounded-lg border p-2 bg-app-surface-0"/><select value={inviteRole} onChange={e=>setInviteRole(e.target.value)} className="rounded-lg border p-2 bg-app-surface-0"><option value="staff">Staff</option><option value="manager">Manager</option></select><button onClick={invite} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white dark:bg-emerald-600"><UserPlus className="mr-1 inline h-4 w-4"/>Create invite</button></div>{inviteUrl&&<p className="mt-3 break-all rounded-lg bg-app-surface-1 p-3 text-xs">{inviteUrl}</p>}{error&&<p className="mt-3 text-sm text-red-600">{error}</p>}</div><div className="overflow-hidden rounded-2xl border border-app-border"><table className="w-full text-left text-sm"><thead className="bg-app-surface-1 text-xs uppercase"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Role</th></tr></thead><tbody className="divide-y divide-app-border">{staff.map(s=><tr key={s.id}><td className="px-4 py-3">{s.name||'—'}</td><td className="px-4 py-3">{s.email||'—'}</td><td className="px-4 py-3 capitalize">{s.role.replace('_',' ')}</td></tr>)}</tbody></table></div></div>;
}
