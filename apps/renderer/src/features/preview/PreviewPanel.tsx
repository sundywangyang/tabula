/**
 * 预览面板 (P4)
 *
 * 全屏 overlay,选中 1 个文件按 Space 打开。
 * 内容分发:
 *   - 图片:  内联 blob URL 渲染
 *   - Markdown: marked 解析 + highlight.js 代码高亮
 *   - 代码/文本: 行号 + 等宽字体
 *   - 未知/PDF/二进制: 元信息 + 提示
 *
 * 数据流:从 window.tabula.fs.readFile 取一次,数据缓存在 file-store.previewState。
 * 大文件(>1MB 文本)截断到 100 行;图片 >5MB 拒绝加载。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
import { useFileStore } from '../../stores/file-store';
import { useLayoutStore } from '../../stores/layout-store';
import './PreviewPanel.css';

// 阈值:文本/代码/MD 超过此大小截断到 100 行
const TEXT_TRUNCATE_BYTES = 1024 * 1024; // 1MB
const TEXT_TRUNCATE_LINES = 100;
// 图片超过此大小直接拒绝(避免一次性载入大图片卡死)
const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB
// 视频/音频 — 浏览器原生播放器对大文件支持较好, 上限放宽到 500MB
const MEDIA_MAX_BYTES = 500 * 1024 * 1024;
// PDF — 太大直接拒绝, 100MB 够日常文档
const PDF_MAX_BYTES = 100 * 1024 * 1024;
// 字体 — 单个字体文件通常 100KB-5MB, 20MB 上限足够
const FONT_MAX_BYTES = 20 * 1024 * 1024;
// 压缩包 — 大型 zip(如带 node_modules) 几百 MB, 上限 1GB
const ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024;
// Office 文档 (docx 等) — 单文件通常 <50MB
const DOCX_MAX_BYTES = 50 * 1024 * 1024;
// Excel 表格
const XLSX_MAX_BYTES = 100 * 1024 * 1024;
// PowerPoint
const PPTX_MAX_BYTES = 100 * 1024 * 1024;

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
  '.ico', '.heic', '.avif', '.tiff', '.tif', '.psd', '.raw',
]);
const PDF_EXTS = new Set(['.pdf']);
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const ARCHIVE_EXTS = new Set(['.zip', '.tar', '.tgz', '.gz', '.bz2', '.7z', '.rar']);
const DOCX_EXTS = new Set(['.docx', '.dotx']);
const XLSX_EXTS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv']);
const PPTX_EXTS = new Set(['.pptx', '.ppt', '.odp']);
const RTF_EXTS = new Set(['.rtf']);
const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.ogv',
]);
const AUDIO_EXTS = new Set([
  '.mp3', '.m4a', '.wav', '.flac', '.ogg', '.oga', '.opus', '.aac', '.wma',
]);
const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdx']);
const CODE_EXTS = new Set([
  // 已有主流
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.json5', '.jsonc',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.htm', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.sh', '.bash', '.zsh', '.ps1', '.sql', '.lua', '.rb', '.php', '.pl',
  // 前端框架
  '.vue', '.svelte', '.astro', '.scss', '.sass', '.less', '.styl',
  // 现代语言
  '.swift', '.kt', '.kts', '.dart', '.scala', '.sc', '.mjs',
  // 函数式
  '.hs', '.elm', '.clj', '.cljs', '.cljc', '.edn', '.ex', '.exs', '.erl', '.hrl',
  // 数据科学
  '.r', '.R', '.jl', '.m', '.mm',
  // 数据/协议
  '.proto', '.graphql', '.gql', '.thrift', '.avro',
  // 系统/构建
  '.zig', '.nim', '.cr', '.v', '.sv', '.vhd', '.vhdl',
  // 文本格式 (会被当代码高亮)
  '.diff', '.patch', '.tex',
  // 配置/工具
  '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore',
  // 编译产物 (字节码 / 字节码文本)
  '.class', '.wasm',
]);
const TEXT_EXTS = new Set(['.txt', '.log', '.csv', '.tsv', '.env', '.properties']);

/** 无扩展名文件 — 按常见文件名识别为文本/code (Dockerfile / Makefile / LICENSE / README 等) */
const FILENAME_OVERRIDES: ReadonlyMap<string, PreviewKind> = new Map([
  // dotfiles
  ['.gitignore', 'text'], ['.gitattributes', 'text'], ['.editorconfig', 'text'],
  ['.dockerignore', 'text'], ['.npmrc', 'text'], ['.yarnrc', 'text'],
  ['.npmignore', 'text'], ['.prettierrc', 'text'], ['.eslintrc', 'text'],
  ['.babelrc', 'text'], ['.browserslistrc', 'text'],
  // 项目元数据
  ['README', 'markdown'], ['README.md', 'markdown'], ['README.txt', 'text'],
  ['LICENSE', 'text'], ['LICENSE.md', 'markdown'], ['LICENCE', 'text'],
  ['CHANGELOG', 'text'], ['CHANGELOG.md', 'markdown'],
  ['CONTRIBUTING', 'markdown'], ['AUTHORS', 'text'], ['NOTICE', 'text'],
  // 构建/CI
  ['Makefile', 'code'], ['GNUmakefile', 'code'], ['Rakefile', 'code'],
  ['CMakeLists.txt', 'code'], ['Vagrantfile', 'code'],
  ['Brewfile', 'text'], ['Podfile', 'code'],
  // 容器/shell
  ['Dockerfile', 'code'], ['Containerfile', 'code'],
  ['docker-compose.yml', 'code'], ['docker-compose.yaml', 'code'],
  // shell
  ['gradlew', 'code'], ['mvnw', 'code'],
  // gem
  ['Gemfile', 'code'], ['Rakefile', 'code'],
  // 其他
  ['justfile', 'code'], ['Procfile', 'code'],
]);

