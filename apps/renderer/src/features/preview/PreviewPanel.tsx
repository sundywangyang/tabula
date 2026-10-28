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
import 'highlight.js/styles/atom-one-dark.css';
import { useFileStore } from '../../stores/file-store';
import { useLayoutStore } from '../../stores/layout-store';
import './PreviewPanel.css';
import {
  TEXT_TRUNCATE_BYTES,
  TEXT_TRUNCATE_LINES,
  IMAGE_MAX_BYTES,
  MEDIA_MAX_BYTES,
  PDF_MAX_BYTES,
  FONT_MAX_BYTES,
  ARCHIVE_MAX_BYTES,
  DOCX_MAX_BYTES,
  XLSX_MAX_BYTES,
  PPTX_MAX_BYTES,
  sniffKindFromText,
  detectKind,
  suggestConversionFor,
  mimeFromExt,
} from './preview-formats';
import type { PreviewKind } from './preview-formats';
import { MediaView } from './views/MediaView';
import { XlsxView, PptxView, DocxView } from './views/OfficeViews';
import { RtfView, MarkdownView, TextWithLineNumbers } from './views/TextViews';
import { ArchiveView } from './views/ArchiveView';
import { FontView } from './views/FontView';
export { parseArchive } from './views/ArchiveView';

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
        if (initialKind === 'rtf') {
          const result = await window.tabula.fs.readRtf(entry.path);
          if (cancelled) return;
          if (!result.ok) setPreviewError(result.error.message);
          else setPreviewData({ text: result.data });
          return;
        }
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
          initialKind === 'pptx'
        ) {
          const maxBytes =
            initialKind === 'image' ? IMAGE_MAX_BYTES
              : initialKind === 'pdf' ? PDF_MAX_BYTES
                : initialKind === 'font' ? FONT_MAX_BYTES
                  : initialKind === 'archive' ? ARCHIVE_MAX_BYTES
                    : initialKind === 'docx' ? DOCX_MAX_BYTES
                      : initialKind === 'xlsx' ? XLSX_MAX_BYTES
                        : initialKind === 'pptx' ? PPTX_MAX_BYTES
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
              {kind === 'rtf' && preview.text !== null && (
                <RtfView html={preview.text} />
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
                    {suggestConversionFor(entry.ext) && (
                      <div className="preview-error-hint">
                        💡 提示: {suggestConversionFor(entry.ext)}
                      </div>
                    )}
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
function PdfView({ url }: { url: string; }) {
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
        const page = await (pdfDoc as { getPage: (n: number) => Promise<unknown>; }).getPage(pageNum);
        const viewport = (page as { getViewport: (s: { scale: number; }) => { width: number; height: number; }; }).getViewport({ scale });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await (page as { render: (p: { canvasContext: CanvasRenderingContext2D; viewport: unknown; }) => { promise: Promise<void>; }; }).render({
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
