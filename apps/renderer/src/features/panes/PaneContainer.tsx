/**
 * 布局树根渲染器
 *
 * P0: 单窗格 children 容器
 * P2: 递归渲染 LayoutNode 树(split / pane)
 *
 * 叶子节点 → <PaneView>
 * 分割节点 → 横向/纵向 flex 容器,中间夹 SplitHandle
 *
 * P2 v2: SplitHandle 接 mousedown + document mousemove/mouseup,实时
 * 通过 setSplitSizes(splitNodeId, delta, totalPx) 调整相邻 child 的 flex 比例。
 */
import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { LayoutNode } from '@tabula/bridge';
import { PaneView } from './PaneView';
import { useLayoutStore } from '../../stores/layout-store';
import './LayoutView.css';

export function LayoutView({ node }: { node: LayoutNode }) {
  if (node.type === 'pane') {
    return <PaneView paneId={node.id} pane={node} />;
  }
  return <SplitView node={node} />;
}

function SplitView({ node }: { node: LayoutNode }) {
  if (node.type !== 'split') return null;
  const isHoriz = node.dir === 'horizontal';
  const containerRef = useRef<HTMLDivElement>(null);
  const setSplitSizes = useLayoutStore((s) => s.pane.setSplitSizes);

  const children: React.ReactNode[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const size = node.sizes[i] ?? (100 / node.children.length);
    const flexValue = `${size} 1 0`;
    // key 必须是稳定的:split child 用其 node.id,pane 用其 id。
    // 之前用 Math.random() 会导致每次 re-render 子树被卸载重建,
    // 既破坏 PaneView 内部状态,也会引发 TabBar/Toolbar 视觉闪烁。
    const childKey =
      child.type === 'pane'
        ? `pane-${child.id}`
        : `split-${child.id ?? `orphan-${i}`}`;
    children.push(
      <div
        key={childKey}
        className="layout-split-child"
        style={{ flex: flexValue, minWidth: 0, minHeight: 0, display: 'flex' }}
      >
        <LayoutView node={child} />
      </div>,
    );
    if (i < node.children.length - 1) {
      children.push(
        <SplitHandle
          key={`handle-${node.id ?? 'split'}-${i}`}
          isHoriz={isHoriz}
          splitNodeId={node.id ?? ''}
          containerRef={containerRef}
          onResize={(delta, totalPx) => setSplitSizes(node.id ?? '', delta, totalPx)}
        />,
      );
    }
  }

  return (
    <div
      ref={containerRef}
      className={`layout-split ${isHoriz ? 'layout-split-h' : 'layout-split-v'}`}
      data-dir={node.dir}
      data-split-id={node.id ?? ''}
    >
      {children}
    </div>
  );
}

/**
 * SplitHandle: split 节点中间的可拖动分隔条。
 * mousedown 记录起始坐标,document 上挂 mousemove + mouseup 实时调 onResize。
 * 这样即使鼠标移出 handle 元素也能继续拖。
 */
function SplitHandle({
  isHoriz,
  splitNodeId,
  containerRef,
  onResize,
}: {
  isHoriz: boolean;
  splitNodeId: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onResize: (delta: number, totalPx: number) => void;
}) {
  const draggingRef = useRef<{ start: number } | null>(null);
  // 性能:拖动时我们其实可以让 React 跳过非必要更新,这里先简单实现(每个 mousemove 都 setState)

  const onMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!splitNodeId) return;
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = { start: isHoriz ? e.clientX : e.clientY };

      // 拖动期间禁止文本选择
      const prevSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      // 改变全局 cursor
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = isHoriz ? 'col-resize' : 'row-resize';

      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        const cur = isHoriz ? ev.clientX : ev.clientY;
        const delta = cur - draggingRef.current.start;
        draggingRef.current.start = cur;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const totalPx = isHoriz ? rect.width : rect.height;
        onResize(delta, totalPx);
      };
      const onUp = () => {
        draggingRef.current = null;
        document.body.style.userSelect = prevSelect;
        document.body.style.cursor = prevCursor;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [isHoriz, splitNodeId, containerRef, onResize],
  );

  // 双击 = 重置当前 split 节点 sizes 为 [50, 50, ...](P2 v2 收口)
  const onDoubleClick = useCallback(() => {
    if (!splitNodeId) return;
    useLayoutStore.getState().pane.resetSplitSizes(splitNodeId);
  }, [splitNodeId]);

  // 组件卸载兜底(防止 hot-reload 后遗留 listener)
  useEffect(() => {
    return () => {
      draggingRef.current = null;
    };
  }, []);

  return (
    <div
      className={`split-handle ${isHoriz ? 'split-handle-h' : 'split-handle-v'}`}
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      title="拖动调整窗格大小"
      role="separator"
      aria-orientation={isHoriz ? 'vertical' : 'horizontal'}
    />
  );
}
