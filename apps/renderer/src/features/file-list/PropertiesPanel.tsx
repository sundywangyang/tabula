/**
 * 属性详情面板 (P3)
 *
 * 侧边弹出面板，显示文件/文件夹的完整属性。
 * 从右侧滑入，宽度 320px。
 */
import { useEffect, useRef, useState } from 'react';
import type { FsEntry } from '@tabula/bridge';
import './PropertiesPanel.css';

export interface PropertiesPanelProps {
  paneId: string;
  entry: FsEntry;
  onClose: () => void;
}

interface DirSizeInfo {
  size: number;
  fileCount: number;
  dirCount: number;
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 2 : 0)} ${units[i]}`;
}

/** 格式化时间戳 */
function formatTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 获取文件类型描述 */
function getTypeLabel(entry: FsEntry): string {
  if (entry.isDirectory) return '文件夹';
  if (entry.isSymlink) return '快捷方式';
  if (entry.ext) return `${entry.ext.slice(1).toUpperCase()} 文件`;
  return '文件';
}

export function PropertiesPanel({ paneId, entry, onClose }: PropertiesPanelProps) {
  const [dirSize, setDirSize] = useState<DirSizeInfo | null>(null);
  const [calculating, setCalculating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 聚焦面板
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const handleCalcSize = async () => {
    if (!entry.isDirectory || calculating) return;
    setCalculating(true);
    try {
      const res = await window.tabula.fs.getDirSize(entry.path);
      if (res.ok) {
        setDirSize({
          size: res.data.size,
          fileCount: res.data.fileCount,
          dirCount: res.data.dirCount,
        });
      }
    } finally {
      setCalculating(false);
    }
  };

  const handleOpenInExplorer = () => {
    void window.tabula.fs.openPath(entry.path);
  };

  const icon = entry.isDirectory ? '📁' : entry.isSymlink ? '🔗' : '📄';

  return (
    <div
      className="properties-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="properties-panel"
        ref={panelRef}
        tabIndex={-1}
        role="complementary"
        aria-label="属性详情"
      >
        {/* Header */}
        <div className="properties-header">
          <span className="properties-icon">{icon}</span>
          <span className="properties-name" title={entry.name}>
            {entry.name}
          </span>
          <button className="properties-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* Type badge */}
        <div className="properties-type-row">
          <span className="properties-type-badge">{getTypeLabel(entry)}</span>
        </div>

        {/* Info list */}
        <div className="properties-info">
          <div className="properties-row">
            <span className="properties-label">路径</span>
            <span className="properties-value properties-value-path" title={entry.path}>
              {entry.path}
            </span>
          </div>

          {entry.isDirectory ? (
            <>
              <div className="properties-row">
                <span className="properties-label">大小</span>
                <span className="properties-value">
                  {dirSize ? (
                    formatSize(dirSize.size)
                  ) : (
                    <span className="properties-size-pending">(未计算)</span>
                  )}
                  {' '}
                  {calculating ? (
                    <span className="properties-calc-loading">计算中…</span>
                  ) : (
                    <button
                      className="properties-calc-btn"
                      onClick={handleCalcSize}
                      disabled={calculating}
                    >
                      计算
                    </button>
                  )}
                </span>
              </div>
              {dirSize && (
                <>
                  <div className="properties-row properties-row-sub">
                    <span className="properties-label">子文件数</span>
                    <span className="properties-value">{dirSize.fileCount} 个文件</span>
                  </div>
                  <div className="properties-row properties-row-sub">
                    <span className="properties-label">子目录数</span>
                    <span className="properties-value">{dirSize.dirCount} 个文件夹</span>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="properties-row">
              <span className="properties-label">大小</span>
              <span className="properties-value">{formatSize(entry.size)}</span>
            </div>
          )}

          <div className="properties-row">
            <span className="properties-label">创建时间</span>
            <span className="properties-value">{formatTime(entry.birthtime)}</span>
          </div>

          <div className="properties-row">
            <span className="properties-label">修改时间</span>
            <span className="properties-value">{formatTime(entry.mtime)}</span>
          </div>

          <div className="properties-row">
            <span className="properties-label">访问时间</span>
            <span className="properties-value">{formatTime(entry.atime)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="properties-actions">
          <button className="properties-action-btn" onClick={handleOpenInExplorer}>
            在文件资源管理器中打开
          </button>
          <button className="properties-action-btn properties-action-btn-secondary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}