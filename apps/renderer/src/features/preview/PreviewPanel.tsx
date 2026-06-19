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

const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
  '.ico', '.heic', '.avif', '.tiff', '.tif', '.psd', '.raw',
]);
const PDF_EXTS = new Set(['.pdf']);
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

type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'code' | 'text' | 'unsupported';

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
        // 图片 / 视频 / 音频 / PDF → 走 binary 路径(blob URL)
        if (
          initialKind === 'image' ||
          initialKind === 'video' ||
          initialKind === 'audio' ||
          initialKind === 'pdf'
        ) {
          const maxBytes =
            initialKind === 'image' ? IMAGE_MAX_BYTES
            : initialKind === 'pdf' ? PDF_MAX_BYTES
            : MEDIA_MAX_BYTES;
          if (entry.size > maxBytes) {
            const label =
              initialKind === 'image' ? '图片'
              : initialKind === 'video' ? '视频'
              : initialKind === 'audio' ? '音频'
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
              {kind === 'video' && preview.blobUrl && (
                <div className="preview-media-wrap">
                  <video
                    className="preview-video"
                    src={preview.blobUrl}
                    controls
                    autoPlay={false}
                    preload="metadata"
                  />
                </div>
              )}
              {kind === 'audio' && preview.blobUrl && (
                <div className="preview-media-wrap">
                  <audio
                    className="preview-audio"
                    src={preview.blobUrl}
                    controls
                    preload="metadata"
                  />
                </div>
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
