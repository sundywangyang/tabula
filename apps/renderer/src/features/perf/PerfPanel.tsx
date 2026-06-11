/**
 * 性能面板 (P7 v1)
 *
 * 一个轻量 overlay,展示:
 * - 启动阶段计时(whenReady → window ready → extHost ready → first paint)
 * - 当前 FPS
 * - 主进程最新一条内存采样
 * - 渲染端 JS heap
 * - IPC 调用计数 top 10
 *
 * 通过 Ctrl+Alt+P 打开/关闭(冲突说明:全局搜索用 Ctrl+P,命令面板用 Ctrl+Shift+P,
 * 本面板用 Ctrl+Alt+P 避免与上述两者冲突)
 */
import { useEffect, useState } from 'react';
import { usePerfStore } from '../../stores/perf-store';
import { startFpsSampling, getFps } from '../../perf/perf-client';
import './PerfPanel.css';

export function PerfPanel() {
  const open = usePerfStore((s) => s.panelOpen);
  const closePanel = usePerfStore((s) => s.closePanel);
  const fps = usePerfStore((s) => s.fps);
  const lastMemory = usePerfStore((s) => s.lastMemory);
  const rendererHeapMb = usePerfStore((s) => s.rendererHeapMb);
  const startupTimings = usePerfStore((s) => s.startupTimings);
  const lastReport = usePerfStore((s) => s.lastReport);
  const refreshRendererHeap = usePerfStore((s) => s.refreshRendererHeap);

  const [refreshNonce, setRefreshNonce] = useState(0);

  // FPS 采样启动
  useEffect(() => {
    const stop = startFpsSampling();
    const id = setInterval(() => {
      usePerfStore.getState().setFps(getFps());
    }, 500);
    return () => {
      stop();
      clearInterval(id);
    };
  }, []);

  // 客户端 heap 采样
  useEffect(() => {
    refreshRendererHeap();
    const id = setInterval(refreshRendererHeap, 2000);
    return () => clearInterval(id);
  }, [refreshRendererHeap]);

  // 拉取最新 report
  useEffect(() => {
    if (!open) return;
    void window.tabula.perf.snapshot().then(usePerfStore.getState().setReport).catch(() => undefined);
  }, [open, refreshNonce]);

  // 全局快捷键:Ctrl+Alt+P(让出 Ctrl+Shift+P 给命令面板,
  // 避免与 Ctrl+P 全局搜索冲突)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;
      if (isMeta && e.altKey && !e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (usePerfStore.getState().panelOpen) {
          usePerfStore.getState().closePanel();
        } else {
          usePerfStore.getState().openPanel();
        }
        return;
      }
      // Esc 关闭
      if (e.key === 'Escape' && usePerfStore.getState().panelOpen) {
        e.preventDefault();
        usePerfStore.getState().closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;

  const ipcTop = lastReport
    ? Object.entries(lastReport.ipcCallCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
    : [];

  return (
    <div className="perf-panel-overlay" role="dialog" aria-label="性能面板">
      <div className="perf-panel">
        <div className="perf-panel-header">
          <h2>性能面板</h2>
          <div className="perf-panel-actions">
            <button
              type="button"
              className="perf-btn"
              onClick={() => setRefreshNonce((n) => n + 1)}
              title="刷新"
            >
              ↻
            </button>
            <button
              type="button"
              className="perf-btn"
              onClick={closePanel}
              title="关闭 (Esc)"
            >
              ×
            </button>
          </div>
        </div>

        <div className="perf-panel-body">
          {/* 启动计时 */}
          <section className="perf-section">
            <h3>启动计时 (ms)</h3>
            <div className="perf-grid">
              <div className="perf-cell">
                <div className="perf-cell-label">whenReady</div>
                <div className="perf-cell-value">{startupTimings?.whenReadyMs ?? '—'}</div>
              </div>
              <div className="perf-cell">
                <div className="perf-cell-label">windowReady</div>
                <div className="perf-cell-value">{startupTimings?.windowReadyMs ?? '—'}</div>
              </div>
              <div className="perf-cell">
                <div className="perf-cell-label">extHostReady</div>
                <div className="perf-cell-value">{startupTimings?.extHostReadyMs ?? '—'}</div>
              </div>
              <div className="perf-cell">
                <div className="perf-cell-label">firstPaint</div>
                <div className="perf-cell-value">{startupTimings?.firstPaintMs ?? '—'}</div>
              </div>
              <div className="perf-cell perf-cell-strong">
                <div className="perf-cell-label">total</div>
                <div className="perf-cell-value">{startupTimings?.totalMs ?? '—'}</div>
              </div>
            </div>
          </section>

          {/* 实时指标 */}
          <section className="perf-section">
            <h3>实时</h3>
            <div className="perf-grid">
              <div className="perf-cell">
                <div className="perf-cell-label">FPS</div>
                <div className="perf-cell-value">{fps}</div>
              </div>
              <div className="perf-cell">
                <div className="perf-cell-label">Renderer Heap</div>
                <div className="perf-cell-value">{rendererHeapMb.toFixed(1)} MB</div>
              </div>
              <div className="perf-cell">
                <div className="perf-cell-label">Main RSS</div>
                <div className="perf-cell-value">
                  {lastMemory ? `${lastMemory.mainRss.toFixed(1)} MB` : '—'}
                </div>
              </div>
              <div className="perf-cell">
                <div className="perf-cell-label">Main Heap</div>
                <div className="perf-cell-value">
                  {lastMemory ? `${lastMemory.mainHeapUsed.toFixed(1)} MB` : '—'}
                </div>
              </div>
            </div>
          </section>

          {/* IPC 计数 */}
          <section className="perf-section">
            <h3>IPC 调用计数 (top 10)</h3>
            {ipcTop.length === 0 ? (
              <div className="perf-empty">无数据</div>
            ) : (
              <table className="perf-table">
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {ipcTop.map(([channel, count]) => (
                    <tr key={channel}>
                      <td className="perf-cell-name">{channel}</td>
                      <td>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* 最近事件 */}
          <section className="perf-section">
            <h3>最近事件 (last 30)</h3>
            {lastReport && lastReport.events.length > 0 ? (
              <table className="perf-table">
                <thead>
                  <tr>
                    <th>Phase</th>
                    <th>Name</th>
                    <th>ms</th>
                  </tr>
                </thead>
                <tbody>
                  {lastReport.events.slice(-30).reverse().map((e, i) => (
                    <tr key={`${e.ts}-${i}`}>
                      <td>{e.phase}</td>
                      <td className="perf-cell-name">{e.name}</td>
                      <td>{e.durationMs ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="perf-empty">无事件</div>
            )}
          </section>

          <div className="perf-hint">
            快捷键:Ctrl+Alt+P 打开 / 关闭
          </div>
        </div>
      </div>
    </div>
  );
}
