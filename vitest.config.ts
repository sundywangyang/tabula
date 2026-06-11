/**
 * Vitest 全局配置。
 *
 * 只匹配 renderer store 单测与未来 packages 子包的纯逻辑单测。
 *走 jsdom 环境,因为 keymap-store / favorites-store / settings-store /
 * theme-store 的 hydrate路径都会触碰 window.tabula IPC mock
 * 以及 document.documentElement 的 data-theme / --accent CSS变量。
 *
 * 不覆盖:
 * - apps/main/**(主进程 Node 代码,有专门 unit/integration 测试策略)
 * - apps/renderer 中需要 React DOM 的组件测试(此轮不装 RTL)
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
 test: {
 environment: 'jsdom',
 globals: false,
 include: [
 'apps/renderer/src/**/*.test.ts',
 'apps/renderer/src/**/*.test.tsx',
 'packages/*/src/**/*.test.ts',
 'packages/*/src/**/*.test.tsx',
 ],
 //排除 build artifacts、release目录、out/ 与 electron-vite 中间产物
 exclude: [
 '**/node_modules/**',
 '**/dist/**',
 '**/out/**',
 '**/release/**',
 ],
 //串行跑 store 测试,避免 zustand 单例在并行 worker 间残留状态
 pool: 'threads',
 reporters: ['default'],
 },
 resolve: {
 alias: {
 // 与 tsconfig.base.json 的 paths保持一致,让单测能直接 import @tabula/bridge
 '@tabula/bridge': new URL('./apps/bridge/src', import.meta.url).pathname,
 '@tabula/bridge/': new URL('./apps/bridge/src/', import.meta.url).pathname,
 '@tabula/core': new URL('./packages/core/src', import.meta.url).pathname,
 '@tabula/core/': new URL('./packages/core/src/', import.meta.url).pathname,
 '@tabula/ui': new URL('./packages/ui/src', import.meta.url).pathname,
 '@tabula/ui/': new URL('./packages/ui/src/', import.meta.url).pathname,
 '@tabula/ext-api': new URL('./packages/ext-api/src', import.meta.url).pathname,
 '@tabula/ext-api/': new URL('./packages/ext-api/src/', import.meta.url).pathname,
 },
 },
});
