/**
 * 扩展面板视图
 *
 * 监听 ext-host 通过 ext:panel-data 推送过来的 panel 数据,
 * 显示成浮层(覆盖在 .pane-content 上方)。
 *
 * P6 v1: 一个简单的浮层,只显示 payload 内容。
 * P6 v2: 多个 panel 并列/标签页切换。
 */
import { useEffect, useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { useFileStore } from '../stores/file-store';
import { useLayoutStore } from '../stores/layout-store';
import './ExtensionPanelView.css';

interface PanelData {
  panelId: string;
  extensionId: string;
  /** ext-host 通过 mainHost.panelData 推过来的实际数据,格式由 extension 自己定义 */
  payload: unknown;
  /** 时间戳(用于判断数据新鲜度) */
  receivedAt: number;
}

export function ExtensionPanelView() {
  const [panels, setPanels] = useState<Map<string, PanelData>>(new Map());

  useEffect(() => {
    const off = window.tabula.extensions.onPanelData((data) => {
      setPanels((prev) => {
        const next = new Map(prev);
        next.set(data.panelId, { ...data, receivedAt: Date.now() });
        return next;
      });
    });
    return off;
  }, []);

  if (panels.size === 0) return null;

  // 当前 P6 v1: 只渲染最新的一个 panel
  const last = Array.from(panels.values()).sort((a, b) => b.receivedAt - a.receivedAt)[0]!;

  const close = () => {
    setPanels((prev) => {
      const next = new Map(prev);
      next.delete(last.panelId);
      return next;
    });
  };

  const refresh = () => {
    // 重新触发同名命令
    const activePanePath = useActivePanePath();
    void window.tabula.extensions
      .invokeCommand(last.panelId, { panePath: activePanePath })
      .catch(() => {
        /* 主进程已经 log */
      });
  };

  return (
    <div className="ext-panel-overlay" role="dialog" aria-label="扩展面板">
      <div className="ext-panel-window">
        <div className="ext-panel-header">
          <span className="ext-panel-title">{last.extensionId}</span>
          <span className="ext-panel-subtitle">·  {last.panelId}</span>
          <div className="ext-panel-actions">
            <Tooltip label="刷新">
              <button className="ext-panel-btn" onClick={refresh} aria-label="刷新">
                <RefreshCw size={14} />
              </button>
            </Tooltip>
            <Tooltip label="关闭">
              <button className="ext-panel-btn" onClick={close} aria-label="关闭">
                <X size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="ext-panel-body">
          {renderPayload(last.payload)}
        </div>
      </div>
    </div>
  );
}

/** 拿当前 active pane 的 path */
function useActivePanePath(): string {
  return useFileStore.getState().panes[useLayoutStore.getState().activePaneId ?? '']?.currentPath ?? '';
}

function renderPayload(payload: unknown): React.ReactNode {
  if (payload === null || payload === undefined) {
    return <div className="ext-panel-empty">空数据</div>;
  }
  if (typeof payload === 'string') {
    return <div className="ext-panel-text">{payload}</div>;
  }
  if (typeof payload === 'object') {
    // 简单 key-value 展示
    const entries = Object.entries(payload as Record<string, unknown>);
    return (
      <div className="ext-panel-kv">
        {entries.map(([k, v]) => (
          <div key={k} className="ext-panel-kv-row">
            <span className="ext-panel-kv-key">{k}</span>
            <span className="ext-panel-kv-val">
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return <div className="ext-panel-text">{String(payload)}</div>;
}
