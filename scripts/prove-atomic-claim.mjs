#!/usr/bin/env node
/**
 * Two workers race to claim the same outbox job.
 * Expected: exactly one UPDATE ... AND status='pending' RETURNING succeeds.
 */
import { PGlite } from '@electric-sql/pglite';

const sql = `
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  status text NOT NULL,
  updated_at timestamp DEFAULT NOW() NOT NULL
);
`;

async function claim(db, id, worker) {
  const res = await db.query(
    `UPDATE jobs SET status = 'processing', updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING id`,
    [id]
  );
  return { worker, claimed: res.rows.length === 1 };
}

async function main() {
  const db = new PGlite();
  await db.waitReady;
  await db.exec(sql);
  await db.query(`INSERT INTO jobs (id, status) VALUES ($1, 'pending')`, ['job-race-1']);

  const [a, b] = await Promise.all([claim(db, 'job-race-1', 'worker-A'), claim(db, 'job-race-1', 'worker-B')]);

  const winners = [a, b].filter((r) => r.claimed);
  const losers = [a, b].filter((r) => !r.claimed);

  console.log('=== ATOMIC CLAIM RACE ===');
  console.log(a);
  console.log(b);
  console.log(`winners=${winners.length} losers=${losers.length}`);

  if (winners.length !== 1 || losers.length !== 1) {
    console.error('FAIL: expected exactly one send');
    process.exit(1);
  }
  console.log('PASS: 1 send (the other worker skipped 0 rows)');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
