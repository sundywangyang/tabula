import { useEffect, useState } from 'react';
import {
  Archive,
  File as FileIcon,
  FileCode2,
  FileText,
  Film,
  Folder,
  Image,
  Music,
  Settings,
} from 'lucide-react';
import type { FsEntry } from '@tabula/bridge';
import { useFileStore } from '../../../stores/file-store';
import { isThumbnailable } from '../../../stores/file/thumbnail-slice';

// =================== 缩略图组件(供 row / grid 复用)===================

/**
 * 单个文件图标的渲染。
 * - 若是支持的图片:挂载时调 loadThumbnail 拿 dataURL,加载完渲染 <img>
 * - 加载中/失败/非图片:回退到 emoji
 *
 * 注意:virtualizer 会把不可见行 unmount,visible 时重新 mount。
 * loadThumbnail 命中 store 缓存会同步返回,无 IPC 开销。
 */
export function FileThumb({ entry, variant }: { entry: FsEntry; variant: 'row' | 'grid'; }) {
  const loadThumbnail = useFileStore((s) => s.loadThumbnail);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  // 进入或 mtime/path 变化时拉一次
  useEffect(() => {
    let cancelled = false;
    if (entry.isDirectory) return; // 目录不需要
    if (!isThumbnailable(entry.ext)) return;
    // 拉一次。store 内部按 mtime 失效,无需自己比较。
    void loadThumbnail(entry.path, entry.mtime).then((result) => {
      if (cancelled) return;
      setDataUrl(result?.dataUrl ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.mtime, entry.isDirectory, entry.ext, loadThumbnail]);

  const className = variant === 'grid' ? 'grid-icon-thumb' : 'row-icon-thumb';

  if (entry.isDirectory) {
    if (entry.customIcon) return <img className={className} src={entry.customIcon} alt="自定义文件夹图标" draggable={false} />;
    return <span className={variant === 'grid' ? 'grid-icon' : 'row-icon'}>
      <Folder size={14} className="file-icon-folder" />
    </span>;
  }
  if (isThumbnailable(entry.ext) && dataUrl) {
    return (
      <img
        className={className}
        src={dataUrl}
        alt={entry.name}
        draggable={false}
        loading="lazy"
        decoding="async"
      />
    );
  }
  // 回退到 lucide 图标
  return <span className={variant === 'grid' ? 'grid-icon' : 'row-icon'}>{iconFor(entry)}</span>;
}

function iconFor(entry: FsEntry) {
  if (entry.isDirectory) {
    return <Folder size={14} className="file-icon-folder" />;
  }
  const ext = entry.ext;
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.heic', '.avif'].includes(ext)) {
    return <Image size={14} className="file-icon-image" />;
  }
  if (['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'].includes(ext)) {
    return <Film size={14} className="file-icon-video" />;
  }
  if (['.mp3', '.wav', '.flac', '.ogg', '.m4a'].includes(ext)) {
    return <Music size={14} className="file-icon-audio" />;
  }
  if (['.zip', '.tar', '.gz', '.7z', '.rar', '.bz2', '.xz'].includes(ext)) {
    return <Archive size={14} className="file-icon-archive" />;
  }
  if (['.exe', '.msi', '.dmg', '.app', '.pkg', '.deb'].includes(ext)) {
    return <Settings size={14} className="file-icon-exec" />;
  }
  if (['.md', '.markdown'].includes(ext)) {
    return <FileText size={14} className="file-icon-doc" />;
  }
  if (
    [
      '.js', '.ts', '.tsx', '.jsx', '.json', '.py', '.rs', '.go',
      '.java', '.c', '.cpp', '.h', '.hpp', '.css', '.scss', '.html',
      '.php', '.rb', '.swift', '.kt', '.sql', '.sh', '.yaml', '.yml',
    ].includes(ext)
  ) {
    return <FileCode2 size={14} className="file-icon-code" />;
  }
  if (['.txt', '.log', '.csv', '.xml'].includes(ext)) {
    return <FileText size={14} className="file-icon-text" />;
  }
  return <FileIcon size={14} className="file-icon-default" />;
}
