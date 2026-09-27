'use client';
import {useEffect,useState} from 'react';

export default function KnowledgePage(){
 const[docs,setDocs]=useState<any[]>([]);const[file,setFile]=useState<File|null>(null);const[msg,setMsg]=useState('');
 async function load(){const r=await fetch('/api/knowledge',{cache:'no-store'});const d=await r.json();setDocs(d.documents??[])}
 useEffect(()=>{void load()},[]);
 async function upload(){if(!file)return;setMsg('Uploading…');const form=new FormData();form.append('file',file);const r=await fetch('/api/knowledge',{method:'POST',body:form});const d=await r.json();setMsg(r.ok?'Knowledge uploaded and indexed':d.error||'Upload failed');if(r.ok){setFile(null);await load()}}
 async function remove(id:string){await fetch('/api/knowledge/'+id,{method:'DELETE'});await load()}
 return <div className="max-w-3xl space-y-6"><div><h1 className="headline-md">Restaurant Knowledge</h1><p className="label-sm mt-1 text-app-muted">Upload menus, policies, dietary guides and operating notes. Flavourly retrieves relevant passages before the AI answers.</p></div><div className="glass-card p-5 space-y-3"><input type="file" accept=".pdf,.txt,.md,.csv,.json" onChange={e=>setFile(e.target.files?.[0]??null)} className="block w-full text-sm"/><button onClick={upload} disabled={!file} className="rounded-lg bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-emerald-600">Upload & index</button>{msg&&<p className="text-sm text-app-muted">{msg}</p>}</div><div className="space-y-3">{docs.map(d=><div key={d.id} className="glass-card flex items-center justify-between p-4"><div><p className="text-sm font-medium">{d.name}</p><p className="text-xs text-app-muted">{d.mime_type} · {new Date(d.created_at).toLocaleString('en-ZA')}</p></div><button onClick={()=>remove(d.id)} className="text-xs text-red-600">Remove</button></div>)}{docs.length===0&&<div className="rounded-xl border border-dashed p-6 text-sm text-app-muted">No knowledge documents yet.</div>}</div></div>
}
