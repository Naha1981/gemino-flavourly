import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type MenuItem = {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  priceCents: number | null;
  available: boolean;
  position: number;
};

function row(row: any): MenuItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    available: Boolean(row.available),
    position: Number(row.position ?? 0),
  };
}

function parseMenuText(menuText: string | null): Array<Omit<MenuItem, 'id' | 'available' | 'position'>> {
  if (!menuText?.trim()) return [];
  const lines = menuText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  return lines.map((line) => {
    const match = line.match(/^(.*?)(?:\s*[-–—:]\s*)R\s*([\d,]+(?:\.\d{1,2})?)$/i);
    if (!match) return { name: line, category: null, description: null, priceCents: null };
    const price = Number(match[2].replace(/,/g, ''));
    return { name: match[1].trim(), category: null, description: null, priceCents: Number.isFinite(price) ? Math.round(price * 100) : null };
  });
}

export async function ensureMenuItems(tenantId: string, menuText?: string | null): Promise<MenuItem[]> {
  const existing = await db.execute(sql`
    SELECT id, name, category, description, price_cents, available, position
    FROM menu_items WHERE tenant_id = ${tenantId}
    ORDER BY position, created_at
  `);
  const rows = (existing as any).rows ?? existing as any[];
  if (rows.length > 0) return rows.map(row);

  const parsed = parseMenuText(menuText ?? '');
  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    await db.execute(sql`
      INSERT INTO menu_items (tenant_id, name, category, description, price_cents, available, position)
      VALUES (${tenantId}, ${item.name}, ${item.category}, ${item.description}, ${item.priceCents}, true, ${i})
    `);
  }
  return parsed.length ? ensureMenuItems(tenantId, menuText) : [];
}

export async function listMenuItems(tenantId: string): Promise<MenuItem[]> {
  const result = await db.execute(sql`
    SELECT id, name, category, description, price_cents, available, position
    FROM menu_items WHERE tenant_id = ${tenantId}
    ORDER BY position, created_at
  `);
  return ((result as any).rows ?? result as any[]).map(row);
}
