import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentHit, DuplicateGroup, FileActivity, LinkInfo, NetworkMount, NetworkRequest, ToolMethods, ToolProgress } from '@tabula/bridge';
import { useFileStore } from '../../stores/file-store';
import { useLayoutStore } from '../../stores/layout-store';
import { useUiDialogsStore } from '../../stores/ui-dialogs-store';
import { useModal } from '../../components/use-modal';
import './FileToolsDialog.css';

type Dialog = NonNullable<ReturnType<typeof useUiDialogsStore.getState>['toolsDialog']>;
const labels = { content: '全文内容搜索', duplicates: '查找重复文件', history: '文件历史时间线', network: '连接服务器', links: '软链接 / 硬链接管理', icons: '自定义文件夹图标', associations: '默认应用管理' };
const formatSize = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

export function FileToolsDialog({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState(dialog.path);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const [warnings, setWarnings] = useState<string[]>([]);
  const [includeHidden, setIncludeHidden] = useState(false); const [caseSensitive, setCaseSensitive] = useState(false);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [hits, setHits] = useState<ContentHit[]>([]); const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [history, setHistory] = useState<FileActivity[]>([]); const [mounts, setMounts] = useState<NetworkMount[]>([]);
  const [info, setInfo] = useState<LinkInfo | null>(null); const [target, setTarget] = useState(dialog.path);
  const [newPath, setNewPath] = useState(dialog.path + ' - 链接'); const [linkKind, setLinkKind] = useState<'symlink' | 'hardlink'>('symlink');
  const [icon, setIcon] = useState<string | null>(null);
  const [network, setNetwork] = useState<NetworkRequest>({ protocol: 'smb', server: '', share: '', drive: '', username: '', password: '' });
  const job = useRef<string | null>(null); const generation = useRef(0);
  const close = useCallback(() => { generation.current++; if (job.current) void window.tabula.tools.run('cancel', { jobId: job.current }); onClose(); }, [onClose]);
  useModal(panel, close);
  useEffect(() => window.tabula.tools.onProgress(p => { if (p.jobId === job.current) setProgress(p); }), []);
  useEffect(() => () => { generation.current++; if (job.current) void window.tabula.tools.run('cancel', { jobId: job.current }); }, []);
  async function action<K extends keyof ToolMethods>(method: K, input: ToolMethods[K]['input']): Promise<ToolMethods[K]['output'] | undefined> {
    setError('');
    try { const result = await window.tabula.tools.run(method, input); if (result.ok) return result.data; setError(result.error.message); }
    catch (e) { setError((e as Error).message); }
  }
  const refreshHistory = async () => { const result = await action('history', { path, limit: 1000 }); if (result) setHistory(result); };
  const refreshMounts = async () => { const result = await action('mounts', undefined); if (result) setMounts(result); };
  useEffect(() => {
    if (dialog.mode === 'history') void refreshHistory();
    if (dialog.mode === 'network') void refreshMounts();
    if (dialog.mode === 'links') void action('linkInfo', { path }).then(value => value && setInfo(value));
    if (dialog.mode === 'icons') void action('folderIcon', { path }).then(value => setIcon(value ?? null));
  }, [dialog.mode]);
  const reveal = async (file: string) => { await useFileStore.getState().revealInPane(dialog.paneId, file); close(); };
  const scan = async () => {
    if (busy) return;
    const version = ++generation.current; const jobId = crypto.randomUUID(); job.current = jobId;
    setBusy(true); setNotice(''); setWarnings([]); setProgress(null); setHits([]); setGroups([]);
    try {
      const request = { root: path, jobId, includeHidden };
      if (dialog.mode === 'content') {
        const result = await action('contentSearch', { ...request, query, caseSensitive });
        if (generation.current !== version || !result) return;
        setHits(result.items); setWarnings(result.warnings); setNotice(`${result.cancelled ? '已取消，保留当前结果' : '扫描完成'}：${result.items.length} 处匹配${result.truncated ? '（达到扫描上限）' : ''}`);
      } else {
        const result = await action('duplicates', request);
        if (generation.current !== version || !result) return;
        setGroups(result.items); setWarnings(result.warnings); setNotice(`${result.cancelled ? '已取消，保留当前结果' : '扫描完成'}：${result.items.length} 组，重复占用 ${formatSize(result.items.reduce((sum, group) => sum + group.size * (group.paths.length - 1), 0))}${result.truncated ? '（达到扫描上限）' : ''}`);
      }
    } finally { if (generation.current === version) { setBusy(false); job.current = null; } }
  };
  return <div className="file-tools-overlay" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className="file-tools-panel" ref={panel} role="dialog" aria-modal="true" aria-label={labels[dialog.mode]} tabIndex={-1}>
      <header><h2>{labels[dialog.mode]}</h2><button aria-label="关闭文件工具" onClick={close}>✕</button></header>
      {dialog.mode !== 'network' && <label>路径<input aria-label="工具路径" value={path} onChange={e => setPath(e.target.value)} disabled={busy} /></label>}
      {(dialog.mode === 'content' || dialog.mode === 'duplicates') && <>
        <div className="file-tools-actions"><button disabled={busy} onClick={async () => { const directory = await window.tabula.fs.pickDirectory(); if (directory) setPath(directory); }}>选择文件夹</button>
          <label><input type="checkbox" checked={includeHidden} onChange={e => setIncludeHidden(e.target.checked)} disabled={busy} />包含隐藏项</label></div>
        {dialog.mode === 'content' && <><label>搜索内容<input aria-label="搜索内容" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void scan(); }} /></label><label><input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} />区分大小写</label>
          <p>支持文本、代码、Markdown、文本型 PDF、DOCX、PPTX、ODT、XLS/XLSX/ODS；扫描中跳过符号链接，单文件内容上限 32 MB。</p></>}
        <div className="file-tools-actions"><button disabled={busy || !path || dialog.mode === 'content' && !query.trim()} onClick={() => void scan()}>{busy ? '扫描中…' : '开始扫描'}</button>{busy && <button onClick={() => job.current && void action('cancel', { jobId: job.current })}>取消扫描</button>}</div>
        {progress && busy && <p role="status">已扫描 {progress.scanned} 项 · 已匹配 {progress.matched} 项</p>}
        <div className="file-tools-results">
          {hits.map((hit, i) => <article key={`${hit.path}:${i}`}><button onClick={() => void reveal(hit.path)}>{hit.name} · 第 {hit.line} 行</button><small>{hit.path}</small><pre>{hit.snippet}</pre></article>)}
          {groups.map(group => <article key={group.hash}><strong>{group.paths.length} 个相同文件 · {formatSize(group.size)}</strong><small>SHA-256: {group.hash}</small>{group.paths.map(file => <div key={file}><button onClick={() => void reveal(file)}>定位</button> {file}</div>)}</article>)}
        </div>
      </>}
      {dialog.mode === 'history' && <><button onClick={() => void refreshHistory()}>刷新时间线</button><p>记录本应用中的新建、编辑、复制、移动、重命名、删除及撤销/重做；保留最近 5000 条。可输入具体文件路径查看其记录。</p><div className="file-tools-results">{history.length ? history.map(event => <article key={event.id}><time>{new Date(event.timestamp).toLocaleString()}</time><strong>{event.operation} · {{ do: '执行', undo: '撤销', redo: '重做' }[event.phase]}</strong>{event.paths.map((file, i) => <small key={file}>{file}{event.destinations?.[i] ? ` → ${event.destinations[i]}` : ''}</small>)}</article>) : <p>当前路径暂无操作记录。</p>}</div></>}
      {dialog.mode === 'network' && <>
        <label>协议<select value={network.protocol} onChange={e => setNetwork(n => ({ ...n, protocol: e.target.value as NetworkRequest['protocol'] }))}><option value="smb">SMB 共享</option><option value="nfs">NFS 共享</option></select></label>
        {(['server', 'share', 'drive', 'username', 'password'] as const).map(key => <label key={key}>{{ server: '服务器', share: '共享目录', drive: '盘符（留空自动选择）', username: '用户名（可选）', password: '密码（可选）' }[key]}<input aria-label={`网络${key}`} type={key === 'password' ? 'password' : 'text'} autoComplete={key === 'password' ? 'new-password' : 'off'} value={network[key] ?? ''} onChange={e => setNetwork(n => ({ ...n, [key]: e.target.value }))} /></label>)}
        <p>使用系统凭据连接，不保存密码。NFS 需要 Windows 已安装 NFS 客户端，匿名挂载无需填写用户名和密码。</p>
        <button disabled={busy} onClick={async () => { setBusy(true); try { const mount = await action('connect', network); if (mount) { setNotice(`已连接 ${mount.remote}`); await useLayoutStore.getState().pane.navigate(dialog.paneId, mount.path); await refreshMounts(); window.dispatchEvent(new Event('tabula:refresh-drives')); } } finally { setBusy(false); setNetwork(n => ({ ...n, password: '' })); } }}>{busy ? '连接中…' : '连接'}</button>
        {mounts.map(mount => <article key={mount.path}>{mount.path} → {mount.remote} <button onClick={async () => { await action('disconnect', { path: mount.path }); await refreshMounts(); }}>断开映射</button></article>)}
      </>}
      {dialog.mode === 'links' && <>
        <button onClick={async () => { const value = await action('linkInfo', { path }); if (value) { setInfo(value); if (value.target) setTarget(value.target); } }}>读取链接信息</button>
        {info && <article><strong>类型：{info.kind}</strong><small>目标：{info.target ?? '共享文件数据，没有独立目标路径'}</small><small>链接计数：{info.links} · 标识：{info.inode}</small></article>}
        <label>目标路径<input aria-label="链接目标" value={target} onChange={e => setTarget(e.target.value)} /></label>
        <label>新链接路径<input aria-label="新链接路径" value={newPath} onChange={e => setNewPath(e.target.value)} /></label>
        <label>链接类型<select value={linkKind} onChange={e => setLinkKind(e.target.value as typeof linkKind)}><option value="symlink">符号链接 / 目录联接</option><option value="hardlink">硬链接（同一卷的文件）</option></select></label>
        <div className="file-tools-actions"><button onClick={async () => { const value = await action('createLink', { target, path: newPath, kind: linkKind }); if (value) { setInfo(value); setNotice('链接已创建'); await useFileStore.getState().refresh(dialog.paneId); } }}>创建链接</button>
          <button disabled={!info || !['symlink', 'junction'].includes(info.kind)} onClick={async () => { const value = await action('retargetLink', { path, target }); if (value) { setInfo(value); setNotice('链接目标已更新'); await useFileStore.getState().refresh(dialog.paneId); } }}>修改现有链接目标</button></div>
      </>}
      {dialog.mode === 'icons' && <>{icon && <img src={icon} width={96} height={96} alt="当前文件夹图标" />}<p>为文件夹选择图像；Windows 同时写入系统文件夹图标，重置会还原原有 desktop.ini。</p><div className="file-tools-actions"><button onClick={async () => { const image = await window.tabula.fs.pickFile({ filters: [{ name: '图像', extensions: ['png', 'jpg', 'jpeg', 'ico'] }] }); if (typeof image === 'string') { const value = await action('folderIcon', { path, image }); if (value) { setIcon(value); setNotice('文件夹图标已更新'); await useFileStore.getState().refresh(dialog.paneId); } } }}>选择图像</button><button onClick={async () => { const value = await action('folderIcon', { path, reset: true }); if (value !== undefined) { setIcon(null); await useFileStore.getState().refresh(dialog.paneId); setNotice('已还原文件夹图标'); } }}>重置图标</button></div></>}
      {dialog.mode === 'associations' && <><p>按此文件的扩展名打开系统默认应用设置。在系统界面选择应用并确认后，此类型将使用新的默认应用。</p><div className="file-tools-actions"><button onClick={async () => { const file = await window.tabula.fs.pickFile(); if (typeof file === 'string') setPath(file); }}>选择文件</button><button onClick={async () => { const result = await action('defaultApplication', { path }); if (result) setNotice(result.message); }}>更改此类型的默认应用</button></div></>}
      {notice && <p role="status">{notice}</p>}{error && <p className="file-tools-error" role="alert">{error}</p>}
      {warnings.length > 0 && <details><summary>{warnings.length} 项未能完整扫描</summary>{warnings.slice(0, 50).map((warning, i) => <p key={i}>{warning}</p>)}</details>}
    </div>
  </div>;
}
