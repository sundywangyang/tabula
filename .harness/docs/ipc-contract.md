# IPC Contract (Tabula)

> How the main, preload, and renderer processes talk. Single source of truth: `apps/bridge/src/{channels,types,api}.ts`. This doc explains the **rules**; the file is the **spec**.

## Process model recap

```
            main process (Node, full OS access)
                  │
        ipcMain.handle(channel, handler)
                  │
       ┌──────────┴──────────┐
       │                     │
   preload (isolated,     ext-host (P6, child process,
   contextBridge)         JSON-RPC, sandboxed)
       │                     │
       └────────┬────────────┘
                │
         window.tabula.* (the only surface the renderer can call)
                │
        ipcRenderer.invoke(channel, …payload)
                │
            renderer (sandboxed, no Node APIs)
```

The renderer is **not allowed** to import `electron`, `fs`, `path`, or any Node built-in. It can only call `window.tabula.<namespace>.<method>()`.

## Files

| File | Owns |
|---|---|
| `apps/bridge/src/channels.ts` | `IpcChannels` constant — one place for every channel name |
| `apps/bridge/src/types.ts` | Cross-process data types (no logic) |
| `apps/bridge/src/api.ts` | The `TabulaAPI` interface — the surface the renderer sees |
| `apps/bridge/src/index.ts` | Re-exports the three above |
| `apps/main/src/preload/index.ts` | Maps `TabulaAPI` methods to `ipcRenderer.invoke` calls |
| `apps/main/src/main/ipc/index.ts` | Calls `registerIpcHandlers(...)` — registers `ipcMain.handle` |
| `apps/main/src/main/ipc/<domain>.ts` | One file per domain (`fs.ts`, `tabs.ts`, `panes.ts`, …) — actual handlers |

## Channel naming

Format: **lowercase `domain:action`**. Use hyphens, not underscores, in the action.

| Domain | Example |
|---|---|
| `fs` | `fs:list-dir`, `fs:read-file`, `fs:write-file`, `fs:delete`, `fs:rename`, `fs:move`, `fs:copy`, `fs:mkdir`, `fs:exists`, `fs:stat`, `fs:pick-directory`, `fs:pick-file`, `fs:show-in-folder`, `fs:open-path` |
| `tabs` | `tabs:open`, `tabs:close`, `tabs:activate`, `tabs:move`, `tabs:list` |
| `panes` | `panes:split`, `panes:merge`, `panes:focus`, `panes:layout-get`, `panes:layout-set` |
| `win` | `win:open`, `win:close`, `win:list`, `win:focus` |
| `ext` | `ext:list`, `ext:enable`, `ext:disable`, `ext:install`, `ext:uninstall`, `ext:invoke-command` (P6) |
| `cfg` | `cfg:get`, `cfg:set`, `cfg:all` |
| `app` | `app:ready`, `app:version`, `app:open-devtools`, `app:reload` |

## Adding a new channel — three steps

1. **Constant in `channels.ts`** (this is the only place the literal string lives):
   ```ts
   FS_FOO: 'fs:foo',
   ```
2. **Type in `types.ts`** (request payload, response payload, or extend an existing type):
   ```ts
   export interface FooRequest { path: string; }
   export interface FooResult { ok: true; data: FsEntry } | { ok: false; error: FsError };
   ```
3. **Surface in `api.ts`** (the renderer-facing method):
   ```ts
   fs: {
     // ...
     foo(req: FooRequest): Promise<Result<FooResult>>;
   }
   ```
4. **Implement in `apps/main/src/main/ipc/<domain>.ts`** — handler that returns `Result<T>`. Register in `apps/main/src/main/ipc/index.ts`.
5. **Bind in `apps/main/src/preload/index.ts`** — map the `TabulaAPI` method to `ipcRenderer.invoke(IpcChannels.FS_FOO, req)`.
6. **Use in renderer** — `await window.tabula.fs.foo({ path: '/x' })`.

## Result envelope

Cross-process returns use `Result<T>` (defined in `apps/bridge/src/types.ts`):

```ts
export type Result<T> = { ok: true; data: T } | { ok: false; error: FsError };
export interface FsError {
  code: 'ENOENT' | 'EACCES' | 'EEXIST' | 'ENOTDIR' | 'EISDIR' | 'EBUSY' | 'UNKNOWN';
  message: string;
  path?: string;
}
```

Handlers must catch and translate thrown errors into `FsError`. Renderer code never sees an unhandled `throw` from IPC.

## Events (main → renderer)

`window.tabula.events.on(channel, listener)` returns an `off()` function. Channels here use the same `domain:action` format but represent **broadcast** rather than **request/response**. The main process calls `webContents.send(channel, payload)` to dispatch.

Use events for: tab opened/closed, pane split, config changed, file-watcher fired. Use invoke for everything else.

## Preload invariants

- `contextBridge.exposeInMainWorld('tabula', api)` and **only** this. Do not expose additional globals.
- `api` is a frozen, narrow shape — never the raw `ipcRenderer`.
- The preload script is the only place that imports `electron`'s `contextBridge` / `ipcRenderer`. The renderer never sees either.
- `apps/main/src/main/window/window-manager.ts` must keep `contextIsolation: true` and `nodeIntegration: false`. Any change to those flags is a **blocker-level review failure**.

## Renderer call discipline

- All async work goes through `await window.tabula.*`.
- Never `require` / `import` from `electron`, `fs`, `path`, `child_process` in `apps/renderer`.
- For long-running operations, the handler should chunk and emit `events.*` progress messages; the renderer subscribes and updates UI state.

## Versioning

- Adding a new method to `TabulaAPI` is **non-breaking**.
- Renaming or removing a method is **breaking**. Coordinate with `electron-expert`; bump the API version in the `TabulaAPI` JSDoc if/when we add one; write a migration note in `deliverable.md`.
- Changing an existing channel's payload shape is **breaking**. Prefer a new channel name (e.g., `fs:list-dir-v2`) over mutating the existing one.

## Forbidden patterns

- ❌ `ipcMain.handle(IpcChannels.FS_LIST_DIR, async (_e, path) => fs.readdir(path))` returning a raw `fs.Dirent[]` — must be serialized to `FsEntry[]` and wrapped in `Result<T>`.
- ❌ `contextBridge.exposeInMainWorld('tabula', { ipcRenderer })` — never expose the raw object.
- ❌ `webContents.send(IpcChannels.APP_RELOAD, …)` carrying large blobs (> 1 MB); use a stream or a file URI instead.
- ❌ A renderer-side `import { ipcRenderer } from 'electron'` — this is a security boundary violation.

## When in doubt

- Read `apps/bridge/src/api.ts` first — that's the rendered surface.
- Read `apps/main/src/preload/index.ts` second — that's the binding.
- Read `apps/main/src/main/ipc/index.ts` third — that's the registration order.
- Ask `electron-expert` before changing the bridge surface.
