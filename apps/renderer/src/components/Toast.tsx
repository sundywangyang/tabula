/**
 * Toast 通知 (P3)
 *
 * 顶栏右侧飘字 3s 自动消失。
 * 多条可堆叠。
 */
import { useFileStore } from '../stores/file-store';
import './Toast.css';

const KIND_ICON: Record<string, string> = {
  info: 'ℹ',
  success: '✓',
  warn: '⚠',
  error: '✕',
};

export function ToastHost() {
  const toasts = useFileStore((s) => s.toasts);
  const dismiss = useFileStore((s) => s.dismissToast);
  const archiveToasts = useFileStore(s => s.archiveToasts);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status" onClick={() => dismiss(t.id)}>
          <span className="toast-icon">{KIND_ICON[t.kind] ?? 'ℹ'}</span>
          <span className="toast-message">{t.message}</span>
          {[...archiveToasts].find(([, id]) => id === t.id) && <button className="toast-cancel" onClick={event => { event.stopPropagation(); const job = [...archiveToasts].find(([, id]) => id === t.id)?.[0]; if (job) void useFileStore.getState().cancelArchive(job); }}>取消任务</button>}
          <button className="toast-close" onClick={(e) => { e.stopPropagation(); dismiss(t.id); }} title="关闭">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
