import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');

// Every page a visitor (or a search engine) can reach without signing in.
// The platform used to be branded "Gemino" everywhere; after the Flavourly
// rebrand these files must never mention the old name.
const PUBLIC_PAGES = [
  'layout.tsx',
  'page.tsx',
  'landing-client.tsx',
  'pricing/page.tsx',
  'privacy/page.tsx',
  'terms/page.tsx',
  'onboarding/page.tsx',
  'sign-in/[[...sign-in]]/page.tsx',
  'sign-up/[[...sign-up]]/page.tsx',
];

describe('zero-gemino public brand wiring', () => {
  test('no public page mentions Gemino', () => {
    for (const file of PUBLIC_PAGES) {
      const src = readFileSync(join(APP, file), 'utf8');
      assert.doesNotMatch(src, /Gemino/i, `${file} must not mention the old Gemino brand`);
    }
  });

  test('public pages carry the Flavourly brand and premium copy', () => {
    const landing = readFileSync(join(APP, 'landing-client.tsx'), 'utf8');
    assert.match(landing, /Flavourly/);
    assert.match(landing, /fully booked/);
    assert.match(landing, /Flavourly HQ/);
    assert.match(landing, /Questions, answered\./);

    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    assert.match(layout, /Flavourly — The AI WhatsApp Employee/);
  });
});
