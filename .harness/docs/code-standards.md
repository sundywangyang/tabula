# Code Standards (Tabula)

> Project-wide coding conventions for the Tabula monorepo. Source of truth for what `code-reviewer` and `developer` check.

## Language & module system

- **TypeScript 5.7 strict**(`tsconfig.base.json`:`strict: true`, `noImplicitAny: true`, `noFallthroughCasesInSwitch: true`).
- **ESM everywhere**. Every package declares `"type": "module"`. Do **not** use `require()` or `__dirname`. Get the current file's directory via:
  ```ts
  import { fileURLToPath } from 'node:url';
  const __dirname = fileURLToPath(new URL('.', import.meta.url));
  ```
  See `apps/main/src/main/window/window-manager.ts` for the canonical example.
- **JSX**: `react-jsx` transform (configured in `tsconfig.base.json`). Don't `import React from 'react'` in components unless you need a hook under unusual circumstances.

## Naming

| Thing | Convention | Example |
|---|---|---|
| Files (non-component) | kebab-case | `window-manager.ts`, `file-store.ts` |
| React components | PascalCase file + export | `TitleBar.tsx` → `export function TitleBar()` |
| Variables / functions | camelCase | `loadDir`, `currentPath` |
| Types / interfaces | PascalCase | `FsEntry`, `LayoutNode`, `TabulaAPI` |
| Constants (immutable) | UPPER_SNAKE | `IpcChannels`, `DEFAULT_VIEW` |
| Enum-like unions | PascalCase type, lowercase members | `type TabType = 'folder' \| 'preview' \| 'plugin-view'` |
| IPC channel constants | UPPER_SNAKE, value is `domain:action` lowercase | `FS_LIST_DIR: 'fs:list-dir'` |

## Imports

- Order (enforced by hand until ESLint lands in P1):
  1. Node built-ins (`node:fs`, `node:path`, `node:url`).
  2. Workspace packages (`@tabula/bridge`, `@tabula/core`, …).
  3. Third-party (`react`, `zustand`, `electron`, `chokidar`, …).
  4. Relative imports (`./foo`, `../bar`).
- **Never** use absolute paths or `src/...` aliases from runtime code. Use the `@tabula/*` aliases (declared in `tsconfig.base.json` and mirrored in `electron.vite.config.ts`).
- Type-only imports use `import type` when the value is only used as a type:
  ```ts
  import type { ExtensionManifest } from '@tabula/bridge';
  ```

## Errors

- **Cross-process** (main ⇄ renderer, P6 main ⇄ ext-host): never `throw` raw. Return `Result<T>`:
  ```ts
  type Result<T> = { ok: true; data: T } | { ok: false; error: FsError };
  ```
  The `FsError` shape lives in `apps/bridge/src/types.ts`.
- **Same-process**: throw normally, with a message that names the function and the cause.
- **Renderer errors** that should surface to the user go through `window.tabula.app.openDevTools()` or a future notification channel — don't `alert()` or `console.error` only.

## Comments

- File-level JSDoc on every non-trivial file: one sentence on responsibility, one sentence on non-obvious invariants.
- Inline comments for non-obvious code only. No noise.
- No banner-style `========` separators.
- No "TODO" without an owner + phase. Use `// TODO(P6): scan extensions dir` style.

## Logging

- Main / ext-host: structured `console.log('[tabula] <area>: <msg>')`. The `[tabula]` prefix is greppable.
- Renderer: avoid `console.log` in production code paths; use a thin logger module if needed.
- No PII / file paths with user data in production logs by default; sanitize before logging.

## Type discipline

- **Don't** use `any` — prefer `unknown` and narrow.
- **Don't** cast `as` unless you can name the reason. If you must, leave a comment explaining the invariant.
- **Don't** define the same type in two packages. If you find yourself typing `interface FsEntry {}` outside `@tabula/bridge`, import it.
- **Discriminated unions** for state (`type LayoutNode = { type: 'split', … } | { type: 'pane', … }` in `types.ts`); never `as` cast over a union — narrow on `type`.

## React (renderer)

- Function components, no class components.
- Zustand for cross-component state; local `useState` for view-local state.
- One store per domain (`file-store`, `tab-store`, `pane-store`, `theme-store`, …). Don't merge into a god store.
- Side effects in `useEffect`; never in the render body.
- Avoid inline object / array literals in JSX for stable props (causes re-renders). Memoize or hoist.
- CSS Modules / co-located CSS file per component. No inline `style={{}}` except for dynamic transforms.

## IPC binding style

```ts
// In apps/main/src/main/ipc/<domain>.ts — handler
ipcMain.handle(IpcChannels.FS_LIST_DIR, async (_e, path: string) => {
  return listDir(path);  // returns Result<ListDirResult>
});

// In apps/main/src/preload/index.ts — binding
fs: {
  listDir: (p: string) => ipcRenderer.invoke(IpcChannels.FS_LIST_DIR, p),
}

// In renderer — caller
const r = await window.tabula.fs.listDir(p);
if (!r.ok) showError(r.error);
```

If you ever reach for a string literal that looks like an IPC channel name, **stop** — import from `@tabula/bridge`.

## Forbidden

- ❌ `nodeIntegration: true`
- ❌ `contextIsolation: false`
- ❌ `contextBridge.exposeInMainWorld('tabula', ipcRenderer)` (exposing the raw object)
- ❌ `setWindowOpenHandler(() => ({ action: 'allow' }))`
- ❌ `require('fs')` in renderer code
- ❌ `any` for IPC payload types
- ❌ Inline `style={{ ... }}` in production components
- ❌ Hardcoded paths in product code
