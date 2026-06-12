import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
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

try {
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

  // 调试:检查 tab chip 的 draggable 属性
  (window as any).__tabCheck = () => {
    const chips = Array.from(document.querySelectorAll('.tab-chip'));
    return chips.map((el) => {
      const tab = el as HTMLElement;
      return {
        title: tab.title,
        draggable: tab.draggable,
        className: tab.className.toString().slice(0, 80),
      };
    });
  };
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[renderer] mount failed:', err);
  throw err;
}
