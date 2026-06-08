/**
 * 更新通知 (P7 v1)
 *
 * 全局监听 `window.tabula.update.onAvailable`,在 App 顶部弹一个非阻塞模态:
 *  - 「立即下载」  →  调 download(),UI 切换到进度条
 *  - 「稍后再说」  →  关闭,本次会话不再提示
 *  - 「查看更新日志」  →  弹出 releaseNotes(若发布者写了)
 *
 * 设计原则:
 *  - 同一个 App 实例,只显示一次(用户关掉后本地 state 标记 dismissed)
 *  - download 状态由 update.onDownloadProgress 实时更新进度
 *  - downloaded 状态后,「立即重启安装」按钮调 install()(quitAndInstall)
 *  - 状态变化全部走 window.tabula.update.onXxx 事件订阅,卸载时解绑
 */
import { useEffect, useState } from 'react';
import type { UpdateInfo, DownloadProgress } from '@tabula/bridge';
import './UpdateNotification.css';

type Phase = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error';

export function UpdateNotification() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // 订阅主进程推送
  useEffect(() => {
    const offA = window.tabula.update.onAvailable((i) => {
      setInfo(i);
      setPhase('available');
      setDismissed(false);
      setProgress(null);
      setErrorMsg(null);
    });
    const offNA = window.tabula.update.onNotAvailable(() => {
      // 没有新版本:不影响 UI
    });
    const offP = window.tabula.update.onDownloadProgress((p) => {
      setProgress(p);
      setPhase('downloading');
    });
    const offD = window.tabula.update.onDownloaded((i) => {
      setInfo(i);
      setPhase('downloaded');
    });
    const offE = window.tabula.update.onError((err) => {
      setErrorMsg(err.message);
      setPhase('error');
    });
    return () => {
      offA();
      offNA();
      offP();
      offD();
      offE();
    };
  }, []);

  if (phase === 'idle' || dismissed) return null;

  return (
    <div className="update-notif" role="dialog" aria-label="软件更新">
      <div className="update-notif-card">
        <div className="update-notif-icon">⬆</div>
        <div className="update-notif-body">
          {phase === 'available' && (
            <>
              <div className="update-notif-title">发现新版本 v{info?.version}</div>
              {info?.releaseNotes && (
                <div className="update-notif-notes">{info.releaseNotes}</div>
              )}
              <div className="update-notif-actions">
                <button
                  className="update-notif-primary"
                  onClick={async () => {
                    setPhase('downloading');
                    setProgress({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 });
                    await window.tabula.update.download();
                  }}
                >
                  立即下载
                </button>
                <button
                  className="update-notif-secondary"
                  onClick={() => setDismissed(true)}
                >
                  稍后再说
                </button>
              </div>
            </>
          )}
          {phase === 'downloading' && (
            <>
              <div className="update-notif-title">正在下载 v{info?.version}…</div>
              <div className="update-notif-progress">
                <div
                  className="update-notif-progress-fill"
                  style={{ width: `${Math.round(progress?.percent ?? 0)}%` }}
                />
              </div>
              <div className="update-notif-meta">
                {formatBytes(progress?.transferred ?? 0)} / {formatBytes(progress?.total ?? 0)} ·
                {' '}{formatBytes(progress?.bytesPerSecond ?? 0)}/s
              </div>
              <div className="update-notif-actions">
                <button
                  className="update-notif-secondary"
                  onClick={() => setDismissed(true)}
                >
                  后台下载
                </button>
              </div>
            </>
          )}
          {phase === 'downloaded' && (
            <>
              <div className="update-notif-title">v{info?.version} 下载完成</div>
              <div className="update-notif-notes">重启应用即可完成安装。</div>
              <div className="update-notif-actions">
                <button
                  className="update-notif-primary"
                  onClick={() => {
                    void window.tabula.update.install();
                  }}
                >
                  立即重启并安装
                </button>
                <button
                  className="update-notif-secondary"
                  onClick={() => setDismissed(true)}
                >
                  稍后
                </button>
              </div>
            </>
          )}
          {phase === 'error' && (
            <>
              <div className="update-notif-title">更新失败</div>
              <div className="update-notif-notes">{errorMsg ?? '未知错误'}</div>
              <div className="update-notif-actions">
                <button
                  className="update-notif-secondary"
                  onClick={() => setDismissed(true)}
                >
                  关闭
                </button>
              </div>
            </>
          )}
        </div>
        <button
          className="update-notif-close"
          onClick={() => setDismissed(true)}
          title="关闭"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = b;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}
