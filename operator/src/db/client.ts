import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: process.env.DATABASE_URL?.includes('neon.tech') || process.env.DATABASE_URL?.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function getWaAccount(waAccountId: string) {
  const res = await pool.query('SELECT * FROM wa_accounts WHERE id = $1', [waAccountId]);
  return res.rows[0] || null;
}

export async function updateWaAccount(
  waAccountId: string,
  updates: {
    isConnected?: boolean;
    qrCode?: string | null;
    phoneNumber?: string | null;
    status?: 'unlinked' | 'connecting' | 'connected' | 'disconnected';
    lastConnectedAt?: Date;
  }
) {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (updates.isConnected !== undefined) {
    fields.push(`is_connected = $${idx++}`);
    values.push(updates.isConnected);
  }
  if (updates.qrCode !== undefined) {
    fields.push(`qr_code = $${idx++}`);
    values.push(updates.qrCode);
  }
  if (updates.phoneNumber !== undefined) {
    fields.push(`phone_number = $${idx++}`);
    values.push(updates.phoneNumber);
  }
  if (updates.status !== undefined) {
    fields.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.lastConnectedAt !== undefined) {
    fields.push(`last_connected_at = $${idx++}`);
    values.push(updates.lastConnectedAt);
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = NOW()`);
  values.push(waAccountId);

  await pool.query(`UPDATE wa_accounts SET ${fields.join(', ')} WHERE id = $${idx}`, values);
}

export async function getCreds(waAccountId: string): Promise<string | null> {
  const res = await pool.query('SELECT session_creds FROM wa_accounts WHERE id = $1', [waAccountId]);
  return res.rows[0]?.session_creds || null;
}

export async function saveCreds(waAccountId: string, creds: string) {
  await pool.query('UPDATE wa_accounts SET session_creds = $1, updated_at = NOW() WHERE id = $2', [
    creds,
    waAccountId,
  ]);
}

export async function getAccountBinding(waAccountId: string) {
  try {
    const res = await pool.query('SELECT * FROM wa_account_bindings WHERE wa_account_id = $1 LIMIT 1', [
      waAccountId,
    ]);
    return res.rows[0] || null;
  } catch {
    return null;
  }
}

export { pool };
