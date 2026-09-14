import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const libRoot = fileURLToPath(new URL('../apps/main/lib/', import.meta.url));

async function collectTestFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTestFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(resolve(path));
    }
  }
  return files;
}

const files = (await collectTestFiles(libRoot)).sort();

if (files.length === 0) {
  console.error(`No main unit tests found under ${relative(process.cwd(), libRoot)}`);
  process.exit(1);
}

console.log(`Running ${files.length} main unit test files with the repository's existing TypeScript ESM loader`);

const child = spawn(process.execPath, ['--loader', '@esbuild-kit/esm-loader', '--test', ...files], {
  cwd: process.cwd(),
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Failed to start Node test runner: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Node test runner terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
