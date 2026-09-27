'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useParams, useRouter } from 'next/navigation';

export default function StaffInvitePage(){
 const params=useParams<{token:string}>(); const router=useRouter(); const {isSignedIn}=useAuth(); const [busy,setBusy]=useState(false); const [msg,setMsg]=useState('');
 async function accept(){setBusy(true);const r=await fetch(`/api/staff/invite/${params.token}`,{method:'POST'});const d=await r.json();if(!r.ok){setMsg(d.error||'Could not accept invite');setBusy(false);return;}router.push('/dashboard');}
 return <main className="min-h-screen grid place-items-center p-6 bg-app-bg"><div className="w-full max-w-md glass-card p-7 text-center"><h1 className="headline-md">Restaurant staff invitation</h1><p className="label-sm mt-2 text-app-muted">Sign in with the invited email, then accept access to the restaurant workspace.</p>{!isSignedIn?<a href="/sign-in" className="mt-6 inline-flex rounded-full bg-black px-5 py-3 text-sm font-semibold text-white">Sign in</a>:<button disabled={busy} onClick={accept} className="mt-6 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white dark:bg-emerald-600">{busy?'Accepting…':'Accept invitation'}</button>}{msg&&<p className="mt-4 text-sm text-red-600">{msg}</p>}</div></main>
}
