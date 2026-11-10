import { useEffect, useState } from 'react';
import type { ArchiveApplication } from '@tabula/bridge';

export const isArchiveFile = (path: string) => /\.(?:zipx?|rar|7z|tar|tgz|gz|bz2|xz|zst)$/i.test(path);
export function useArchiveApplications(path: string | null) {
  const [result, setResult] = useState<{ path: string; apps: ArchiveApplication[]; loading: boolean; error?: boolean } | null>(null);
  useEffect(() => {
    if (!path || !isArchiveFile(path) || typeof window.tabula.fs.getArchiveApplications !== 'function') { setResult(null); return; }
    let active = true;
    setResult({ path, apps: [], loading: true });
    void window.tabula.fs.getArchiveApplications(path)
      .then(apps => { if (active) setResult({ path, apps, loading: false }); })
      .catch(() => { if (active) setResult({ path, apps: [], loading: false, error: true }); });
    return () => { active = false; };
  }, [path]);
  return result?.path === path ? result : null;
}
