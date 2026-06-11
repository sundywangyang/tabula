/**
 * 路径栏 (Ctrl+L)
 *
 * 弹出一个输入框,Enter 跳转,Tab 补全,Esc 关闭。
 * 聚焦时显示历史记录下拉(最多30条)。
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { useFileStore } from '../stores/file-store';
import { useLayoutStore } from '../stores/layout-store';
import type { Tab, LayoutNode } from '@tabula/bridge';
import './PathBar.css';

// 下拉历史最大条目数
const MAX_DROPDOWN_ITEMS = 30;

/** 从 Tab 获取历史（去重，过滤 null/undefined） */
function getTabHistory(tab: Tab): string[] {
  return (tab.history ?? []).filter((p): p is string => Boolean(p));
}

/** 在布局树中查找 pane 节点 */
function findPaneNode(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.type === 'pane') {
    return node.id === paneId ? node : null;
  }
  for (const child of node.children) {
    const hit = findPaneNode(child, paneId);
    if (hit) return hit;
  }
  return null;
}

export function PathBar() {
  const open = useFileStore((s) => s.pathBarOpen);
  const value = useFileStore((s) => s.pathBarValue);
  const error = useFileStore((s) => s.pathBarError);
  const completions = useFileStore((s) => s.pathBarCompletions);
  const targetPaneId = useFileStore((s) => s.pathBarTargetPaneId);
  const setValue = useFileStore((s) => s.setPathBarValue);
  const submit = useFileStore((s) => s.submitPathBar);
  const close = useFileStore((s) => s.closePathBar);
  const complete = useFileStore((s) => s.completePathBar);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  // 获取当前 pane 的 active tab 历史
  const history = useMemo(() => {
    if (!targetPaneId) return [];
    const root = useLayoutStore.getState().rootLayout;
    const paneNode = findPaneNode(root, targetPaneId);
    if (!paneNode || paneNode.type !== 'pane' || !paneNode.activeTabId) return [];
    const tab = paneNode.tabs.find((t) => t.id === paneNode.activeTabId);
    return tab ? getTabHistory(tab) : [];
  }, [targetPaneId]);

  // 去重后的历史（最新的30条）
  const uniqueHistory = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const path of history) {
      if (!seen.has(path)) {
        seen.add(path);
        result.push(path);
      }
      if (result.length >= MAX_DROPDOWN_ITEMS) break;
    }
    return result;
  }, [history]);

  useEffect(() => {
    if (open) {
      // 下一帧 focus,确保 React 渲染完成
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
      setShowHistory(false);
      setHighlightedIndex(-1);
    }
  }, [open]);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!showHistory) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showHistory]);

  const handleInputFocus = () => {
    if (uniqueHistory.length > 0) {
      setShowHistory(true);
    }
  };

  const handleInputClick = () => {
    if (uniqueHistory.length > 0) {
      setShowHistory(true);
    }
  };

  const handleHistorySelect = (path: string) => {
    setShowHistory(false);
    setValue(path);
    void submit();
  };

  const handleClearHistory = () => {
    // 清空当前 tab 的历史（保留当前路径）
    if (!targetPaneId) return;
    const root = useLayoutStore.getState().rootLayout;
    const paneNode = findPaneNode(root, targetPaneId);
    if (!paneNode || paneNode.type !== 'pane' || !paneNode.activeTabId) return;
    const tab = paneNode.tabs.find((t) => t.id === paneNode.activeTabId);
    if (!tab) return;

    // 保留当前路径，清空其余历史
    const currentPath = tab.path ?? '';
    const newHistory = [currentPath];
    const newHistoryIndex = 0;

    // 直接操作 layout store
    const { rootLayout, activePaneId: _activeId } = useLayoutStore.getState();
    const newRoot = mapPaneNode(rootLayout, targetPaneId, (p) => {
      const idx = p.tabs.findIndex((t) => t.id === paneNode.activeTabId);
      if (idx < 0) return p;
      const newTabs = [...p.tabs];
      newTabs[idx] = { ...tab, history: newHistory, historyIndex: newHistoryIndex };
      return { ...p, tabs: newTabs };
    });
    useLayoutStore.setState({ rootLayout: newRoot });

    setShowHistory(false);
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();

    if (showHistory && uniqueHistory.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, uniqueHistory.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Enter' && highlightedIndex >= 0) {
        e.preventDefault();
        handleHistorySelect(uniqueHistory[highlightedIndex]!);
        return;
      }
      if (e.key === 'Escape') {
        setShowHistory(false);
        setHighlightedIndex(-1);
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      setShowHistory(false);
      await submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowHistory(false);
      close();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    }
  };

  if (!open) return null;

  return (
    <div className="path-bar-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="path-bar">
        <span className="path-bar-prefix">📍</span>
        <div className="path-bar-input-wrapper" ref={dropdownRef}>
          <input
            ref={inputRef}
            className="path-bar-input"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setShowHistory(false);
              setHighlightedIndex(-1);
            }}
            onFocus={handleInputFocus}
            onClick={handleInputClick}
            onKeyDown={handleKeyDown}
            placeholder="输入路径(例如 C:\Users),Tab 补全,Enter 跳转,Esc 取消"
            spellCheck={false}
          />
          {/* 历史记录下拉 */}
          {showHistory && uniqueHistory.length > 0 && (
            <div className="path-bar-dropdown">
              <div className="path-bar-dropdown-header">
                <span className="path-bar-dropdown-title">历史记录</span>
                <button
                  className="path-bar-dropdown-clear"
                  onClick={handleClearHistory}
                  title="清空历史记录"
                >
                  ×
                </button>
              </div>
              {uniqueHistory.map((path, idx) => (
                <div
                  key={idx}
                  className={`path-bar-dropdown-item ${highlightedIndex === idx ? 'highlighted' : ''}`}
                  onClick={() => handleHistorySelect(path)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                >
                  {path}
                </div>
              ))}
            </div>
          )}
        </div>
        {error && <span className="path-bar-error" title={error}>⚠ {error}</span>}
        {completions.length > 0 && !error && (
          <span className="path-bar-hint">候选 {completions.length}</span>
        )}
        <div className="path-bar-actions">
          <button className="path-bar-btn" onClick={close}>取消</button>
          <button className="path-bar-btn path-bar-btn-primary" onClick={() => void submit()}>
            打开
          </button>
        </div>
      </div>
    </div>
  );
}

// =================== 辅助函数 ===================

function mapPaneNode(
  node: LayoutNode,
  paneId: string,
  fn: (p: Extract<LayoutNode, { type: 'pane' }>) => LayoutNode,
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id === paneId) return fn(node);
    return node;
  }
  return {
    type: 'split',
    id: node.id,
    dir: node.dir,
    sizes: [...node.sizes],
    children: node.children.map((c) => mapPaneNode(c, paneId, fn)),
  };
}
