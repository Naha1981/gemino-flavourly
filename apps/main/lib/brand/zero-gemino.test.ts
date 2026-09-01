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
  '(marketing)/page.tsx',
  '(marketing)/landing-client.tsx',
  '(marketing)/pricing/page.tsx',
  '(marketing)/privacy/page.tsx',
  '(marketing)/terms/page.tsx',
  '(app)/onboarding/page.tsx',
  '(app)/sign-in/[[...sign-in]]/page.tsx',
  '(app)/sign-up/[[...sign-up]]/page.tsx',
];

describe('zero-gemino public brand wiring', () => {
  test('no public page mentions Gemino', () => {
    for (const file of PUBLIC_PAGES) {
      const src = readFileSync(join(APP, file), 'utf8');
      assert.doesNotMatch(src, /Gemino/i, `${file} must not mention the old Gemino brand`);
    }
  });

  test('public pages carry the Flavourly brand and premium copy', () => {
    const landing = readFileSync(join(APP, '(marketing)', 'landing-client.tsx'), 'utf8');
    assert.match(landing, /Flavourly/);
    // GATE UI-5B — owner-approved simple-English copy.
    assert.match(landing, /Full tables\. Even on Tuesdays\./);
    assert.match(landing, /No other tool does all this\. And proves it\./);
    assert.match(landing, /Questions, answered\./);

    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    assert.match(layout, /Flavourly — The AI WhatsApp Employee/);
  });

  test('landing shows no fabricated live metrics (UI-5 honesty rule)', () => {
    // The old strip presented invented "Flavourly HQ / Live overview"
    // numbers as if they were live platform data. That framing is banned;
    // illustrative numbers must be labelled "Example".
    const landing = readFileSync(join(APP, '(marketing)', 'landing-client.tsx'), 'utf8');
    assert.doesNotMatch(landing, /Flavourly HQ/);
    assert.doesNotMatch(landing, /Live overview/i);
    assert.match(landing, /Example numbers — your dashboard shows your real Rands/);
  });
});
