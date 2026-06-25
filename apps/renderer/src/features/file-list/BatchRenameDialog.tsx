/**
 * 批量重命名对话框 (P3)
 *
 * 触发方式:选中 2+ 个文件后,Toolbar 或右键菜单「批量重命名」
 * 提供查找/替换规则,实时预览每项的新名字。
 */
import { useEffect, useRef, useState } from 'react';
import './BatchRenameDialog.css';

export interface BatchRenameDialogProps {
  paneId: string;
  paths: string[];      // 要重命名的文件路径列表
  names: string[];      // 对应的显示名列表(来自 entries)
  onClose: () => void;
  onRenamed: () => void; // 刷新回调
}

interface RenamePreview {
  oldName: string;
  newName: string;
  path: string;
  changed: boolean;
}

/** 计算预览列表 */
function computePreview(names: string[], find: string, replace: string): RenamePreview[] {
  return names.map((name, i) => {
    const newName = find ? name.split(find).join(replace) : name;
    return {
      oldName: name,
      newName,
      path: '',
      changed: newName !== name,
    };
  });
}

export function BatchRenameDialog({
  paneId,
  paths,
  names,
  onClose,
  onRenamed,
}: BatchRenameDialogProps) {
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [preview, setPreview] = useState<RenamePreview[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const inputFindRef = useRef<HTMLInputElement>(null);

  // 聚焦查找输入框
  useEffect(() => {
    requestAnimationFrame(() => inputFindRef.current?.focus());
  }, []);

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 实时计算预览
  useEffect(() => {
    if (showPreview) {
      const previews = names.map((name, i) => {
        const newName = find ? name.split(find).join(replace) : name;
        return {
          oldName: name,
          newName,
          path: paths[i] ?? '',
          changed: newName !== name,
        };
      });
      setPreview(previews);
    }
  }, [find, replace, showPreview, names, paths]);

  const handleRename = async () => {
    if (!find && !replace) return;
    setRenaming(true);
    setErrors([]);

    // 构造 (oldPath, newPath) 列表,过滤掉 newName === oldName 的
    const tasks: { oldPath: string; oldName: string; newPath: string; newName: string }[] = [];
    for (let i = 0; i < paths.length; i++) {
      const oldPath = paths[i]!;
      const oldName = names[i]!;
      const newName = find ? oldName.split(find).join(replace) : oldName;
      if (newName === oldName) continue;
      const lastSep = Math.max(oldPath.lastIndexOf('\\'), oldPath.lastIndexOf('/'));
      const parent = oldPath.slice(0, lastSep + 1);
      tasks.push({ oldPath, oldName, newPath: parent + newName, newName });
    }

    if (tasks.length === 0) {
      setRenaming(false);
      return;
    }

    // ============ 阶段 1:dry-run 冲突检测 ============
    // POSIX rename(2) 在目标已存在时会静默覆盖 — 必须在执行前检测
    // 检测目标冲突:任何任务的 newPath 已存在(且不在本批次 oldPath 中)→ 冲突
    const sourcePaths = new Set(tasks.map((t) => t.oldPath));
    const conflicts: string[] = [];
    for (const t of tasks) {
      const exists = await window.tabula.fs.stat(t.newPath);
      if (exists.ok && !sourcePaths.has(t.newPath)) {
        conflicts.push(`${t.oldName}: 目标已存在 "${t.newName}"`);
      }
    }
    // 批次内 newPath 重复(把多个文件改成同一个名字)→ 冲突
    const seen = new Map<string, string>();
    for (const t of tasks) {
      const prev = seen.get(t.newPath);
      if (prev) {
        conflicts.push(`${prev} 和 ${t.oldName} 都将被改为 "${t.newName}"`);
      } else {
        seen.set(t.newPath, t.oldName);
      }
    }

    if (conflicts.length > 0) {
      setRenaming(false);
      setErrors(conflicts);
      return;
    }

    // ============ 阶段 2:执行重命名 + 失败回滚 ============
    const completed: { oldPath: string; newPath: string; oldName: string }[] = [];
    const failed: string[] = [];

    for (const t of tasks) {
      const res = await window.tabula.fs.rename(t.oldPath, t.newPath);
      if (res.ok) {
        completed.push({ oldPath: t.oldPath, newPath: t.newPath, oldName: t.oldName });
      } else {
        failed.push(`${t.oldName}: ${res.error.message}`);
        // 已有失败 → 回滚已完成的(顺序倒序)
        for (let j = completed.length - 1; j >= 0; j--) {
          const done = completed[j]!;
          const rollback = await window.tabula.fs.rename(done.newPath, done.oldPath);
          if (!rollback.ok) {
            failed.push(`回滚失败 ${done.oldName}: ${rollback.error.message}`);
          }
        }
        break;
      }
    }

    setRenaming(false);

    if (failed.length > 0) {
      setErrors(failed);
    } else {
      onRenamed();
      onClose();
    }
  };

  const totalCount = names.length;
  const changedCount = preview.filter((p) => p.changed).length;

  // 只显示前 20 条预览
  const displayPreview = preview.slice(0, 20);
  const hasMore = preview.length > 20;

  return (
    <div
      className="batch-rename-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="batch-rename-dialog" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="batch-rename-header">
          <span className="batch-rename-title">批量重命名</span>
          <span className="batch-rename-count">{totalCount} 个文件</span>
        </div>

        {/* Rule inputs */}
        <div className="batch-rename-rules">
          <div className="batch-rename-rule-row">
            <label className="batch-rename-label">查找</label>
            <input
              ref={inputFindRef}
              className="batch-rename-input"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="输入要替换的文本"
              spellCheck={false}
            />
          </div>
          <div className="batch-rename-rule-row">
            <label className="batch-rename-label">替换为</label>
            <input
              className="batch-rename-input"
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="替换后的文本(可为空)"
              spellCheck={false}
            />
          </div>
          <div className="batch-rename-preview-toggle">
            <label className="batch-rename-checkbox-label">
              <input
                type="checkbox"
                checked={showPreview}
                onChange={(e) => setShowPreview(e.target.checked)}
              />
              显示预览
            </label>
            {showPreview && changedCount > 0 && (
              <span className="batch-rename-preview-hint">
                将重命名 {changedCount} 项
              </span>
            )}
          </div>
        </div>

        {/* Preview list */}
        {showPreview && (
          <div className="batch-rename-preview-list">
            {displayPreview.map((item, idx) => (
              <div
                key={idx}
                className={`batch-rename-preview-item ${item.changed ? 'changed' : ''}`}
              >
                <span className="batch-rename-old">{item.oldName}</span>
                <span className="batch-rename-arrow">→</span>
                <span className="batch-rename-new">{item.newName}</span>
              </div>
            ))}
            {hasMore && (
              <div className="batch-rename-preview-more">
                …还有 {preview.length - 20} 项
              </div>
            )}
          </div>
        )}

        {/* Error list */}
        {errors.length > 0 && (
          <div className="batch-rename-errors">
            <div className="batch-rename-errors-title">重命名失败:</div>
            {errors.map((err, i) => (
              <div key={i} className="batch-rename-error-item">{err}</div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="batch-rename-actions">
          <button
            className="batch-rename-btn batch-rename-btn-cancel"
            onClick={onClose}
            disabled={renaming}
          >
            取消
          </button>
          <button
            className="batch-rename-btn batch-rename-btn-primary"
            onClick={handleRename}
            disabled={renaming || (!find && !replace)}
          >
            {renaming ? '重命名中…' : `重命名${showPreview && changedCount > 0 ? ` (${changedCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}