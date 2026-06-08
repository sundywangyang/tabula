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
    build: {
      outDir: resolve(workspaceRoot, 'out/renderer'),
      rollupOptions: {
        input: resolve(workspaceRoot, 'apps/renderer/index.html'),
      },
    },
  },
});
