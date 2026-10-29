import { useEffect, useState } from 'react';
import { ListChecks, X } from 'lucide-react';
import type { FileTransferJob } from '@tabula/bridge';
import './TransferPanel.css';

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes; let unit = 0;
  while (n >= 1024 && unit < units.length - 1) { n /= 1024; unit++; }
  return `${n.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
const statusText: Record<FileTransferJob['status'], string> = {
  queued: '排队中', running: '进行中', cancelling: '正在取消并回滚', completed: '已完成', cancelled: '已取消并回滚', failed: '失败',
};

export function TransferPanel() {
  const [jobs, setJobs] = useState<FileTransferJob[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!window.tabula.transfers) return;
    let active = true;
    const off = window.tabula.transfers.onUpdate((job) => setJobs((old) => [job, ...old.filter((item) => item.id !== job.id)]));
    void window.tabula.transfers.list().then((initial) => {
      if (active) setJobs((old) => [...old, ...initial.filter((job) => !old.some((item) => item.id === job.id))]);
    }).catch(console.warn);
    return () => { active = false; off(); };
  }, []);
  const activeCount = jobs.filter((job) => ['queued', 'running', 'cancelling'].includes(job.status)).length;
  return <>
    <button className="transfer-toggle" type="button" onClick={() => setOpen((value) => !value)} title="文件任务" aria-label="文件任务">
      <ListChecks size={13} /> 文件任务{activeCount > 0 ? ` ${activeCount}` : ''}
    </button>
    {open && <section className="transfer-panel" aria-label="文件任务面板">
      <header><strong>文件任务</strong><button onClick={() => setOpen(false)} aria-label="关闭文件任务面板"><X size={15} /></button></header>
      <div className="transfer-list">
        {jobs.length === 0 && <div className="transfer-empty">暂无文件任务</div>}
        {jobs.map((job) => {
          const percent = job.totalBytes && job.totalBytes > 0 ? Math.min(100, Math.round(job.completedBytes * 100 / job.totalBytes)) : job.status === 'completed' ? 100 : null;
          return <article className="transfer-job" key={job.id}>
            <div className="transfer-job-heading"><strong>{job.mode === 'copy' ? '复制' : '移动'} · {statusText[job.status]}</strong><span>{job.completedItems}/{job.totalItems} 项</span></div>
            <div className="transfer-path" title={job.currentPath ?? ''}>{job.currentPath || (job.status === 'queued' ? '等待执行' : statusText[job.status])}</div>
            {job.status === 'running' && <><progress max={100} value={percent ?? undefined} /><div className="transfer-meta"><span>{percent === null ? '计算中' : `${percent}%`}</span><span>{job.bytesPerSecond ? `${formatBytes(job.bytesPerSecond)}/s` : '速度计算中'}</span><span>{job.remainingSeconds !== null ? `剩余约 ${Math.ceil(job.remainingSeconds)} 秒` : '剩余时间计算中'}</span></div></>}
            {job.error && <div className="transfer-error">{job.error}</div>}
            {job.warning && <div className="transfer-error">{job.warning}</div>}
            <div className="transfer-actions">
              {['queued', 'running'].includes(job.status) && <button onClick={() => void window.tabula.transfers.cancel(job.id)}>取消并回滚</button>}
              {['failed', 'cancelled'].includes(job.status) && !job.error?.includes('回滚未完成') && <button onClick={() => void window.tabula.transfers.retry(job.id)}>重试</button>}
            </div>
          </article>;
        })}
      </div>
    </section>}
  </>;
}
