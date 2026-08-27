import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideTenantId, isUuidLike } from './tenant-resolver-core.ts';

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
const TENANT_C = '00000000-0000-0000-0000-00000000000c';
const DEFAULT_T = '00000000-0000-0000-0000-0000000000ff';

describe('tenant-resolver — isUuidLike', () => {
  test('accepts canonical uuids (case-insensitive)', () => {
    assert.ok(isUuidLike(TENANT_A));
    assert.ok(isUuidLike(TENANT_A.toUpperCase()));
  });

  test('rejects junk, traversal attempts and empty values', () => {
    assert.equal(isUuidLike(null), false);
    assert.equal(isUuidLike(undefined), false);
    assert.equal(isUuidLike(''), false);
    assert.equal(isUuidLike('not-a-uuid'), false);
    assert.equal(isUuidLike('../other-tenant'), false);
    assert.equal(isUuidLike('00000000-0000-0000-0000-00000000000g'), false);
    assert.equal(isUuidLike(`${TENANT_A}suffix`), false);
  });
});

describe('tenant-resolver — priority order', () => {
  test('?tenant= wins over cookie and membership', () => {
    const decision = decideTenantId({
      queryTenantId: TENANT_B,
      cookieTenantId: TENANT_A,
      managedIds: [TENANT_A, TENANT_B],
      isSuperAdmin: false,
    });
    assert.deepEqual(decision, { tenantId: TENANT_B, source: 'query' });
  });

  test('cookie wins over bare membership when no ?tenant=', () => {
    const decision = decideTenantId({
      queryTenantId: null,
      cookieTenantId: TENANT_B,
      managedIds: [TENANT_A, TENANT_B],
      isSuperAdmin: false,
    });
    assert.deepEqual(decision, { tenantId: TENANT_B, source: 'cookie' });
  });

  test('falls back to the oldest managed tenant (deterministic)', () => {
    const decision = decideTenantId({
      queryTenantId: null,
      cookieTenantId: null,
      managedIds: [TENANT_A, TENANT_B],
      isSuperAdmin: false,
    });
    assert.deepEqual(decision, { tenantId: TENANT_A, source: 'membership' });
  });

  test('super admin with nothing managed gets the platform default', () => {
    const decision = decideTenantId({
      queryTenantId: null,
      cookieTenantId: null,
      managedIds: [],
      defaultId: DEFAULT_T,
      isSuperAdmin: true,
    });
    assert.deepEqual(decision, { tenantId: DEFAULT_T, source: 'super-admin-default' });
  });

  test('a plain user with nothing managed resolves to null', () => {
    const decision = decideTenantId({
      queryTenantId: null,
      cookieTenantId: null,
      managedIds: [],
      defaultId: DEFAULT_T,
      isSuperAdmin: false,
    });
    assert.equal(decision, null);
  });
});

describe('tenant-resolver — isolation guard', () => {
  test('?tenant= pointing at a foreign tenant is discarded for normal users', () => {
    const decision = decideTenantId({
      queryTenantId: TENANT_C, // not in managedIds
      cookieTenantId: null,
      managedIds: [TENANT_A],
      isSuperAdmin: false,
    });
    assert.deepEqual(decision, { tenantId: TENANT_A, source: 'membership' });
  });

  test('a forged/stale cookie pointing at a foreign tenant is discarded', () => {
    const decision = decideTenantId({
      queryTenantId: null,
      cookieTenantId: TENANT_C,
      managedIds: [TENANT_A, TENANT_B],
      isSuperAdmin: false,
    });
    assert.deepEqual(decision, { tenantId: TENANT_A, source: 'membership' });
  });

  test('junk ?tenant= values never resolve', () => {
    const decision = decideTenantId({
      queryTenantId: "1' OR '1'='1",
      cookieTenantId: '<script>',
      managedIds: [TENANT_A],
      isSuperAdmin: false,
    });
    assert.deepEqual(decision, { tenantId: TENANT_A, source: 'membership' });
  });

  test('a foreign ?tenant= with NO managed tenants resolves to null, not a leak', () => {
    const decision = decideTenantId({
      queryTenantId: TENANT_C,
      cookieTenantId: null,
      managedIds: [],
      isSuperAdmin: false,
    });
    assert.equal(decision, null);
  });

  test('super admins MAY explicitly select a foreign tenant (?tenant=)', () => {
    const decision = decideTenantId({
      queryTenantId: TENANT_C,
      cookieTenantId: null,
      managedIds: [TENANT_A],
      isSuperAdmin: true,
    });
    assert.deepEqual(decision, { tenantId: TENANT_C, source: 'query' });
  });

  test('super admins MAY keep a foreign tenant via cookie', () => {
    const decision = decideTenantId({
      queryTenantId: null,
      cookieTenantId: TENANT_C,
      managedIds: [TENANT_A],
      isSuperAdmin: true,
    });
    assert.deepEqual(decision, { tenantId: TENANT_C, source: 'cookie' });
  });

  test('non-uuid cookie values are ignored even for super admins', () => {
    const decision = decideTenantId({
      queryTenantId: null,
      cookieTenantId: 'garbage',
      managedIds: [],
      defaultId: DEFAULT_T,
      isSuperAdmin: true,
    });
    assert.deepEqual(decision, { tenantId: DEFAULT_T, source: 'super-admin-default' });
  });
});
