#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:3000';

const personas = [
  { id: 'owner_amara', name: 'Amara' },
  { id: 'owner_pieter', name: 'Pieter' },
  { id: 'host_lerato', name: 'Lerato' },
  { id: 'diner_thandi', name: 'Thandi' },
  { id: 'diner_johan', name: 'Johan' },
  { id: 'impatient_teen', name: 'Kai' },
  { id: 'elderly_guest', name: 'Gloria' },
  { id: 'group_booker', name: 'Sipho' },
  { id: 'regular_vip', name: 'Naledi' },
  { id: 'new_owner', name: 'Farah' },
];

const paths = ['/', '/sign-in', '/dashboard', '/dashboard/inbox', '/dashboard/bookings', '/m/the-marula-room'];

async function main() {
  mkdirSync(join(root, 'reports'), { recursive: true });
  const results = [];

  for (const persona of personas) {
    const notes = [];
    let failures = 0;
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, { redirect: 'manual' });
        const ok = res.status < 500;
        if (!ok) failures++;
        notes.push({ path, status: res.status, ok });
      } catch (err) {
        failures++;
        notes.push({ path, error: err.message, ok: false });
      }
    }
    results.push({
      persona_id: persona.id,
      name: persona.name,
      success: failures === 0,
      failures,
      notes,
    });
  }

  const passed = results.filter((r) => r.success).length;
  const report = {
    generated_at: new Date().toISOString(),
    target: base,
    personas: results.length,
    passed,
    score: `${passed}/${results.length}`,
    results,
  };

  const out = join(root, 'reports', 'matraix-smoke.json');
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`MatrAIx smoke ${report.score} → ${out}`);
  if (passed < 8) process.exit(1);
}

main();
