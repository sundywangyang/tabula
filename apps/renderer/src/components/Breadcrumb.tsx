/**
 * 面包屑导航
 * P3: 每个路径段作为拖放目标
 */
import { type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import './Breadcrumb.css';
import { useFileStore } from '../stores/file-store';
import type { BreadcrumbSegment } from '../stores/file-store';

export function Breadcrumb({
  segments,
  onNavigate,
  onOpenPicker,
}: {
  segments: BreadcrumbSegment[];
  onNavigate: (path: string) => void;
  onOpenPicker: () => void;
}) {
  const dragState = useFileStore((s) => s.dragState);
  const setDragTarget = useFileStore((s) => s.setDragTarget);
  const endDrag = useFileStore((s) => s.endDrag);
  const performBulk = useFileStore((s) => s.performBulk);

  const handleSegDragOver = (e: ReactDragEvent<HTMLButtonElement>, targetPath: string) => {
    if (!dragState) return;
    e.preventDefault();
    e.stopPropagation();
    const effect: 'move' | 'copy' = e.ctrlKey || e.metaKey ? 'copy' : 'move';
    e.dataTransfer.dropEffect = effect;
    setDragTarget(targetPath, 'breadcrumb', effect);
  };

  const handleSegDrop = async (e: ReactDragEvent<HTMLButtonElement>, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    const state = useFileStore.getState().dragState;
    if (!state) {
      endDrag();
      return;
    }
    const mode: 'copy' | 'move' = state.effect === 'copy' ? 'copy' : 'move';
    await performBulk(state.paths, targetPath, mode, state.sourcePaneId);
    endDrag();
  };

  // 双击 .breadcrumb-path 空白处 → 复制当前文件夹路径
  // e.target === e.currentTarget 避开 segment 按钮和 › 分隔符
  const handlePathDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const last = segments[segments.length - 1]?.path;
    if (!last) {
      useFileStore.getState().showToast('当前没有路径可复制', 'warn', 1800);
      return;
    }
    void navigator.clipboard
      ?.writeText(last)
      .then(() => {
        useFileStore.getState().showToast(`已复制: ${last}`, 'success', 1800);
      })
      .catch(() => {
        useFileStore.getState().showToast('复制失败 (剪贴板权限?)', 'error', 2000);
      });
  };

  return (
    <div className="breadcrumb">
      <button className="breadcrumb-picker" onClick={onOpenPicker} title="打开文件夹 (Ctrl+O)">
        📁
      </button>
      <div
        className="breadcrumb-path"
        onDoubleClick={handlePathDoubleClick}
        title="双击空白处复制当前路径"
      >
        {segments.length === 0 ? (
          <span className="breadcrumb-empty">未选择目录</span>
        ) : (
          segments.map((seg, i) => {
            const isOver =
              dragState &&
              dragState.targetKind === 'breadcrumb' &&
              dragState.targetPath === seg.path;
            return (
              <span key={seg.path} className="breadcrumb-segment-wrap">
                <button
                  className={`breadcrumb-segment ${isOver ? 'drag-over' : ''}`}
                  onClick={() => onNavigate(seg.path)}
                  onDragOver={(e) => handleSegDragOver(e, seg.path)}
                  onDragLeave={() =>
                    setDragTarget(null, null, dragState?.effect ?? 'move')
                  }
                  onDrop={(e) => void handleSegDrop(e, seg.path)}
                  title={seg.path}
                >
                  {seg.name}
                </button>
                {i < segments.length - 1 && <span className="breadcrumb-sep">›</span>}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}
