'use client';
import { useEffect, useState } from 'react';
import { AlertCircle, Check, CreditCard, Send, RefreshCw, Star, Trash2, Utensils, CalendarCheck, Megaphone, Circle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
const icons: Record<string, LucideIcon> = { success: Check, delete: Trash2, send: Send, payment: CreditCard, error: AlertCircle, sync: RefreshCw, vip: Star, seated: Check, kitchen: Utensils, plate: Circle, campaign: Megaphone, premium: Star };
export function MotionIcon({ kind, size = 20, trigger = 0, className = '' }: { kind: keyof typeof icons; size?: number; trigger?: number; className?: string }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => { setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);
  const Icon = icons[kind] || Circle;
  return <span className={`${!reduced && trigger ? 'motion-icon-play' : ''} inline-flex ${className}`} aria-label={kind}><Icon size={size} strokeWidth={1.8} /></span>;
}
