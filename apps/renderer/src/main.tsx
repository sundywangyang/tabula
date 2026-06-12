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

  // 调试:在 console 输入 __dumpChain() 打印 .details-view / .list-view 父链高度
  (window as any).__dumpChain = (selector: string = '.details-view') => {
    const el = document.querySelector(selector);
    if (!el) return `no ${selector}`;
    const out: string[] = [];
    let n: Element | null = el;
    let i = 0;
    while (n && i < 10) {
      const cs = getComputedStyle(n as HTMLElement);
      out.push(
        `${(n as HTMLElement).className.toString().slice(0, 60)} | h=${(n as HTMLElement).clientHeight} | flex=${cs.flex} | minH=${cs.minHeight} | ovY=${cs.overflowY} | dir=${cs.flexDirection}`,
      );
      n = n.parentElement;
      i++;
    }
    return out.join('\n');
  };
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[renderer] mount failed:', err);
  throw err;
}
