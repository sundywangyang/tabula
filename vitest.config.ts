/**
 * Vitest 全局配置。
 *
 * 覆盖:
 * - apps/renderer 测试 (jsdom 环境,涉及 window.tabula IPC mock)
 * - packages 子包纯逻辑单测
 * - apps/main/archive + providers/archive 测试 (Node 环境,纯逻辑 + fs)
 *
 * 不覆盖:
 * - apps/main 中需要 electron 主进程 runtime 的代码 (browserWindow / ipc 等)
 * - apps/renderer 中需要 React DOM 的组件测试 (此轮不装 RTL)
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
 'apps/main/src/main/archive/**/*.test.ts',
 'apps/main/src/main/providers/**/*.test.ts',
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
