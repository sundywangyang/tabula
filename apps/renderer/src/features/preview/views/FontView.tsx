import { useEffect, useState } from 'react';

// =================== 字体预览 ===================

/**
 * 用 @font-face 加载字体 + 渲染 3 个 size × 3 段 sample (含 ASCII/中文/pangram).
 * 0 依赖, 直接 ObjectURL + document.fonts API.
 */
export function FontView({ url, name }: { url: string; name: string; }) {
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
