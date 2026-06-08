# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Tabula** — A modern Windows file manager with multi-tab support, split panes, and a VS Code-style plugin extension system. Built as an Electron 33 desktop app using pnpm workspaces monorepo.

- **Tech stack**: Electron 33 + Vite 5 + React 18 + TypeScript 5.7 strict + Zustand 5
- **Package manager**: pnpm 9 (`pnpm install` / `pnpm dev` / `pnpm build`)
- **Current phase**: P0 scaffold (empty window + IPC + basic UI), transitioning to P1 (core browsing)

## Commands

```bash
pnpm install        # Install dependencies (workspace auto-links)
pnpm dev            # Start Electron dev mode with HMR
pnpm build          # Build to out/{main,preload,renderer}
pnpm typecheck # Full repo tsc --noEmit (strict)
pnpm package # Build + package .exe to release/
pnpm package:dir    # Build + output unpacked dir (faster local testing)
```

## Architecture — Process Model

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (Node)                       │
│  - Window lifecycle, menus, tray, global shortcuts           │
│  - Filesystem permissions (chokidar + electron-store)        │
│  - IPC routing (apps/main/src/main/ipc) │
│  - Extension host management (child_process.fork, P6)        │
└──────────────┬───────────────────────────────┬───────────────┘
               │ ipcMain / contextBridge       │ child_process.fork
               │                               │
┌──────────────▼──────────────┐ ┌────────────▼────────────────┐
│  Renderer (per window)     │  │  Extension Host (sandboxed)  │
│  React + Zustand            │  │  Loads .ext packages (P6)    │
│  via contextBridge only│◄─┼► RPC communication │
└────────────────────────────┘  └───────────────────────────────┘
```

**Security invariant (never violate)**: Renderer has `nodeIntegration: false` + `contextIsolation: true`. All OS capabilities must be called asynchronously via `window.tabula.*` — never `require('fs')` or `require('electron')` in the renderer.

## Package Layout

```
apps/
  main/          @tabula/main — Electron main process + preload
  renderer/      @tabula/renderer — React UI (TitleBar, Sidebar, FileList, Panes, StatusBar)
  bridge/        @tabula/bridge — Shared IPC types/channels/API contract
packages/
  core/          @tabula/core — Cross-process pure utilities (path, mime, id)
  ui/ @tabula/ui — Design system components
  ext-api/       @tabula/ext-api — Plugin SDK (P6)
extensions/      Built-in extensions (P6, currently empty)
```

## Key Contracts

**`apps/bridge` is the single source of truth for cross-process types.** Any new IPC channel requires:
1. Add constant to `channels.ts`
2. Add input/output types to `types.ts`
3. Add method signature to `api.ts`
4. Then implement in main / preload / renderer

## Code Style

- **TypeScript strict mode** (`strict: true`, `noImplicitAny: true`)
- **ESM throughout** (`"type": "module"`); use `fileURLToPath(new URL('.', import.meta.url))` instead of `__dirname`
- **Naming**: files kebab-case, components PascalCase, variables camelCase, types PascalCase, constants UPPER_SNAKE
- **Import order**: node built-ins → workspace packages (`@tabula/*`) → relative paths
- **Error handling**: Main process uses `Result<T> = { ok: true, data } | { ok: false, error }` — never throw exceptions across processes
- **No new root dependencies** — add to the appropriate sub-package `package.json`

## Current Roadmap

| Phase | Goal | Status |
|-------|------|--------|
| P0 | Scaffold (Electron + Vite + React + TS + IPC) | Complete |
| P1 | Core browsing (file list, breadcrumb, address bar, sort, views) | Current |
| P2 | Tabs + panes (multi-tab, split, drag, focus switching) | Next |
| P3 | File operations (copy/move/delete/rename/drag-drop) | Later |
| P6 | Plugin system (VS Code-style extensions) | Planned |

## Important File References

- **Main entry + bootstrap**: `apps/main/src/main/index.ts`
- **Preload bridge (whitelist API)**: `apps/main/src/preload/index.ts`
- **Window manager (security settings)**: `apps/main/src/main/window/window-manager.ts`
- **IPC channel constants + types**: `apps/bridge/src/{channels,types,api}.ts`
- **Renderer App (wired components)**: `apps/renderer/src/App.tsx`
- **Detailed design doc**: `docs/PLAN.md`

## Security Rules

- Never commit `.env` / `*.pem` / credentials — `.gitignore` covers `.env*`
- Never disable `contextIsolation` or enable `nodeIntegration`
- Never let renderer directly `require` node built-ins — all via `window.tabula.*`
- Extension API (P6) strictly RPC — no direct `require('fs')` in plugin processes

## CI / Build Notes

- `pnpm package` is slow (full exe build) — use `pnpm package:dir` for local testing
- No lint/test configured yet (P1 will add Vitest + ESLint)
- Default branch is `master`; use `main` for PRs