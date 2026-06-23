import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

const workspaceRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Dev/build 共用: 在 main 进程的 bundle 完成后,跑一次 scripts/build-ext-host.cjs
 * 把 ext-host-bootstrap.mjs 转写到 out/main/ext-host/。
 * 把它做成 vite plugin 是因为 electron-vite 在 dev / build 都会清空 outDir,
 * 普通 pre-script 跑完后 vite 重建 bundle 会把刚写好的文件清掉,
 * 但 closeBundle 阶段 vite 已经写完,文件会保留。
 */
function transpileExtHost(): Plugin {
  return {
    name: 'tabula:transpile-ext-host',
    apply(_config, env) {
      return env.command === 'build' || env.command === 'serve';
    },
    closeBundle() {
      const script = resolve(workspaceRoot, 'scripts/build-ext-host.cjs');
      const r = spawnSync(process.execPath, [script], { stdio: 'inherit', cwd: workspaceRoot });
      if (r.status !== 0) {
        throw new Error('build-ext-host.cjs failed');
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [
      transpileExtHost(),
      externalizeDepsPlugin({ exclude: ['@tabula/bridge', '@tabula/core', '@tabula/ext-api'] }),
    ],
    resolve: {
      alias: {
        '@tabula/bridge': resolve(workspaceRoot, 'apps/bridge/src'),
        '@tabula/core': resolve(workspaceRoot, 'packages/core/src'),
        '@tabula/ext-api': resolve(workspaceRoot, 'packages/ext-api/src'),
      },
    },
    // PDF.js (pdfjs-dist) 用了顶层 await, electron-vite 当前的 target
    // (chrome87/es2020) 不支持顶层 await, 报错 "Top-level await is not available".
    // 排除 PDF.js 不进 main bundle (main 进程不直接 require 它, 只有 renderer
    // 用 dynamic import). 同时 optimizeDeps.exclude 避免 vite 预构建.
    ssr: {
      noExternal: [],
      external: ['pdfjs-dist'],
    },
    optimizeDeps: {
      exclude: ['pdfjs-dist'],
    },
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(workspaceRoot, 'apps/main/src/main/index.ts'),
      },
      rollupOptions: {
        // Prevent @tabula/* workspace packages from being externalized —
        // they are TypeScript source and must be bundled so esbuild processes them
        external: [],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@tabula/bridge'] })],
    resolve: {
      alias: {
        '@tabula/bridge': resolve(workspaceRoot, 'apps/bridge/src'),
      },
    },
    build: {
      outDir: 'out/preload',
      lib: {
        // P7: 多 entry,主入口 + splash preload
        entry: {
          index: resolve(workspaceRoot, 'apps/main/src/preload/index.ts'),
          'splash-preload': resolve(workspaceRoot, 'apps/main/src/main/infra/splash-preload.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(workspaceRoot, 'apps/renderer'),
    resolve: {
      alias: {
        '@tabula/bridge': resolve(workspaceRoot, 'apps/bridge/src'),
        '@tabula/core': resolve(workspaceRoot, 'packages/core/src'),
        '@tabula/ui': resolve(workspaceRoot, 'packages/ui/src'),
        '@tabula/ext-api': resolve(workspaceRoot, 'packages/ext-api/src'),
      },
    },
    plugins: [react()],
    // PDF.js (pdfjs-dist) 用了顶层 await, electron-vite 当前的 target
    // (chrome87/es2020) 不支持顶层 await, 报错 "Top-level await is not available".
    // exclude PDF.js 不进 renderer 预构建, dynamic import 时浏览器原生 ESM 直接加载.
    optimizeDeps: {
      exclude: ['pdfjs-dist'],
    },
    build: {
      outDir: resolve(workspaceRoot, 'out/renderer'),
      rollupOptions: {
        input: resolve(workspaceRoot, 'apps/renderer/index.html'),
      },
    },
  },
});
