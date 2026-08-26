import { NextRequest, NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import {
  getProspect,
  updateProspect,
  createClaimToken,
  findLiveClaimTokenForTenant,
  claimLinkFor,
} from '@/lib/brand-intelligence/prospect-store';

export const runtime = 'nodejs';

/**
 * Super Admin — generate (or reuse) a magic-link claim token for a built
 * prospect's tenant. Reuses an existing unexpired, unclaimed token so
 * repeated clicks don't burn tokens or break a link already shared.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  const prospect = await getProspect(params.id);
  if (!prospect) {
    return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
  }
  if (!prospect.tenantId) {
    return NextResponse.json({ error: 'Prospect has no tenant yet — build the demo tenant first' }, { status: 409 });
  }

  let tokenRow = await findLiveClaimTokenForTenant(prospect.tenantId);
  if (!tokenRow) {
    tokenRow = await createClaimToken(prospect.tenantId);
  }

  await updateProspect(prospect.id, { claimToken: tokenRow.token });

  return NextResponse.json({
    ok: true,
    token: tokenRow.token,
    claimLink: claimLinkFor(tokenRow),
    expiresAt: tokenRow.expiresAt.toISOString(),
  });
}
