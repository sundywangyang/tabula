/**
 * 布局树根渲染器
 *
 * P0: 单窗格 children 容器
 * P2: 递归渲染 LayoutNode 树(split / pane)
 *
 * 叶子节点 → <PaneView>
 * 分割节点 → 横向/纵向 flex 容器,中间夹 SplitHandle
 *
 * v1:分割条点击无效(占位),v2 接入拖动逻辑
 */
import { useCallback } from 'react';
import type { LayoutNode } from '@tabula/bridge';
import { PaneView } from './PaneView';
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

  // v1:点击切 50/50(noop,因为创建时已等分)
  const handleClick = useCallback(() => {
    // 留作 v2 接入拖动 / 双击重置
  }, []);

  const children: React.ReactNode[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const size = node.sizes[i] ?? (100 / node.children.length);
    const flexValue = `${size} 1 0`;
    children.push(
      <div
        key={child.type === 'pane' ? child.id : `split-${i}-${Math.random().toString(36).slice(2, 6)}`}
        className="layout-split-child"
        style={{ flex: flexValue, minWidth: 0, minHeight: 0, display: 'flex' }}
      >
        <LayoutView node={child} />
      </div>,
    );
    if (i < node.children.length - 1) {
      const dirClass = isHoriz ? 'split-handle-h' : 'split-handle-v';
      children.push(
        <div
          key={`handle-${i}`}
          className={`split-handle ${dirClass}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClick}
          title="拖动调整(v2 接入)"
          role="separator"
          aria-orientation={isHoriz ? 'vertical' : 'horizontal'}
        />,
      );
    }
  }

  return (
    <div
      className={`layout-split ${isHoriz ? 'layout-split-h' : 'layout-split-v'}`}
      data-dir={node.dir}
    >
      {children}
    </div>
  );
}
