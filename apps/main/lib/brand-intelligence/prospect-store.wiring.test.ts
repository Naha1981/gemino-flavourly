import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STORE = join(HERE, 'prospect-store.ts');

function code(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('prospect-store — type import location', () => {
  test('ProspectStatus is imported from ./prospects, NOT from @/lib/db/schema', () => {
    // Node's --experimental type-stripping strips types without resolving them,
    // so a wrong type import silently passes the runtime suite but fails tsc /
    // next build ("No exported member 'ProspectStatus'"). This source guard
    // pins the correct home of the type.
    const src = code(STORE);
    assert.match(src, /import type \{ ProspectStatus \} from '\.\/prospects'/);
    assert.doesNotMatch(src, /ProspectStatus[^]*from '@\/lib\/db\/schema'/);
  });

  test('the prospects/tenantClaimTokens tables still come from the schema', () => {
    const src = code(STORE);
    assert.match(src, /import \{ prospects, tenantClaimTokens \} from '@\/lib\/db\/schema'/);
  });
});
