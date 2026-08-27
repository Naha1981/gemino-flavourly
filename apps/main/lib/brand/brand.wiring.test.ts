import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
const PUBLIC = join(HERE, '..', '..', 'public');

const HEADER_FILES = [
  join(APP, 'landing-client.tsx'),
  join(APP, 'dashboard', 'layout.tsx'),
  join(APP, 'terms', 'page.tsx'),
  join(APP, 'privacy', 'page.tsx'),
  join(APP, 'pricing', 'page.tsx'),
];

const LAYOUT_FILE = join(APP, 'layout.tsx');
const MANIFEST_FILE = join(PUBLIC, 'manifest.json');

describe('brand asset wiring', () => {
  test('all headers render an <img> with /logo.png and no legacy G box', () => {
    for (const file of HEADER_FILES) {
      const src = readFileSync(file, 'utf8');
      // Stitch redesign: the dashboard header logo moved into the
      // DashboardChrome shell via the themed <LogoChip> (which defaults to
      // /logo.png and renders an <img>). Public pages keep the direct img.
      const isDashboardLayout = file.endsWith(join('dashboard', 'layout.tsx'));
      if (isDashboardLayout) {
        assert.match(src, /<DashboardChrome/, 'dashboard layout should render the DashboardChrome shell');
        const chrome = readFileSync(file.replace('layout.tsx', 'dashboard-chrome.tsx'), 'utf8');
        assert.match(chrome, /<LogoChip/, 'chrome should render the logo chip');
        const themeMode = readFileSync(join(file, '..', '..', '..', 'components', 'theme-mode.tsx'), 'utf8');
        assert.match(themeMode, /src\s*=\s*'\/logo\.png'/, 'LogoChip defaults to /logo.png');
        assert.match(themeMode, /<img\s+src=\{src\}/, 'LogoChip renders an <img>');
      } else {
        assert.match(src, /<img\s+[^>]*src="\/logo\.png"/, `${file} should render <img src="/logo.png">`);
      }
      assert.doesNotMatch(src, /<span[^>]*bg-zinc-100[^>]*>G<\/span>/, `${file} should not contain the legacy G box`);
    }
  });

  test('layout metadata wires logo-mark favicon, apple-touch-icon, manifest, and social images', () => {
    const src = readFileSync(LAYOUT_FILE, 'utf8');
    assert.match(src, /rel:\s*['"]icon['"],\s*url:\s*['"]\/icon\.svg['"]/);
    assert.match(src, /rel:\s*['"]apple-touch-icon['"],\s*url:\s*['"]\/logo-mark\.png['"]/);
    assert.match(src, /manifest:\s*['"]\/manifest\.json['"]/);
    assert.match(src, /openGraph:\s*\{[\s\S]*?images:\s*\[['"]\/logo\.png['"]/);
    assert.match(src, /twitter:\s*\{[\s\S]*?images:\s*\[['"]\/logo\.png['"]/);
  });

  test('manifest.json exists and declares the logo-mark icon', () => {
    assert.ok(existsSync(MANIFEST_FILE), 'public/manifest.json should exist');
    const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
    assert.deepEqual(manifest.icons, [
      {
        src: '/logo-mark.png',
        sizes: '512x512',
        type: 'image/png',
      },
      {
        src: '/logo.png',
        sizes: 'any',
        type: 'image/png',
      },
    ]);
  });
});
