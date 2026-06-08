/**
 * 冲突解决对话框 (P3)
 *
 * 粘贴/拖放时如果目标已存在,弹此对话框。
 * 一次显示一个冲突,逐个解决。
 * 头部展示:源文件 / 目标位置 / 队列进度
 * 操作:覆盖 / 跳过 / 重命名 / 取消全部
 */
import { useEffect, useState } from 'react';
import { useFileStore } from '../stores/file-store';
import './ConflictDialog.css';

export function ConflictDialog() {
  const pending = useFileStore((s) => s.pendingConflicts);
  const resolve = useFileStore((s) => s.resolveConflict);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    // 每次弹新冲突,重置重命名输入框
    if (pending && pending.queue.length > 0) {
      setRenameValue(pending.queue[0]?.sourceName ?? '');
    }
  }, [pending]);

  if (!pending) return null;
  const head = pending.queue[0];
  if (!head) return null;
  const total = pending.queue.length;
  const processed = pending.resolved.length + pending.autoResolved.length;
  const verb = pending.mode === 'copy' ? '复制' : '移动';

  return (
    <div
      className="conflict-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          // 视为跳过当前
          void resolve('skip');
        }
      }}
    >
      <div className="conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div className="conflict-header">
          <span className="conflict-icon">⚠</span>
          <span id="conflict-title" className="conflict-title">{verb}时发生名称冲突</span>
        </div>

        <div className="conflict-progress">
          正在处理第 <strong>{processed + 1}</strong> / {processed + total} 个冲突
          {total > 1 && ` (剩余 ${total})`}
        </div>

        <div className="conflict-body">
          <div className="conflict-row">
            <span className="conflict-label">源</span>
            <span className="conflict-value conflict-path" title={head.sourcePath}>
              {head.sourceName}
            </span>
          </div>
          <div className="conflict-row">
            <span className="conflict-label">目标已存在</span>
            <span className="conflict-value conflict-path" title={head.destPath}>
              {head.destName}
              {head.isDirectory && <span className="conflict-tag">文件夹</span>}
            </span>
          </div>
          <div className="conflict-row">
            <span className="conflict-label">目标目录</span>
            <span className="conflict-value conflict-path" title={head.destDir}>
              {head.destDir}
            </span>
          </div>
        </div>

        <div className="conflict-rename-row">
          <label className="conflict-rename-label">若选「重命名」,新名称(留空 = 用原名):</label>
          <input
            className="conflict-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            spellCheck={false}
            placeholder={head.sourceName}
          />
        </div>

        <div className="conflict-actions">
          <button
            className="conflict-btn"
            onClick={() => void resolve('skip')}
            title="跳过这个文件,继续下一个"
          >
            跳过
          </button>
          <button
            className="conflict-btn"
            onClick={() => void resolve('rename', renameValue)}
            title="重命名(P3 v1:等同跳过,v1 限制)"
          >
            重命名
          </button>
          <button
            className="conflict-btn conflict-btn-warn"
            onClick={() => void resolve('overwrite')}
            title="覆盖目标(不可恢复)"
          >
            覆盖
          </button>
          <button
            className="conflict-btn conflict-btn-danger"
            onClick={() => void resolve('cancelAll')}
            title="取消整批粘贴"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
