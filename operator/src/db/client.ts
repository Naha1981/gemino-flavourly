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

export async function getConnectedAccountIds(): Promise<string[]> {
  const res = await pool.query<{ id: string }>('SELECT id FROM wa_accounts WHERE is_connected = true');
  return res.rows.map((r) => r.id);
}

// ───────────────────────────────────────────────────────────────────────
// Postgres-backed Baileys Signal key store.
//
// `session_creds` (above) only covers the top-level `creds` object. A real
// Baileys session also needs the Signal protocol key store — pre-keys,
// sender keys, app-state sync keys — or a restart forces a fresh QR scan
// (or worse, a half-restored session that fails to decrypt). This follows
// Baileys' own documented "custom auth state" pattern, backed by the
// `wa_auth_keys` table instead of the filesystem.
// ───────────────────────────────────────────────────────────────────────

async function readAuthKey(waAccountId: string, keyType: string, keyId: string): Promise<unknown | null> {
  const res = await pool.query<{ value: unknown }>(
    'SELECT value FROM wa_auth_keys WHERE wa_account_id = $1 AND key_type = $2 AND key_id = $3',
    [waAccountId, keyType, keyId]
  );
  if (!res.rows[0]) return null;
  const { BufferJSON } = await import('@whiskeysockets/baileys');
  return JSON.parse(JSON.stringify(res.rows[0].value), BufferJSON.reviver);
}

async function writeAuthKey(waAccountId: string, keyType: string, keyId: string, value: unknown): Promise<void> {
  const { BufferJSON } = await import('@whiskeysockets/baileys');
  const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  await pool.query(
    `INSERT INTO wa_auth_keys (wa_account_id, key_type, key_id, value)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (wa_account_id, key_type, key_id) DO UPDATE SET value = EXCLUDED.value`,
    [waAccountId, keyType, keyId, serialized]
  );
}

async function removeAuthKey(waAccountId: string, keyType: string, keyId: string): Promise<void> {
  await pool.query('DELETE FROM wa_auth_keys WHERE wa_account_id = $1 AND key_type = $2 AND key_id = $3', [
    waAccountId,
    keyType,
    keyId,
  ]);
}

/**
 * Full Baileys AuthenticationState backed by Postgres: real creds AND a
 * real Signal key store, so a session survives Render restarts without
 * needing the QR re-scanned every time. Replaces the old in-memory stub
 * (`keys: { get: async () => ({}), set: async () => {} }`) that silently
 * discarded every Signal key it was given.
 */
export async function getPostgresAuthState(waAccountId: string) {
  const { BufferJSON, initAuthCreds, proto } = await import('@whiskeysockets/baileys');

  const saved = await getCreds(waAccountId);
  const creds = saved ? JSON.parse(saved, BufferJSON.reviver) : initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const data: Record<string, any> = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readAuthKey(waAccountId, type, id);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          const tasks: Promise<void>[] = [];
          for (const category of Object.keys(data)) {
            const categoryData = data[category];
            if (!categoryData) continue;
            for (const id of Object.keys(categoryData)) {
              const value = categoryData[id];
              tasks.push(
                value
                  ? writeAuthKey(waAccountId, category, id, value)
                  : removeAuthKey(waAccountId, category, id)
              );
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await saveCreds(waAccountId, JSON.stringify(creds, BufferJSON.replacer));
    },
  };
}

export { pool };
