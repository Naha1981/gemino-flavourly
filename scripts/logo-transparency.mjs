#!/usr/bin/env node
/**
 * One-off brand asset script: strip the baked-in light-grey background from
 * the Flavourly logo and trim the transparent canvas.
 *
 * The logo shipped in PR #32 (apps/main/public/logo.png) is an opaque RGB
 * image: the actual Flavourly mark (dark green + gold, roughly 340x253 in the
 * centre of an 807x450 canvas) sits on a white-to-light-grey gradient
 * background. On dark surfaces that grey box shows up as a white/grey slab
 * behind the header logo.
 *
 * This script builds an alpha channel from pixel luminance and applies it:
 *   - luminance <= 210  -> fully opaque (logo content + anti-aliased cores)
 *   - luminance >= 225  -> fully transparent (background gradient)
 *   - 210..225          -> linear ramp (soft edge)
 * then trims the surrounding transparent margin and repages the image.
 *
 * Run from the repo root:  node scripts/logo-transparency.mjs
 * Idempotent: running it again on an already-transparent image is a no-op-ish
 * (the alpha channel is preserved and re-derived from the same luminance).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const LOGO = join(REPO, 'apps', 'main', 'public', 'logo.png');
const MIRROR = join(REPO, 'public', 'Flavourly-Final-logo.png');

// Luminance thresholds (0..1, /255):
//   210/255 = 0.8235  -> fully opaque below this
//   225/255 = 0.8824  -> fully transparent at/above this
const OPAQUE_MAX = (210 / 255).toFixed(4);
const TRANSPARENT_MIN = (225 / 255).toFixed(4);

function convert(...args) {
  execFileSync('convert', args, { stdio: 'inherit' });
}

function main() {
  for (const file of [LOGO, MIRROR]) {
    if (!existsSync(file)) {
      console.error(`skipping missing ${file}`);
      continue;
    }
    const size = statSync(file).size;
    console.log(`processing ${file} (${size} bytes)`);

    const work = join(REPO, '.brand-work');
    convert(`${file}[0]`, '-colorspace', 'Gray', '-depth', '8', `${work}-gray.png`);
    convert(
      `${work}-gray.png`,
      '-fx',
      `(u<=${OPAQUE_MAX})?1:((u>=${TRANSPARENT_MIN})?0:(${TRANSPARENT_MIN}-u)/${(TRANSPARENT_MIN - OPAQUE_MAX).toFixed(4)})`,
      `${work}-alpha.png`,
    );
    // Slight blur on the alpha channel so anti-aliased edges stay soft.
    convert(`${work}-alpha.png`, '-blur', '0x1.2', `${work}-alpha-blur.png`);
    convert(`${file}[0]`, `${work}-alpha-blur.png`, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', `${work}-rgba.png`);
    // Clamp sub-15% alpha pixels to fully transparent so the grey gradient's
    // faint film cannot survive as a halo, then trim the transparent margin.
    convert(`${work}-rgba.png`, '-channel', 'A', '-fx', 'u<0.15?0:u', '+channel', '-bordercolor', 'none', '-border', '1', '-trim', '+repage', `${file}`);

    execFileSync('rm', ['-f', `${work}-gray.png`, `${work}-alpha.png`, `${work}-alpha-blur.png`, `${work}-rgba.png`], { stdio: 'inherit' });
    console.log(`  -> wrote ${file} (${statSync(file).size} bytes)`);
  }
  console.log('done.');
}

main();
