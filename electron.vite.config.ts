import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const workspaceRoot = resolve(__dirname);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@tabula/bridge', '@tabula/core', '@tabula/ext-api'] })],
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
