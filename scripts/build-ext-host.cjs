// Post-build step for ext-host-bootstrap.mjs
// - Transpile TypeScript syntax to plain ESM JS (mjs can't be parsed by Node if it contains `import type`, `interface`, etc.)
// - Copy the transpiled file to out/main/ext-host/

const path = require('node:path');
const fs = require('node:fs');

// pnpm 模块隔离: esbuild 装在 .pnpm/ 下,直接 require 不到,用绝对路径
const pnpmDir = path.join(__dirname, '..', 'node_modules', '.pnpm');
const esbuildMatches = fs
  .readdirSync(pnpmDir)
  .filter((d) => d.startsWith('esbuild@'));
if (esbuildMatches.length === 0) {
  throw new Error('esbuild not found in .pnpm/');
}
const esbuildMain = require(path.join(
  pnpmDir,
  esbuildMatches[0],
  'node_modules',
  'esbuild',
  'package.json',
)).main;
const { buildSync } = require(path.join(
  pnpmDir,
  esbuildMatches[0],
  'node_modules',
  'esbuild',
  esbuildMain,
));

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'apps/main/src/main/ext-host/ext-host-bootstrap.mjs');
const dstDir = path.join(root, 'out/main/ext-host');
const dst = path.join(dstDir, 'ext-host-bootstrap.mjs');

fs.mkdirSync(dstDir, { recursive: true });

const result = buildSync({
  entryPoints: [src],
  bundle: false, // we want to keep the source structure (no inlining)
  format: 'esm',
  target: 'node20',
  platform: 'node',
  // 关键: 让 esbuild 把 .mjs 当作 TS 处理(剥掉 import type / interface / type X = ... 等)
  loader: { '.mjs': 'ts' },
  write: false,
  sourcemap: false,
});

if (result.outputFiles && result.outputFiles[0]) {
  fs.writeFileSync(dst, result.outputFiles[0].text);
  console.log(`[ext-host] transpiled + copied: ${src} -> ${dst} (${result.outputFiles[0].text.length} bytes)`);
} else {
  throw new Error('esbuild produced no output for ext-host-bootstrap.mjs');
}
