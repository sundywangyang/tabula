import { useEffect, useRef, useState } from 'react';

// =================== 视频/音频 (MediaView) ===================

/**
 * 视频/音频统一组件.
 *  - 监听 loadedmetadata 拿时长 + 视频分辨率
 *  - 视频: canvas 抓第一帧 → 显示缩略图 (替代纯黑播放按钮)
 *  - 音频: Web Audio API decodeAudioData → 画波形图
 *  0 依赖, 全用浏览器原生 API.
 */
export function MediaView({ url, kind }: { url: string; kind: 'video' | 'audio'; }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [meta, setMeta] = useState<{
    duration?: number;
    width?: number;
    height?: number;
  }>({});
  const [thumbDataUrl, setThumbDataUrl] = useState<string | null>(null);
  const [waveformState, setWaveformState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  // 重置状态
  useEffect(() => {
    setMeta({});
    setThumbDataUrl(null);
    setWaveformState('idle');
  }, [url]);

  // 视频: metadata 加载后, 抓第一帧缩略图
  useEffect(() => {
    if (kind !== 'video') return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const onLoaded = () => {
      setMeta({
        duration: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth,
        height: video.videoHeight,
      });
      // seek 到 1 秒 (或 duration 的 10%, 取较小) 拿代表性帧
      const seekTarget = Math.min(1, video.duration * 0.1);
      const onSeeked = () => {
        try {
          canvas.width = video.videoWidth || 320;
          canvas.height = video.videoHeight || 180;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            setThumbDataUrl(canvas.toDataURL('image/jpeg', 0.7));
          }
        } catch {
          setThumbDataUrl(null);
        }
        video.removeEventListener('seeked', onSeeked);
      };
      video.addEventListener('seeked', onSeeked);
      // 某些视频 duration=Infinity, 跳过 seek
      if (Number.isFinite(video.duration) && video.duration > 0.5) {
        video.currentTime = seekTarget;
      } else {
        // 直播流 / 极短: 直接抓首帧
        requestAnimationFrame(() => onSeeked());
      }
    };
    video.addEventListener('loadedmetadata', onLoaded);
    return () => video.removeEventListener('loadedmetadata', onLoaded);
  }, [url, kind]);

  // 音频: decodeAudioData + 画波形
  useEffect(() => {
    if (kind !== 'audio') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setWaveformState('loading');
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const ab = await res.arrayBuffer();
        if (cancelled) return;
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) return;
        // AudioContext 全局单例 (Safari 限制 1 个)
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext; }).webkitAudioContext;
        const audioCtx = new Ctx();
        const audioBuf = await audioCtx.decodeAudioData(ab);
        if (cancelled) return;
        // 抽 N 个 bin (按 canvas 宽度), 算每 bin 的 RMS
        const W = canvas.width = canvas.clientWidth || 800;
        const H = canvas.height = 80;
        const data = audioBuf.getChannelData(0); // 单声道
        const bins = 200;
        const step = Math.floor(data.length / bins);
        ctx2d.clearRect(0, 0, W, H);
        ctx2d.fillStyle = 'rgba(0, 122, 255, 0.8)';
        const barW = W / bins;
        for (let i = 0; i < bins; i++) {
          let sum = 0;
          for (let j = 0; j < step; j++) {
            const v = data[i * step + j] ?? 0;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / step);
          const h = Math.max(1, rms * H * 0.9);
          const x = i * barW;
          ctx2d.fillRect(x, (H - h) / 2, Math.max(1, barW * 0.7), h);
        }
        // 中线
        ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx2d.beginPath();
        ctx2d.moveTo(0, H / 2);
        ctx2d.lineTo(W, H / 2);
        ctx2d.stroke();
        audioCtx.close();
        if (!cancelled) setWaveformState('ready');
      } catch (err) {
        if (!cancelled) {
          console.warn('[MediaView] waveform decode failed:', err);
          setWaveformState('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [url, kind]);

  return (
    <div className="preview-media-wrap">
      <div className="preview-media-meta">
        {meta.duration !== undefined && (
          <span className="preview-media-stat">⏱ {formatDuration(meta.duration)}</span>
        )}
        {kind === 'video' && meta.width && meta.height && (
          <span className="preview-media-stat">📐 {meta.width}×{meta.height}</span>
        )}
        {kind === 'video' && meta.width && meta.height && meta.duration && (
          <span className="preview-media-stat preview-media-stat-dim">
            ≈ {(meta.width * meta.height / 1_000_000 * meta.duration * 0.3 / 8).toFixed(1)} MB (估)
          </span>
        )}
        {kind === 'audio' && meta.duration && (
          <span className="preview-media-stat preview-media-stat-dim">
            {waveformState === 'loading' && '解码中…'}
            {waveformState === 'ready' && '波形已渲染'}
            {waveformState === 'error' && '波形解码失败 (浏览器不支持该编码)'}
          </span>
        )}
      </div>
      {kind === 'video' ? (
        <>
          {/* 缩略图 (有 src + poster 即可显示首帧; 无 thumbnail 时显示原生播放器) */}
          <video
            ref={videoRef}
            className="preview-video"
            src={url}
            poster={thumbDataUrl ?? undefined}
            controls
            autoPlay={false}
            preload="metadata"
            onError={() => setMeta({})}
          />
          {/* 离屏 canvas, 用于视频首帧抓取 */}
          <canvas ref={canvasRef} style={{ display: 'none' }} />
        </>
      ) : (
        <>
          <audio
            ref={audioRef}
            className="preview-audio"
            src={url}
            controls
            preload="metadata"
            onLoadedMetadata={(e) => setMeta({ duration: Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : undefined })}
            onError={() => setMeta({})}
          />
          {/* 波形 canvas: 一直显示 (loading 时是空, ready 后填内容) */}
          <canvas
            ref={canvasRef}
            className="preview-waveform"
            style={{ visibility: waveformState === 'error' ? 'hidden' : 'visible' }}
          />
        </>
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
