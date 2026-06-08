/**
 * 当前目录文件名搜索栏 (Ctrl+F)
 *
 * 嵌入在 PaneView 内的搜索条:
 * - Ctrl+F 聚焦
 * - 实时按 name(大小写不敏感)子串过滤
 * - Esc 折叠(保留 query),再 Esc 清空
 * - 显式 × 按钮清空
 */
import { useEffect, useRef } from 'react';
import { useFileStore } from '../../stores/file-store';
import './SearchBar.css';

export function SearchBar({ paneId }: { paneId: string }) {
  const open = useFileStore((s) => s.panes[paneId]?.searchOpen ?? false);
  const query = useFileStore((s) => s.panes[paneId]?.searchQuery ?? '');
  const setQuery = useFileStore((s) => s.setSearchQuery);
  const closeSearch = useFileStore((s) => s.closeSearch);
  const clearSearch = useFileStore((s) => s.clearSearch);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="search-bar">
      <span className="search-bar-icon">🔍</span>
      <input
        ref={inputRef}
        className="search-bar-input"
        value={query}
        onChange={(e) => setQuery(paneId, e.target.value)}
        placeholder="过滤文件名(子串,大小写不敏感)"
        spellCheck={false}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            if (query) {
              // 第一次 Esc:清空 + 折叠
              clearSearch(paneId);
            } else {
              // 没 query:单纯折叠
              closeSearch(paneId);
            }
          } else if (e.key === 'Enter') {
            // Enter:折叠(保留 query)
            e.preventDefault();
            inputRef.current?.blur();
          }
        }}
      />
      {query && (
        <button
          className="search-bar-clear"
          onClick={() => setQuery(paneId, '')}
          title="清空"
        >
          ✕
        </button>
      )}
      <span className="search-bar-hint">Esc 清空/关闭</span>
    </div>
  );
}
