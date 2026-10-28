import { useEffect, useMemo, useRef, useState } from 'react';
import type { FsEntry } from '@tabula/bridge';

// =================== 重命名输入 ===================

export function RenameInput({
  entry,
  showExtensions,
  onSubmit,
  onCancel,
  variant = 'row',
}: {
  entry: FsEntry;
  showExtensions: boolean;
  onSubmit: (name: string) => Promise<{ ok: boolean; error?: string; }>;
  onCancel: () => void;
  variant?: 'row' | 'grid';
}) {
  // 默认值:不显示扩展名时,只给基本名;显示扩展名时,给完整名(用户改后保留扩展名逻辑由调用方做)
  const initial = useMemo(() => {
    if (entry.isDirectory || showExtensions) return entry.name;
    // 去掉扩展名
    const dot = entry.name.lastIndexOf('.');
    return dot > 0 ? entry.name.slice(0, dot) : entry.name;
  }, [entry, showExtensions]);

  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // 选中基本名(去掉扩展名的那部分)
    const dot = initial.lastIndexOf('.');
    if (dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [initial]);

  const submit = async () => {
    let name = value.trim();
    if (!name) {
      setError('不能为空');
      return;
    }
    // 隐藏扩展名模式下,补回扩展名
    if (!entry.isDirectory && !showExtensions) {
      const origDot = entry.name.lastIndexOf('.');
      const origExt = origDot > 0 ? entry.name.slice(origDot) : '';
      const valDot = name.lastIndexOf('.');
      if (origExt && (valDot < 0 || name.slice(valDot).toLowerCase() !== origExt.toLowerCase())) {
        name = name + origExt;
      }
    }
    const res = await onSubmit(name);
    if (!res.ok) setError(res.error ?? '重命名失败');
  };

  return (
    <span className={`rename-input-wrap ${variant}`}>
      <input
        ref={inputRef}
        className="rename-input"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={async (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            await submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => {
          if (!error) {
            // 失焦:如果改了,提交;否则取消
            if (value !== initial) {
              void submit();
            } else {
              onCancel();
            }
          }
        }}
      />
      {error && <span className="rename-error" title={error}>⚠</span>}
    </span>
  );
}
