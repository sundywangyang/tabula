/**
 * FileList 渲染时间埋点 hook (P7 v1)
 *
 * 在 entries / sort / viewMode 变化时,记录从开始到 React commit
 * 完的渲染耗时(用 performance.now()),并 report 到 perf 客户端。
 *
 * 用法:
 *   useFileListPerfReport(viewMode, sortedEntries);
 */
import { useEffect, useRef } from 'react';
import type { ViewMode } from '../stores/file-store';
import { reportListRender } from './perf-client';

export function useFileListPerfReport(
  viewMode: ViewMode,
  sortedEntriesCount: number,
): void {
  const lastCountRef = useRef<number>(-1);
  const startRef = useRef<number>(0);

  // 在 commit 之前记录起点
  useEffect(() => {
    startRef.current = performance.now();
  });

  // commit 后 report
  useEffect(() => {
    if (lastCountRef.current === sortedEntriesCount) return;
    lastCountRef.current = sortedEntriesCount;
    const dt = performance.now() - (startRef.current || performance.now());
    reportListRender(sortedEntriesCount, viewMode, dt);
  }, [sortedEntriesCount, viewMode]);
}