/** 嗅探无扩展名文件的前 4KB 判定 kind (仅在 filename 匹配失败时) */
function sniffKindFromText(head: string): PreviewKind {
  const s = head.trimStart();
  if (!s) return 'text';
  // Shebang #! — 各种脚本
  if (s.startsWith('#!')) {
    // #!/usr/bin/env python / bash / node / ruby / perl / php
    // #!/bin/sh / bash / zsh / python3
    if (/python|node|deno|bun|ruby|perl|php|tcl|lua|bash|sh|zsh|fish|awk|sed|make/i.test(s)) return 'code';
    return 'text';
  }
  // YAML
  if (/^---\s*$/m.test(head)) return 'code';
  // JSON
  if (/^[\s]*[{\[]/.test(s)) return 'code';
  // XML
  if (/^<\?xml|^\s*<[a-zA-Z]/.test(s)) return 'code';
  // Markdown (起始行 # / ## 或 > )
  if (/^#{1,6}\s+\S|^>\s+\S/m.test(head)) return 'markdown';
  return 'text';
}

type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'font' | 'archive' | 'docx' | 'xlsx' | 'pptx' | 'rtf' | 'markdown' | 'code' | 'text' | 'unsupported';

/**
 * @param name 文件名 (含扩展名), 例如 "README.md" / "Makefile" / "foo.PDF"
 * @param head  可选 — 文件前 4KB (utf-8 字符串), 用于无扩展名嗅探
 */
function detectKind(name: string, head?: string): PreviewKind {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (FONT_EXTS.has(ext)) return 'font';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (DOCX_EXTS.has(ext)) return 'docx';
  if (XLSX_EXTS.has(ext)) return 'xlsx';
  if (PPTX_EXTS.has(ext)) return 'pptx';
  if (RTF_EXTS.has(ext)) return 'rtf';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  // 无扩展名: filename override
  if (!ext) {
    const base = name.split('/').pop() ?? name;
    const override = FILENAME_OVERRIDES.get(base);
    if (override) return override;
    if (head !== undefined) return sniffKindFromText(head);
  }
  return 'unsupported';
}

function extOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';   // 无扩展名 / 隐藏文件 (.gitignore 走 override)
  return base.slice(dot).toLowerCase();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function PreviewPanel() {
  const preview = useFileStore((s) => s.previewState);
  const closePreview = useFileStore((s) => s.closePreview);
  const setPreviewLoading = useFileStore((s) => s.setPreviewLoading);
  const setPreviewData = useFileStore((s) => s.setPreviewData);
  const setPreviewError = useFileStore((s) => s.setPreviewError);
  const previewNavigate = useFileStore((s) => s.previewNavigate);
  const showToast = useFileStore((s) => s.showToast);
  const containerRef = useRef<HTMLDivElement>(null);

  const entry = preview?.entry ?? null;
  // kind: 文件名/扩展名直接嗅探; 无扩展名时若已加载到 text 则按 head 二次嗅探
  const kind: PreviewKind = (() => {
    if (!entry) return 'unsupported';
    const ext = entry.ext;
    const initial = detectKind(entry.name);
    if (initial !== 'unsupported' || ext) return initial;
    if (preview?.text !== null && preview?.text !== undefined) {
      return sniffKindFromText(preview.text.slice(0, 4096));
    }
    return 'unsupported';
  })();

  // 计算当前在同目录 entry 列表里的位置(用于位置指示 + 左右按钮的可见性)
  // getFilteredSortedEntries 是按当前 sort 顺序返回(就是 FileList 里看到的顺序)
  const navInfo = useMemo(() => {
    if (!entry) return null;
    const activePaneId = useLayoutStore.getState().activePaneId;
    if (!activePaneId) return null;
    const siblings = useFileStore.getState().getFilteredSortedEntries(activePaneId);
    // 预览只对文件开放,目录里不显示(对用户来说不可达)
    const fileSiblings = siblings.filter((e) => !e.isDirectory);
    if (fileSiblings.length === 0) return null;
    const idx = fileSiblings.findIndex((e) => e.path === entry.path);
    if (idx < 0) return null;
    return {
      index: idx,
      total: fileSiblings.length,
      canPrev: idx > 0,
      canNext: idx < fileSiblings.length - 1,
    };
  }, [entry]);

  // 加载内容(在 preview.loading 翻为 true / entry 变化时重跑)
  useEffect(() => {
    if (!entry || !preview) return;
    if (!preview.loading) return; // 已经有内容了
    if (preview.blobUrl !== null || preview.text !== null) return; // 已有缓存(blobUrl=null 表示未缓存,允许是空文本)

    // 目录不预览
    if (entry.isDirectory) {
      setPreviewError('不能预览文件夹');
      return;
    }

    const ext = entry.ext;
    // 首轮 kind 基于 filename 嗅探 — 用来决定 image / text 走哪个 fast-path
    const initialKind = detectKind(entry.name);
    let cancelled = false;

    const run = async () => {
      try {
        // 图片 / 视频 / 音频 / PDF / 字体 / 压缩包 → 走 binary 路径(blob URL)
        if (
          initialKind === 'image' ||
          initialKind === 'video' ||
          initialKind === 'audio' ||
          initialKind === 'pdf' ||
          initialKind === 'font' ||
          initialKind === 'archive' ||
          initialKind === 'docx' ||
          initialKind === 'xlsx' ||
          initialKind === 'pptx' ||
          initialKind === 'rtf'
        ) {
          const maxBytes =
            initialKind === 'image' ? IMAGE_MAX_BYTES
            : initialKind === 'pdf' ? PDF_MAX_BYTES
            : initialKind === 'font' ? FONT_MAX_BYTES
            : initialKind === 'archive' ? ARCHIVE_MAX_BYTES
            : initialKind === 'docx' ? DOCX_MAX_BYTES
            : initialKind === 'xlsx' ? XLSX_MAX_BYTES
            : initialKind === 'pptx' ? PPTX_MAX_BYTES
            : initialKind === 'rtf' ? DOCX_MAX_BYTES
            : MEDIA_MAX_BYTES;
          if (entry.size > maxBytes) {
            const label =
              initialKind === 'image' ? '图片'
              : initialKind === 'video' ? '视频'
              : initialKind === 'audio' ? '音频'
              : initialKind === 'font' ? '字体'
              : initialKind === 'archive' ? '压缩包'
              : initialKind === 'docx' ? 'Word 文档'
              : initialKind === 'xlsx' ? 'Excel 表格'
              : initialKind === 'pptx' ? 'PowerPoint 演示'
              : initialKind === 'rtf' ? 'RTF 文档'
              : 'PDF';
            setPreviewError(
              `${label}过大 (${formatSize(entry.size)}),无法预览(>${formatSize(maxBytes)} 拒绝加载)。`,
            );
            return;
          }
          const res = await window.tabula.fs.readFile(entry.path, 'binary');
          if (cancelled) return;
          if (!res.ok) {
            setPreviewError(res.error.message);
            showToast(`预览失败: ${res.error.message}`, 'error', 3500);
            return;
          }
          const ab = res.data as ArrayBuffer;
          const mime = mimeFromExt(ext);
          const blob = new Blob([ab], { type: mime });
          const url = URL.createObjectURL(blob);
          setPreviewData({ blobUrl: url });
          return;
        }

        // 文本 / 代码 / Markdown / 无扩展名嗅探:读 utf-8
        if (entry.size > TEXT_TRUNCATE_BYTES * 5) {
          setPreviewError(
            `文件过大 (${formatSize(entry.size)}),无法预览。`,
          );
          showToast(`预览失败: 文件过大`, 'error', 3500);
          return;
        }
        const res = await window.tabula.fs.readFile(entry.path, 'utf-8');
        if (cancelled) return;
        if (!res.ok) {
          setPreviewError(res.error.message);
          showToast(`预览失败: ${res.error.message}`, 'error', 3500);
          return;
        }
        const text = res.data as string;

        // 无扩展名 (initialKind='unsupported' 且 ext 为空) → 读 head 嗅探
        const finalKind = initialKind === 'unsupported' && !ext
          ? sniffKindFromText(text.slice(0, 4096))
          : initialKind;
        if (finalKind === 'unsupported') {
          setPreviewLoading(false);
          return;
        }

        const allLines = text.split(/\r?\n/);
        const truncated = entry.size > TEXT_TRUNCATE_BYTES;
        const showLines = truncated ? allLines.slice(0, TEXT_TRUNCATE_LINES) : allLines;
        const displayText = showLines.join('\n');
        setPreviewData({
          text: displayText,
          truncated,
          totalLines: allLines.length,
        });
      } catch (e) {
        if (cancelled) return;
        setPreviewError(String(e));
        showToast(`预览失败: ${String(e)}`, 'error', 3500);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.path, entry?.mtime, entry?.size, preview?.loading]);

  // Esc 关闭 / ←/→ 切换同目录文件
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closePreview();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        previewNavigate(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        previewNavigate(1);
        return;
      }
    };
    // 用 capture 确保在 App.tsx 全局监听之前先收到
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [preview, closePreview, previewNavigate]);

  // 自动 focus
  useEffect(() => {
    if (preview) containerRef.current?.focus();
  }, [preview]);

  if (!preview || !entry) return null;

  return (
    <div
      className="preview-overlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePreview();
      }}
    >
      <div className="preview-panel" ref={containerRef} tabIndex={-1}>
        <div className="preview-header">
          <div className="preview-title">
            <span className="preview-icon">{
              kind === 'image' ? '🖼'
              : kind === 'video' ? '🎬'
              : kind === 'audio' ? '🎵'
              : kind === 'pdf' ? '📕'
              : kind === 'font' ? '🅰'
              : kind === 'archive' ? '🗜'
              : kind === 'docx' ? '📄'
              : kind === 'xlsx' ? '📊'
              : kind === 'pptx' ? '🎞'
              : kind === 'rtf' ? '📰'
              : kind === 'markdown' ? '📝'
              : kind === 'code' ? '📜'
              : '📄'
            }</span>
            <span className="preview-filename" title={entry.path}>{entry.name}</span>
            <span className="preview-meta">
              {formatSize(entry.size)} · {formatDate(entry.mtime)} · {entry.ext || '文件'}
            </span>
            {navInfo && navInfo.total > 1 && (
              <span className="preview-position" title="同目录位置">
                {navInfo.index + 1} / {navInfo.total}
              </span>
            )}
          </div>
          <div className="preview-header-actions">
            {navInfo && (navInfo.canPrev || navInfo.canNext) && (
              <>
                <button
                  className="preview-nav preview-nav-prev"
                  onClick={() => previewNavigate(-1)}
                  disabled={!navInfo.canPrev}
                  title="上一个 (←)"
                  aria-label="上一个文件"
                >
                  ‹
                </button>
                <button
                  className="preview-nav preview-nav-next"
                  onClick={() => previewNavigate(1)}
                  disabled={!navInfo.canNext}
                  title="下一个 (→)"
                  aria-label="下一个文件"
                >
                  ›
                </button>
              </>
            )}
            <button
              className="preview-close"
              onClick={closePreview}
              title="关闭 (Esc)"
              aria-label="关闭预览"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="preview-body">
          {navInfo && navInfo.canPrev && (
            <button
              className="preview-fab preview-fab-prev"
              onClick={() => previewNavigate(-1)}
              title="上一个 (←)"
              aria-label="上一个文件"
            >
              ‹
            </button>
          )}
          {navInfo && navInfo.canNext && (
            <button
              className="preview-fab preview-fab-next"
              onClick={() => previewNavigate(1)}
              title="下一个 (→)"
              aria-label="下一个文件"
            >
              ›
            </button>
          )}
          {preview.loading && !preview.error && (
            <div className="preview-loading">
              <div className="loading-spinner" />
              <div>加载中…</div>
            </div>
          )}

          {preview.error && (
            <div className="preview-error">
              <div className="error-icon">⚠</div>
              <div className="error-message">{preview.error}</div>
              <div className="preview-error-meta">
                路径: <code>{entry.path}</code>
                <br />
                大小: {formatSize(entry.size)} · 修改时间: {formatDate(entry.mtime)}
              </div>
            </div>
          )}

          {!preview.error && !preview.loading && (
            <>
              {kind === 'image' && preview.blobUrl && (
                <div className="preview-image-wrap">
                  <img
                    className="preview-image"
                    src={preview.blobUrl}
                    alt={entry.name}
                    draggable={false}
                  />
                </div>
              )}
              {kind === 'pdf' && preview.blobUrl && (
                <PdfView url={preview.blobUrl} />
              )}
              {kind === 'font' && preview.blobUrl && (
                <FontView url={preview.blobUrl} name={entry.name} />
              )}
              {kind === 'archive' && preview.blobUrl && (
                <ArchiveView url={preview.blobUrl} name={entry.name} ext={entry.ext} />
              )}
              {kind === 'docx' && preview.blobUrl && (
                <DocxView url={preview.blobUrl} />
              )}
              {kind === 'xlsx' && preview.blobUrl && (
                <XlsxView url={preview.blobUrl} ext={entry.ext} />
              )}
              {kind === 'pptx' && preview.blobUrl && (
                <PptxView url={preview.blobUrl} />
              )}
              {kind === 'rtf' && preview.blobUrl && (
                <RtfView url={preview.blobUrl} />
              )}
              {kind === 'video' && preview.blobUrl && (
                <MediaView url={preview.blobUrl} kind="video" />
              )}
              {kind === 'audio' && preview.blobUrl && (
                <MediaView url={preview.blobUrl} kind="audio" />
              )}
              {kind === 'markdown' && preview.text !== null && (
                <MarkdownView text={preview.text} />
              )}
              {(kind === 'code' || kind === 'text') && preview.text !== null && (
                <TextWithLineNumbers text={preview.text} />
              )}
              {kind === 'unsupported' && (
                <div className="preview-unsupported">
                  <div className="unsupported-icon">🚫</div>
                  <div className="unsupported-title">此文件类型暂不支持预览</div>
                  <div className="preview-error-meta">
                    扩展名: <code>{entry.ext || '(无)'}</code>
                    <br />
                    大小: {formatSize(entry.size)} · 修改时间: {formatDate(entry.mtime)}
                    <br />
                    路径: <code>{entry.path}</code>
                  </div>
                </div>
              )}
            </>
          )}

          {preview.truncated && (
            <div className="preview-truncated-banner">
              ⚠ 文件过大,仅显示前 {TEXT_TRUNCATE_LINES} 行(共 {preview.totalLines} 行)
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// =================== 视频/音频 (MediaView) ===================

/**
 * 视频/音频统一组件. 监听 loadedmetadata 拿时长 + 视频分辨率 + 编码信息,
 * 显示在播放器上方 toolbar. 0 依赖 (用 HTMLVideoElement / HTMLAudioElement API).
 */
function MediaView({ url, kind }: { url: string; kind: 'video' | 'audio' }) {
  const ref = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [meta, setMeta] = useState<{
    duration?: number;
    width?: number;
    height?: number;
  }>({});

  useEffect(() => {
    setMeta({});
  }, [url]);

  const onLoaded = () => {
    const el = ref.current;
    if (!el) return;
    const next: typeof meta = { duration: Number.isFinite(el.duration) ? el.duration : undefined };
    if (kind === 'video' && el instanceof HTMLVideoElement) {
      next.width = el.videoWidth;
      next.height = el.videoHeight;
    }
    setMeta(next);
  };

  const onError = () => {
    setMeta({}); // 元信息拿不到, 隐藏
  };

  return (
    <div className="preview-media-wrap">
      <div className="preview-media-meta">
        {meta.duration !== undefined && (
          <span className="preview-media-stat">
            ⏱ {formatDuration(meta.duration)}
          </span>
        )}
        {kind === 'video' && meta.width && meta.height && (
          <span className="preview-media-stat">
            📐 {meta.width}×{meta.height}
          </span>
        )}
        {kind === 'video' && meta.width && meta.height && meta.duration && (
          <span className="preview-media-stat preview-media-stat-dim">
            ≈ {(meta.width * meta.height / 1_000_000 * meta.duration * 0.3 / 8).toFixed(1)} MB (估)
          </span>
        )}
      </div>
      {kind === 'video' ? (
        <video
          ref={ref as React.RefObject<HTMLVideoElement>}
          className="preview-video"
          src={url}
          controls
          autoPlay={false}
          preload="metadata"
          onLoadedMetadata={onLoaded}
          onError={onError}
        />
      ) : (
        <audio
          ref={ref as React.RefObject<HTMLAudioElement>}
          className="preview-audio"
          src={url}
          controls
          preload="metadata"
          onLoadedMetadata={onLoaded}
          onError={onError}
        />
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// =================== RTF 文档 ===================

/**
 * 用 @iarna/rtf-to-html 把 RTF 转 HTML 渲染. dynamic import (~30KB).
 * 限制: 嵌入图/复杂表格/页眉页脚 不可见 (rtf-to-html 局限).
 */
function RtfView({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        // rtf-to-html 期望 string/Buffer, 用 TextDecoder 把 ArrayBuffer 转 str
        const str = new TextDecoder('utf-8').decode(new Uint8Array(ab));
        const { default: rtfToHtml } = await import('@iarna/rtf-to-html');
        const result = await rtfToHtml.fromString(str, (err: Error) => { /* 收集 warn */ });
        if (cancelled) return;
        setHtml(result);
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="preview-error">
        <div className="error-icon">⚠</div>
        <div className="error-message">RTF 解析失败: {error}</div>
      </div>
    );
  }
  if (html === null) {
    return <div className="preview-loading"><div className="loading-spinner" /><div>解析中…</div></div>;
  }
  return (
    <div
      className="preview-rtf-wrap"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// =================== Excel 表格 (xlsx) ===================

interface XlsxSheet {
  name: string;
  /** 单元格值 (text / number / boolean), 长度 = 行数, 内部数组 = 列 */
  rows: (string | number | boolean | null)[][];
  /** 合并单元格范围 (例如 'A1:B2') — 简单显示, 不做合并渲染 */
  merges: string[];
}

/**
 * 用 SheetJS (xlsx) 解析 .xlsx/.xls/.ods. 抽取每个 sheet 的二维数据.
 * dynamic import (懒加载, ~150KB).
 * 限制: 单元格格式 (颜色/字体/边框) 全部丢失, 只显示值; 不渲染图表/pivot table.
 */
function XlsxView({ url, ext }: { url: string; ext: string }) {
  const [sheets, setSheets] = useState<XlsxSheet[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSheets(null);
    setActiveIdx(0);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        const XLSX = (await import('xlsx')).default;
        const wb = XLSX.read(ab, { type: 'array', cellDates: true });
        const parsed: XlsxSheet[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          // sheet_to_json 拿二维数组 (header:1 → 每行是 array)
          const rawRows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, {
            header: 1,
            defval: null,
            blankrows: false,
            raw: false,
          });
          // 截断超大表格 (避免渲染卡死)
          const MAX_ROWS = 5000;
          const truncated = rawRows.length > MAX_ROWS;
          const rows = truncated ? rawRows.slice(0, MAX_ROWS) : rawRows;
          return {
            name,
            rows,
            merges: ws['!merges']?.map((m) => `${XLSX.utils.encode_cell(m.s)}:${XLSX.utils.encode_cell(m.e)}`) ?? [],
            _truncated: truncated,
          } as XlsxSheet & { _truncated?: boolean };
        });
        if (cancelled) return;
        setSheets(parsed);
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [url, ext]);

  if (error) {
    return (
      <div className="preview-error">
        <div className="error-icon">⚠</div>
        <div className="error-message">xlsx 解析失败: {error}</div>
        <div className="preview-error-meta">支持格式: xlsx, xls, xlsm, xlsb, ods, csv</div>
      </div>
    );
  }
  if (sheets === null) {
    return <div className="preview-loading"><div className="loading-spinner" /><div>解析中…</div></div>;
  }
  if (sheets.length === 0) {
    return <div className="preview-loading"><div>空工作簿</div></div>;
  }

  const active = sheets[activeIdx] ?? sheets[0];

  return (
    <div className="preview-xlsx-wrap">
      {sheets.length > 1 && (
        <div className="preview-xlsx-tabs">
          {sheets.map((s, i) => (
            <button
              key={i}
              className={`preview-xlsx-tab ${i === activeIdx ? 'is-active' : ''}`}
              onClick={() => setActiveIdx(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div className="preview-xlsx-meta">
        {active.name} · {active.rows.length} 行 × {active.rows[0]?.length ?? 0} 列
        {(active as XlsxSheet & { _truncated?: boolean })._truncated && (
          <span className="preview-xlsx-trunc"> · 已截断到前 5000 行</span>
        )}
      </div>
      <div className="preview-xlsx-table-wrap">
        <table className="preview-xlsx-table">
          <tbody>
            {active.rows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className={typeof cell === 'number' ? 'is-num' : ''}>
                    {cell === null ? '' : String(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// =================== PowerPoint 演示 (pptx) ===================

interface PptxSlide {
  index: number;
  title: string;
  /** 段落文本 (按出现顺序) */
  paragraphs: string[];
}

/**
 * 简易 pptx 解析: 用 JSZip 解 pptx (本身是 zip), 遍历 ppt/slides/slide*.xml
 * 抽 <a:t> 文本节点. 0 渲染 (不解析版式/动画/图片/母版), 仅文本 + slide 切换.
 * dynamic import (懒加载, JSZip ~95KB).
 */
async function parsePptx(ab: ArrayBuffer): Promise<PptxSlide[]> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(ab);
  const slideFiles = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return na - nb;
    });
  const slides: PptxSlide[] = [];
  for (const path of slideFiles) {
    const xml = await zip.files[path].async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, 'application/xml');
    const texts = Array.from(doc.querySelectorAll('a\\:t, t')).map((n) => n.textContent ?? '');
    const paragraphs = texts
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const title = paragraphs[0] ?? `Slide ${slideFiles.indexOf(path) + 1}`;
    slides.push({
      index: slideFiles.indexOf(path) + 1,
      title,
      paragraphs,
    });
  }
  return slides;
}

function PptxView({ url }: { url: string }) {
  const [slides, setSlides] = useState<PptxSlide[] | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSlides(null);
    setActiveIdx(0);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        const result = await parsePptx(ab);
        if (cancelled) return;
        setSlides(result);
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="preview-error">
        <div className="error-icon">⚠</div>
        <div className="error-message">pptx 解析失败: {error}</div>
        <div className="preview-error-meta">当前仅提取文本 + slide 切换, 不渲染版式/动画/图片/母版</div>
      </div>
    );
  }
  if (slides === null) {
    return <div className="preview-loading"><div className="loading-spinner" /><div>解析中…</div></div>;
  }
  if (slides.length === 0) {
    return <div className="preview-loading"><div>空演示文稿 (无 slide)</div></div>;
  }

  const active = slides[activeIdx];

  return (
    <div className="preview-pptx-wrap">
      {slides.length > 1 && (
        <div className="preview-pptx-thumbs">
          {slides.map((s, i) => (
            <button
              key={i}
              className={`preview-pptx-thumb ${i === activeIdx ? 'is-active' : ''}`}
              onClick={() => setActiveIdx(i)}
            >
              <div className="preview-pptx-thumb-num">{i + 1}</div>
              <div className="preview-pptx-thumb-title">{s.title}</div>
            </button>
          ))}
        </div>
      )}
      <div className="preview-pptx-meta">
        {active.title} · {activeIdx + 1} / {slides.length}
      </div>
      <div className="preview-pptx-slide">
        {active.paragraphs.map((p, i) => (
          <p key={i} className={i === 0 ? 'is-title' : 'is-body'}>{p}</p>
        ))}
      </div>
    </div>
  );
}

// =================== Office 文档 (docx) ===================

/**
 * docx 走 mammoth.js 转 HTML 渲染. dynamic import 仅在打开 docx 时下载 chunk.
 * mammoth 转换结果含基础 inline 样式, 配 preview-docx-wrap 容器样式覆盖.
 * 注意: 嵌入图片/复杂表格/页眉页脚 不可见 (mammoth 局限).
 */
function DocxView({ url }: { url: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        const mammoth = (await import('mammoth')).default;
        const result = await mammoth.convertToHtml({ arrayBuffer: ab });
        if (cancelled) return;
        setHtml(result.value);
        if (result.messages.length > 0) {
          console.warn('[DocxView] mammoth warnings:', result.messages);
        }
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) {
    return (
      <div className="preview-error">
        <div className="error-icon">⚠</div>
        <div className="error-message">docx 解析失败: {error}</div>
      </div>
    );
  }
  if (html === null) {
    return <div className="preview-loading"><div className="loading-spinner" /><div>解析中…</div></div>;
  }
  return (
    <div
      className="preview-docx-wrap"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// =================== 压缩包列表 ===================

/** fflate 解析后的统一 entry 形态 */
interface ArchiveEntry {
  name: string;
  size: number;
  isDir: boolean;
  /** 文本文件前 8KB (仅 zip 内嵌纯文本时填充, 二进制/null) */
  preview?: string | null;
}

function formatArchiveSize(n: number): string {
  if (n === 0) return '0';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const TEXT_PREVIEW_EXTS = new Set([
  '.txt', '.md', '.json', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.tsx', '.jsx',
  '.yml', '.yaml', '.toml', '.ini', '.conf', '.env', '.csv', '.tsv', '.log', '.sh', '.bash',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.lua', '.sql',
  '.gitignore', '.dockerignore', '.editorconfig', '.properties',
]);

/**
 * 解析 zip: fflate 的 unzipSync 返回 { [name]: Unzipped }
 * 解析 tar: fflate 的 unzipTarSync 接受 Uint8Array 返回 { [name]: Unzipped }
 *   (fflate 把 tar 当 zip-without-compression 处理, 复用同一 API)
 * 解析 gz: fflate 自身不直接解压, 但 .tar.gz = .tgz 可走 tar 路径 (流式).
 *   单 .gz 文件 (非 tar 容器) 仅显示 "file size + extracted" 占位.
 */
async function parseArchive(ab: ArrayBuffer, ext: string): Promise<ArchiveEntry[]> {
  const { unzipSync, strFromU8 } = await import('fflate');
  // tar/tgz 复用 unzip 接口 (fflate 设计)
  const raw = new Uint8Array(ab);
  let unzipped: Record<string, { name: string; data?: Uint8Array }> = {};
  try {
    if (ext === '.gz' && !ext.includes('tar')) {
      // 单 .gz 不是容器, 只显示 1 个 entry
      return [{ name: nameFromGz(ab), size: ab.byteLength, isDir: false, preview: null }];
    }
    // zip / tar / tgz 都走 unzipSync
    if (ext === '.7z' || ext === '.rar') {
      unzipped = {}; // fflate 不支持 7z/rar
    } else {
      unzipped = unzipSync(raw) as unknown as Record<string, { name: string; data?: Uint8Array }>;
    }
  } catch (err) {
    throw new Error(`压缩包解析失败: ${(err as Error).message}`);
  }

  const entries: ArchiveEntry[] = [];
  for (const [name, val] of Object.entries(unzipped)) {
    const isDir = name.endsWith('/') || val.name.endsWith('/');
    const data = val.data;
    const size = data ? data.byteLength : 0;
    let preview: string | null = null;
    if (data && !isDir && size < 8 * 1024) {
      // 文本类: 8KB 内解码作预览
      const ext2 = name.toLowerCase().includes('.') ? `.${name.split('.').pop()!.toLowerCase()}` : '';
      if (TEXT_PREVIEW_EXTS.has(ext2) || (data.byteLength < 2048 && /^[\x09\x0a\x0d\x20-\x7e]*$/.test(strFromU8(data.slice(0, 256))))) {
        try {
          preview = strFromU8(data.slice(0, 8 * 1024));
        } catch { /* keep null */ }
      }
    }
    entries.push({ name, size, isDir, preview });
  }
  // 排序: 目录在前 (按字母), 文件在后
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

function nameFromGz(ab: ArrayBuffer): string {
  // 从 .gz 头取原文件名 (RFC 1952 FNAME 字段)
  const bytes = new Uint8Array(ab);
  let i = 10; // 跳过 GZ magic(2) + method(1) + flags(1) + mtime(4) + xfl(1) + os(1)
  if (bytes.length > i + 2 && (bytes[3] & 0x04)) { // FNAME flag
    const start = i;
    while (i < bytes.length && bytes[i] !== 0) i++;
    return new TextDecoder().decode(bytes.slice(start, i)) || 'decompressed.bin';
  }
  return 'decompressed.bin';
}

function ArchiveView({ url, name, ext }: { url: string; name: string; ext: string }) {
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(url);
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        const result = await parseArchive(ab, ext);
        if (cancelled) return;
        setEntries(result);
      } catch (err) {
        if (!cancelled) setError(String((err as Error).message ?? err));
      }
    })();
    return () => { cancelled = true; };
  }, [url, ext]);

  if (error) {
    return (
      <div className="preview-error">
        <div className="error-icon">⚠</div>
        <div className="error-message">压缩包解析失败: {error}</div>
        <div className="preview-error-meta">
          {ext === '.7z' || ext === '.rar'
            ? <span>当前不支持 7z / rar 格式 (fflate 不支持)</span>
            : null}
        </div>
      </div>
    );
  }
  if (entries === null) {
    return <div className="preview-loading"><div className="loading-spinner" /><div>解压中…</div></div>;
  }

  const dirCount = entries.filter((e) => e.isDir).length;
  const fileCount = entries.length - dirCount;

  return (
    <div className="preview-archive-wrap">
      <div className="preview-archive-summary">
        <strong>{name}</strong>
        <span> · {entries.length} 项 ({dirCount} 目录 / {fileCount} 文件)</span>
      </div>
      <div className="preview-archive-list">
        {entries.map((e, i) => (
          <div key={i} className={`preview-archive-row ${e.isDir ? 'is-dir' : ''}`}>
            <span className="preview-archive-icon">{e.isDir ? '📁' : '📄'}</span>
            <span className="preview-archive-name" title={e.name}>{e.name}</span>
            <span className="preview-archive-size">{e.isDir ? '—' : formatArchiveSize(e.size)}</span>
            {e.preview !== undefined && e.preview !== null && (
              <pre className="preview-archive-preview">{e.preview}{e.preview.length >= 8 * 1024 ? '\n…' : ''}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// =================== 字体预览 ===================

/**
 * 用 @font-face 加载字体 + 渲染 3 个 size × 3 段 sample (含 ASCII/中文/pangram).
 * 0 依赖, 直接 ObjectURL + document.fonts API.
 */
function FontView({ url, name }: { url: string; name: string }) {
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');
  // 字体用 base name 作 fontFamily 后缀 (避免同名冲突)
  const family = `preview-${name.replace(/[^a-zA-Z0-9]/g, '-')}`;

  useEffect(() => {
    let cancelled = false;
    const font = new FontFace(family, `url(${url})`);
    font
      .load()
      .then((loaded) => {
        if (cancelled) return;
        document.fonts.add(loaded);
        setLoadState('loaded');
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState('error');
      });
    return () => {
      cancelled = true;
      // 不删除 document.fonts 中的字体 — 重新打开时 add 同一个会忽略
    };
  }, [url, family]);

  return (
    <div className="preview-font-wrap">
      <div className="preview-font-meta">
        {name}
        {loadState === 'loading' && <span className="preview-font-status"> 加载中…</span>}
        {loadState === 'error' && <span className="preview-font-status preview-font-status-err"> 加载失败 (格式不受支持?)</span>}
      </div>
      <div
        className="preview-font-samples"
        style={{ fontFamily: loadState === 'loaded' ? `"${family}", sans-serif` : 'sans-serif' }}
      >
        <div className="preview-font-row">
          <span className="preview-font-size">48px</span>
          <span className="preview-font-text">AaBbCc 0123</span>
        </div>
        <div className="preview-font-row">
          <span className="preview-font-size">24px</span>
          <span className="preview-font-text">The quick brown fox jumps over the lazy dog.</span>
        </div>
        <div className="preview-font-row">
          <span className="preview-font-size">16px</span>
          <span className="preview-font-text">中文字体预览 — Tabula 文件管理器</span>
        </div>
      </div>
    </div>
  );
}

// =================== PDF 渲染 (PDF.js) ===================

/**
 * 用 PDF.js 渲染 PDF 当前页到 canvas. 支持翻页 (← →) + 滚轮缩放.
 * PDF.js 包大 (~1.5MB), 通过 dynamic import 仅在打开 PDF 时下载 chunk.
 */
function PdfView({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pdfDoc, setPdfDoc] = useState<unknown | null>(null); // PDFDocumentProxy 类型绕开 import 链
  const [pageNum, setPageNum] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  // 加载 PDF (只跑一次, 换 url 时重置)
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setPdfDoc(null);
    setPageNum(1);
    setTotalPages(0);
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        // worker URL: Vite 5+ 静态资源处理
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url,
        ).toString();
        const loadingTask = pdfjs.getDocument(url);
        const doc = await loadingTask.promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  // 渲染当前页
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    let cancelled = false;
    setRendering(true);
    void (async () => {
      try {
        // pdfjs-dist v4 API
        const pdfjs = await import('pdfjs-dist');
        const page = await (pdfDoc as { getPage: (n: number) => Promise<unknown> }).getPage(pageNum);
        const viewport = (page as { getViewport: (s: { scale: number }) => { width: number; height: number } }).getViewport({ scale });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await (page as { render: (p: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> } }).render({
          canvasContext: ctx,
          viewport,
        }).promise;
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      } finally {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pageNum, scale]);

  // 键盘翻页 (preview 已 capture, 这里额外绑一份保险)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pdfDoc) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setPageNum((p) => Math.max(1, p - 1));
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        // Space 在 preview 全局已被 closePreview 拦截, 这里不阻止
        e.preventDefault();
        setPageNum((p) => Math.min(totalPages, p + 1));
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setScale((s) => Math.min(3, s + 0.25));
      } else if (e.key === '-') {
        e.preventDefault();
        setScale((s) => Math.max(0.5, s - 0.25));
      } else if (e.key === '0') {
        e.preventDefault();
        setScale(1.0);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [pdfDoc, totalPages]);

  return (
    <div className="preview-pdf-wrap">
      <div className="preview-pdf-toolbar">
        <button
          className="preview-pdf-btn"
          onClick={() => setPageNum((p) => Math.max(1, p - 1))}
          disabled={pageNum <= 1}
          title="上一页 (←)"
        >‹</button>
        <span className="preview-pdf-pageinfo">
          {pageNum} / {totalPages}
        </span>
        <button
          className="preview-pdf-btn"
          onClick={() => setPageNum((p) => Math.min(totalPages, p + 1))}
          disabled={pageNum >= totalPages}
          title="下一页 (→)"
        >›</button>
        <span className="preview-pdf-sep" />
        <button
          className="preview-pdf-btn"
          onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
          title="缩小 (-)"
        >−</button>
        <span className="preview-pdf-pageinfo">{Math.round(scale * 100)}%</span>
        <button
          className="preview-pdf-btn"
          onClick={() => setScale((s) => Math.min(3, s + 0.25))}
          title="放大 (+)"
        >+</button>
        <button
          className="preview-pdf-btn"
          onClick={() => setScale(1.0)}
          title="重置缩放 (0)"
        >100%</button>
      </div>
      <div className="preview-pdf-canvas-wrap">
        {loadError ? (
          <div className="preview-error">
            <div className="error-icon">⚠</div>
            <div className="error-message">PDF 加载失败: {loadError}</div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className={`preview-pdf-canvas ${rendering ? 'is-rendering' : ''}`}
          />
        )}
      </div>
    </div>
  );
}

// =================== Markdown 渲染 ===================

function MarkdownView({ text }: { text: string }) {
  // 配置 marked:代码块走 highlight.js
  const html = useMemo(() => {
    marked.setOptions({
      gfm: true,
      breaks: true,
    });
    // 拦截 code 节点做高亮
    const renderer = new marked.Renderer();
    renderer.code = (codeObj: { text: string; lang?: string; escaped?: boolean }) => {
      const code = typeof codeObj === 'string' ? codeObj : codeObj.text;
      const lang = typeof codeObj === 'string' ? '' : (codeObj.lang ?? '');
      let highlighted = escapeHtml(code);
      if (lang && hljs.getLanguage(lang)) {
        try {
          highlighted = hljs.highlight(code, { language: lang }).value;
        } catch {
          /* noop */
        }
      } else {
        try {
          highlighted = hljs.highlightAuto(code).value;
        } catch {
          /* noop */
        }
      }
      const langClass = lang ? ` class="language-${escapeHtml(lang)} hljs"` : ' class="hljs"';
      return `<pre><code${langClass}>${highlighted}</code></pre>`;
    };
    return marked.parse(text, { renderer, async: false }) as string;
  }, [text]);

  return (
    <div
      className="preview-markdown"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// =================== 文本 / 代码:行号 ===================

function TextWithLineNumbers({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  // 末行如果是空字符串(text 以 \n 结尾),不显示行号(N 行 → N 个行号)
  const display = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  return (
    <div className="preview-textview">
      <div className="preview-linenums" aria-hidden>
        {display.map((_, i) => (
          <div key={i} className="preview-linenum">{i + 1}</div>
        ))}
      </div>
      <pre className="preview-text">
        {display.map((line, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <div key={i} className="preview-textline">{line || ' '}</div>
        ))}
      </pre>
    </div>
  );
}

// =================== 工具 ===================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.bmp':
      return 'image/bmp';
    case '.ico':
      return 'image/x-icon';
    case '.heic':
      return 'image/heic';
    case '.avif':
      return 'image/avif';
    case '.tiff':
    case '.tif':
      return 'image/tiff';
    case '.psd':
      return 'image/vnd.adobe.photoshop';
    case '.raw':
      return 'image/raw';
    case '.pdf':
      return 'application/pdf';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    // Archives (binary; previewed via ArchiveView, not <video>/<img>)
    case '.zip':
      return 'application/zip';
    case '.tar':
      return 'application/x-tar';
    case '.tgz':
    case '.gz':
      return 'application/gzip';
    case '.bz2':
      return 'application/x-bzip2';
    case '.7z':
      return 'application/x-7z-compressed';
    case '.rar':
      return 'application/vnd.rar';
    case '.docx':
    case '.dotx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
    case '.xlsm':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.xlsb':
      return 'application/vnd.ms-excel.sheet.binary.macroEnabled.12';
    case '.ods':
      return 'application/vnd.oasis.opendocument.spreadsheet';
    case '.csv':
      return 'text/csv';
    case '.pptx':
    case '.ppt':
    case '.odp':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.rtf':
      return 'application/rtf';
    // Video
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.mkv':
    case '.avi':
    case '.wmv':
    case '.flv':
      return 'video/x-matroska';
    case '.ogv':
      return 'video/ogg';
    // Audio
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
    case '.aac':
      return 'audio/aac';
    case '.wav':
      return 'audio/wav';
    case '.flac':
      return 'audio/flac';
    case '.ogg':
    case '.oga':
    case '.opus':
      return 'audio/ogg';
    case '.wma':
      return 'audio/x-ms-wma';
    default:
      return 'application/octet-stream';
  }
}
