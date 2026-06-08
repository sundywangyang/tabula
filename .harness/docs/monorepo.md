# Monorepo Layout (Tabula)

> How the pnpm workspace is organized, what each package owns, and the build / alias / dependency boundaries. Source of truth for `developer` and `electron-expert`.

## Workspace declaration

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'extensions/*'
allowBuilds:
  electron: true
  esbuild: true
```

## Packages

| Path | npm name | Role | Build output |
|---|---|---|---|
| `apps/main` | `@tabula/main` | Electron main + preload | `out/main/`, `out/preload/` |
| `apps/renderer` | `@tabula/renderer` | React UI | `out/renderer/` |
| `apps/bridge` | `@tabula/bridge` | Cross-process types & IPC channels | (consumed as source) |
| `packages/core` | `@tabula/core` | Pure functions (path / mime / id) | (consumed as source) |
| `packages/ui` | `@tabula/ui` | Design system | (consumed as source) |
| `packages/ext-api` | `@tabula/ext-api` | Extension SDK (P6) | (consumed as source) |
| `extensions/ext.*` | `@tabula/ext-<name>` (P6) | Built-in extensions | per-extension `out/` |

The non-app packages (`bridge`, `core`, `ui`, `ext-api`) are consumed **as source** — `main` field points at `./src/index.ts`. The build pipeline (electron-vite) reads the TS source directly. Do **not** run a separate build step for them in P0.

## Build matrix

`electron.vite.config.ts` declares three build contexts:

- **main** → `out/main/` (entry: `apps/main/src/main/index.ts`)
- **preload** → `out/preload/` (entry: `apps/main/src/preload/index.ts`)
- **renderer** → `out/renderer/` (root: `apps/renderer/`, entry: `apps/renderer/index.html`)

Root scripts:

```bash
pnpm dev         # electron-vite dev (all 3 contexts in parallel + HMR)
pnpm build       # electron-vite build
pnpm start       # electron-vite preview
pnpm typecheck   # tsc --noEmit -p tsconfig.typecheck.json
pnpm package     # electron-vite build && electron-builder (NSIS installer)
pnpm package:dir # electron-vite build && electron-builder --dir
```

## Path aliases

Declared in `tsconfig.base.json` and mirrored in `electron.vite.config.ts` for each context:

| Alias | Source |
|---|---|
| `@tabula/bridge` | `apps/bridge/src` |
| `@tabula/core` | `packages/core/src` |
| `@tabula/ui` | `packages/ui/src` |
| `@tabula/ext-api` | `packages/ext-api/src` |

A new package **must** add its alias in both files. Drift between `tsconfig.base.json` and `electron.vite.config.ts` is a common build break.

## Dependency rules

- **Root devDeps**: build tooling only (`electron`, `electron-vite`, `electron-builder`, `vite`, `typescript`, `react` types, `node` types). Nothing else at the root.
- **App deps** (`apps/main`, `apps/renderer`): runtime dependencies specific to that process. Examples: `react` / `react-dom` / `zustand` go in `apps/renderer`; `chokidar` / `electron-store` go in `apps/main` when added.
- **Shared deps** (path manipulation, mime detection, ID generation): belong in `packages/core` and are imported via `@tabula/core` by all three apps.
- **UI primitives** (Button, Input, Modal, etc.): belong in `packages/ui` and are imported via `@tabula/ui` by `apps/renderer`.
- **Extension API surface**: belongs in `packages/ext-api`. Built-in extensions in `extensions/` import via `@tabula/ext-api`.
- **Never** declare the same dependency twice in the workspace. If `react` is in root, don't add it to `apps/renderer/package.json` too.
- **No** `*` version ranges. Use `^X.Y.Z`. Exact versions in `pnpm-lock.yaml` resolve transitively.

## Adding a new package

1. `mkdir apps/<name>` (or `packages/<name>`).
2. Add `package.json` with `name: '@tabula/<name>'`, `private: true`, `type: 'module'`, `main: './src/index.ts'`, `types: './src/index.ts'`, and `exports: { ".": "./src/index.ts", "./*": "./src/*" }`.
3. Add `tsconfig.json` extending `../../tsconfig.base.json` (or `../../../tsconfig.base.json` for `apps/<name>`).
4. Add the path alias to `tsconfig.base.json` and to the three build contexts in `electron.vite.config.ts`.
5. Add the new package to the root `tsconfig.json` `references` array so `pnpm typecheck` covers it.
6. `pnpm install` to wire the workspace link.

## Adding a new IPC channel

Always three places, in this order:

1. `apps/bridge/src/channels.ts` — add the `IpcChannels.<NAME>` constant. Name: lowercase `domain:action`.
2. `apps/bridge/src/types.ts` — add any new request / response types, or extend the existing ones.
3. `apps/bridge/src/api.ts` — add the method shape on `TabulaAPI`.
4. Implementation:
   - Handler in `apps/main/src/main/ipc/<domain>.ts` and registered in `apps/main/src/main/ipc/index.ts`.
   - Binding in `apps/main/src/preload/index.ts`.
   - Caller in `apps/renderer/...`.

The orchestrator routes this kind of change to `developer` for the implementation, with `electron-expert` reviewing the bridge surface drift.

## Local commands cheat-sheet

```bash
# Just the renderer (Vite, no Electron)
cd apps/renderer && pnpm dev

# Typecheck a single package
cd apps/main && pnpm typecheck

# Typecheck everything
pnpm typecheck

# Smoke-build (fast feedback on whether configs are sane)
pnpm build
```

## Forbidden in monorepo

- ❌ Cross-package relative imports (`../../apps/main/src/foo`) — use `@tabula/...` aliases.
- ❌ Publishing any `@tabula/*` to npm — all packages are `private: true`.
- ❌ Two different versions of `react`, `zustand`, or `electron` in `node_modules` — pin to one version at the root or hoist.
- ❌ `nohoist` or non-standard workspace config without a written reason in this file.
