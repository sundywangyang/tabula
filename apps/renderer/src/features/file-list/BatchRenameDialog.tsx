/**
 * 批量重命名对话框 (P3)
 *
 * 触发方式:选中 2+ 个文件后,Toolbar 或右键菜单「批量重命名」
 * 提供查找/替换规则,实时预览每项的新名字。
 */
import { useEffect, useRef, useState } from 'react';
import './BatchRenameDialog.css';
import { defaultRenameRules, renameByRules, type RenameRules } from '@tabula/core/file-rules';
import { useModal } from '../../components/use-modal';

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
  const [rules, setRules] = useState<RenameRules>({ ...defaultRenameRules });
  const { find, replace } = rules;
  const setFind = (find: string) => setRules(r => ({ ...r, find }));
  const setReplace = (replace: string) => setRules(r => ({ ...r, replace }));
  const panelRef = useRef<HTMLDivElement>(null);
  useModal(panelRef, onClose);
  const [preview, setPreview] = useState<RenamePreview[]>([]);
  const [showPreview, setShowPreview] = useState(true);
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
        const newName = renameByRules(name, i, rules);
        return {
          oldName: name,
          newName,
          path: paths[i] ?? '',
          changed: newName !== name,
        };
      });
      setPreview(previews);
    }
  }, [rules, showPreview, names, paths]);

  const handleRename = async () => {
    if (!Number.isSafeInteger(rules.start) || !Number.isSafeInteger(rules.step) || rules.step < 1 || rules.padding < 1 || rules.padding > 12) { setErrors(['请输入有效的起始编号、步长和 1–12 位补零宽度']); return; }
    setRenaming(true);
    setErrors([]);

    // 构造 (oldPath, newPath) 列表,过滤掉 newName === oldName 的
    const tasks: { oldPath: string; oldName: string; newPath: string; newName: string }[] = [];
    for (let i = 0; i < paths.length; i++) {
      const oldPath = paths[i]!;
      const oldName = names[i]!;
      const newName = renameByRules(oldName, i, rules);
      if (newName === oldName) continue;
      if (!newName.trim() || newName === '.' || newName === '..' || /[\\/\0]/.test(newName)) {
        setErrors([`${oldName}: 无效的新名称`]);
        setRenaming(false);
        return;
      }
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

    // The main process stages all sources before committing final names and records one undo.
    try {
      const result = await window.tabula.fs.batchRename(tasks.map(({ oldPath, newPath }) => ({ oldPath, newPath })));
      if (!result.ok) setErrors([result.error.message]);
      else { onRenamed(); onClose(); }
    } catch (error) {
      setErrors([String(error)]);
    } finally {
      setRenaming(false);
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
      <div ref={panelRef} tabIndex={-1} className="batch-rename-dialog" role="dialog" aria-modal="true" aria-label="批量重命名">
        {/* Header */}
        <div className="batch-rename-header">
          <span className="batch-rename-title">批量重命名</span>
          <span className="batch-rename-count">{totalCount} 个文件</span>
        </div>

        {/* Rule inputs */}
        <div className="batch-rename-rules">
          {(['prefix', 'suffix', 'template'] as const).map(key => <label className="batch-rename-rule-row" key={key}>
            <span className="batch-rename-label">{{ prefix: '前缀', suffix: '后缀', template: '命名模板' }[key]}</span>
            <input className="batch-rename-input" aria-label={{ prefix: '前缀', suffix: '后缀', template: '命名模板' }[key]} value={rules[key]} onChange={e => setRules(r => ({ ...r, [key]: e.target.value }))} />
          </label>)}
          <p>模板支持 {'{name}'} 文件名、{'{n}'} 编号、{'{ext}'} 扩展名；默认保留扩展名。</p>
          {(['start', 'step', 'padding'] as const).map(key => <label className="batch-rename-rule-row" key={key}>
            <span className="batch-rename-label">{{ start: '起始编号', step: '编号步长', padding: '补零位数' }[key]}</span>
            <input className="batch-rename-input" type="number" aria-label={{ start: '起始编号', step: '编号步长', padding: '补零位数' }[key]} value={rules[key]} onChange={e => setRules(r => ({ ...r, [key]: Number(e.target.value) }))} />
          </label>)}
          <label>大小写 <select value={rules.caseMode} onChange={e => setRules(r => ({ ...r, caseMode: e.target.value as RenameRules['caseMode'] }))}><option value="keep">保留</option><option value="lower">小写</option><option value="upper">大写</option></select></label>
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
            disabled={renaming}
          >
            {renaming ? '重命名中…' : `重命名${showPreview && changedCount > 0 ? ` (${changedCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
