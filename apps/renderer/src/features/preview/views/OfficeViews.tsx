import { useEffect, useState } from 'react';

// =================== Excel 表格 (xlsx) ===================

export interface XlsxSheet {
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
export function XlsxView({ url, ext }: { url: string; ext: string; }) {
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
          } as XlsxSheet & { _truncated?: boolean; };
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
        {(active as XlsxSheet & { _truncated?: boolean; })._truncated && (
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

export interface PptxSlide {
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
export async function parsePptx(ab: ArrayBuffer): Promise<PptxSlide[]> {
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

export function PptxView({ url }: { url: string; }) {
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
export function DocxView({ url }: { url: string; }) {
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
