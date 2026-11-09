import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { useThemeStore } from './stores/theme-store';
import { initPlatformCache } from './platform-cache';
import './styles/global.css';

// 把任何渲染端错误写到 stderr(打包后方便诊断黑屏)
window.addEventListener('error', (e) => {
  // eslint-disable-next-line no-console
  console.error('[renderer] uncaught:', e.error?.stack ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  // eslint-disable-next-line no-console
  console.error('[renderer] unhandled rejection:', e.reason?.stack ?? String(e.reason));
});

// 通过 IPC 强制写一条 log(绕过 console-message 可能的问题)
if (typeof window !== 'undefined' && (window as any).tabula?.log?.write) {
  (window as any).tabula.log.write('info', 'renderer script starting');
}

// eslint-disable-next-line no-console
console.error('[renderer] script executing, root:', document.getElementById('root')?.tagName ?? 'MISSING');

async function mount(): Promise<void> {
  // 在任何 React 内容显示前应用保存的主题和重点色。
  await Promise.all([useThemeStore.getState().hydrate(), initPlatformCache()]);
  const rootEl = document.getElementById('root');
  if (!rootEl) throw new Error('root element not found');
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  // eslint-disable-next-line no-console
  console.error('[renderer] mounted OK');
  if (typeof (window as any).tabula?.log?.write === 'function') {
    (window as any).tabula.log.write('info', 'renderer mounted OK');
  }
}

void mount().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[renderer] mount failed:', err);
  throw err;
});
