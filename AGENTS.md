# AGENTS.md

> **Tabula** — Windows 桌面端现代化文件管理器。核心差异化:**多标签 + 窗格分区** + **VS Code 式插件扩展**。
> 整体方案见 [`docs/PLAN.md`](./docs/PLAN.md)(阶段 P0→P7,共 3–4 个月)。本文件给所有 AGENTS.md-aware 工具(OpenCode / Codex / Cursor / Aider / Devin / Gemini CLI 等)消费。

## Quick facts

- **形态**:Electron 33 桌面应用,Windows 优先(macOS / Linux 预留)
- **形态**:pnpm workspace monorepo(6 个子包,3 个进程)
- **运行时**:Node ≥ 20,pnpm ≥ 9
- **构建**:electron-vite 2.3 + Vite 5,TypeScript 5.7 strict
- **UI**:React 18 + Zustand 5,样式 CSS Variables(主题切换零闪烁)
- **测试**:Vitest + Playwright (Electron)
- **包管理**:pnpm 9(`pnpm install` / `pnpm dev` / `pnpm build`)
- **状态**:当前阶段 **P0 脚手架**(空窗口 + IPC 通路 + 基础 UI 已落,正在 P1 推进核心浏览)

## Setup commands

```bash
pnpm install                              # 安装依赖(workspace 自动链接)
pnpm dev                                  # 启动 Electron 开发模式(带 HMR)
pnpm build                                # 产出 out/{main,preload,renderer}
pnpm typecheck                            # 全仓库 tsc --noEmit(走 tsconfig.typecheck.json)
pnpm package                              # 产出 NSIS 安装包到 release/
pnpm package:dir                          # 产出未打包目录,用于本地试跑
```

子包脚本与根脚本等价;进入子目录也可独立跑(`cd apps/renderer && pnpm dev`)。**不要在 root 跑 pnpm test / pnpm lint —— 目前尚未配置**(等 P1 阶段补 Vitest + ESLint)。

## Project layout

```
Beta/
├── package.json              # 根:workspace 容器 + electron-builder 入口
├── pnpm-workspace.yaml       # apps/*, packages/*, extensions/*
├── electron.vite.config.ts   # 三进程构建配置(main/preload/renderer)
├── electron-builder.yml      # 打包配置(NSIS / dmg / AppImage)
├── tsconfig.base.json        # 共享 TS 配置(严格模式 + 路径别名)
├── apps/
│   ├── main/                 # @tabula/main  — Electron 主进程 + preload
│   │   └── src/
│   │       ├── main/         #   入口、window/、ipc/、fs/、ext-host/、store/
│   │       └── preload/      #   contextBridge 桥接
│   ├── renderer/             # @tabula/renderer — React 渲染层
│   │   └── src/
│   │       ├── components/   #   TitleBar / Sidebar / Breadcrumb / StatusBar
│   │       ├── features/     #   panes/、file-list/  (后续:tabs/、preview/、search/、theme/、settings/、favorites/)
│   │       └── stores/       #   Zustand stores
│   └── bridge/               # @tabula/bridge — 跨进程共享类型 + IPC 通道常量
│       └── src/
│           ├── channels.ts   #   单一 IPC 通道常量
│           ├── types.ts      #   跨进程类型(FsEntry / Tab / LayoutNode / ExtensionManifest / AppConfig …)
│           └── api.ts        #   window.tabula.* 形状 (TabulaAPI)
├── packages/
│   ├── core/                 # @tabula/core — 跨进程纯函数 / 工具(path / mime / id)
│   ├── ui/                   # @tabula/ui — 设计系统(后续从 renderer 抽)
│   └── ext-api/              # @tabula/ext-api — 插件 SDK(P6 启用)
├── extensions/               # 内置扩展(P6 起,目前空)
├── resources/                # 图标 / 字体 / 原生资源
├── docs/PLAN.md              # 总体方案
└── scripts/                  # 脚手架 / 构建脚本(目前空)
```

> **重要**:`apps/bridge` 是主进程与渲染进程之间的**单一类型契约源**。新增 IPC 通道必须先在 `channels.ts` 加常量、在 `types.ts` 加类型、在 `api.ts` 加方法形状,再在 main / preload / renderer 各自实现。

## Architecture — process model

```
┌──────────────────────────────────────────────────────────┐
│                    Main Process (Node)                   │
│  - 窗口生命周期 / 菜单 / 托盘 / 全局快捷键                  │
│  - 文件系统权限(chokidar + electron-store)                │
│  - IPC 路由(registerIpcHandlers in apps/main/src/main/ipc) │
│  - 扩展宿主进程管理(子进程 fork,P6 实现)                   │
└──────────────┬───────────────────────────────┬───────────┘
   ipcMain ◄──┤                                ├──► child_process.fork
               │                                │
   ┌───────────▼──────────┐         ┌──────────▼────────┐
   │  Renderer (per win)  │  JSON-  │  Extension Host   │
   │  React + Zustand     │  RPC    │  沙箱 Node 环境   │
   │  走 contextBridge     │ ◄─────► │  加载 .ext 包     │
   └──────────────────────┘  (P6)   └───────────────────┘
```

**关键不变量**(违反任意一条都算 bug):

1. **渲染进程 `nodeIntegration: false` + `contextIsolation: true`**(`window-manager.ts` 已固化)。
   渲染进程**禁止** `require('fs')` / `require('electron')`,所有 OS 能力走 `window.tabula.*` 异步调用。
2. **preload 是白名单桥**:`apps/main/src/preload/index.ts` 通过 `contextBridge.exposeInMainWorld('tabula', api)` 暴露;**禁止**直接 `contextBridge.exposeInMainWorld` 任何 `ipcRenderer` 原始对象。
3. **跨进程类型只能从 `@tabula/bridge` 导入**。主 / 渲染 / preload 三方各持一份,不要在三个进程内分别定义 `interface Tab { ... }`。
4. **新 IPC 通道三步走**:`channels.ts` 加常量 → `types.ts` 加出入参类型 → `api.ts` 同步方法签名 → main / preload / renderer 实现。
5. **新窗口跳转走 `shell.openExternal`**,禁止 `setWindowOpenHandler` 返回 `allow`(见 `apps/main/src/main/index.ts`)。

## Code style

- **TypeScript 严格模式**(`tsconfig.base.json`:`strict: true`)。`noImplicitAny: true`。
- **ESM 全仓库**(`"type": "module"`);`__dirname` 不可用,改用 `fileURLToPath(new URL('.', import.meta.url))`(`window-manager.ts` 已有范例)。
- **命名**:文件 kebab / 组件 PascalCase / 变量 camelCase / 类型 PascalCase / 常量 UPPER_SNAKE。
- **导入顺序**:node 内置 → workspace 包(`@tabula/*`)→ 相对路径;**禁止**绝对路径。
- **错误处理**:主进程 `Result<T> = { ok:true, data } | { ok:false, error }`(`bridge/types.ts`),不要把异常跨进程直接抛出。
- **注释**:模块顶部一句话职责;JSDoc 写给后续开发者,不复述代码。
- **Prettier / ESLint 配置**:尚未加入(P1 阶段);目前靠 `tsc --noEmit` + 手动规范。

## Phase roadmap

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0 脚手架** | pnpm + Electron + Vite + React + TS,基础窗口 + IPC 通路 | 进行中(空 UI + 桩 ext-host 已落) |
| **P1 核心浏览** | 文件列表 / 面包屑 / 地址栏 / 排序 / 视图模式 / 键盘导航 | 未开始 |
| **P2 标签 + 窗格** | 多标签、多窗格、拖拽、焦点切换、多窗口 | 未开始 |
| **P3 文件操作** | 复制 / 移动 / 删除 / 重命名 / 拖放 / 回收站 | 未开始 |
| **P4 预览 + 搜索** | QuickLook、Markdown / 图片 / 代码预览、模糊搜索 | 未开始 |
| **P5 收藏 + 主题** | 收藏夹、历史、侧边栏、主题系统、设置页 | 未开始 |
| **P6 插件系统** | 插件发现 / 加载 / 沙箱 / API / 扩展 UI 贡献 | 未开始(关键差异化) |
| **P7 打磨** | 启动屏、自动更新、错误日志、快捷键 UI、性能 | 未开始 |

**性能基线**(P7 验收):冷启动 < 2s · 内存 < 400MB(无插件)· 10K 文件滚动 60fps · 搜索 < 200ms。

## Working with this repo

### 改任何代码前

1. 读 `docs/PLAN.md` 对应章节(尤其 P0 进程模型 / P6 插件系统 / 跨进程契约)。
2. 跨进程改动先动 `@tabula/bridge`,再动 main / preload / renderer。
3. 不要新增根级别依赖 — 进对应子包 `apps/*/package.json` 或 `packages/*/package.json`。

### 构建 / 验证

- **改完跑一遍**:`pnpm typecheck`(`tsc --noEmit` 全仓库)。
- **运行验证**:`pnpm dev`;观察 Electron 窗口 + devtools。
- **不跑**:`pnpm package`(打 exe 太慢,留给 CI / 手动验证)。
- **测试**:尚未配置(P1 起加 Vitest + Playwright)。

### PR & commit

- **当前还没有 git commit**(仓库 init 后尚未提交首个 commit);首个 commit 由人来发。
- 默认分支:`master`(本仓库 init 时使用)。
- 提交粒度:每个 P 阶段内,按 feature / fix / refactor 拆。
- 写 commit message 用 conventional commits:`feat:` / `fix:` / `refactor:` / `chore:` / `docs:`。
- 跨进程 / 跨包改动,在 commit body 里点出涉及哪些包。

## Security

- **永远不要**提交 `.env` / `*.pem` / 凭据文件;`.gitignore` 已覆盖 `.env*`。
- **永远不要**关闭 `contextIsolation` / 打开 `nodeIntegration` —— 这是渲染进程安全边界。
- **永远不要**让渲染进程直接 `require` 任何 node 内置;所有能力走 `window.tabula.*`。
- **v1 阶段代码签名先留空**(`electron-builder.yml` 已注释),别试图启用自签。
- 扩展 API(P6 起)严格走 RPC,**禁止**插件进程直接 `require('fs')`。

## Pointers for AI agents

- **方案设计**:`docs/PLAN.md`(单文件,456 行,中文,P0→P7 阶段 + 数据模型 + 决策表 + 风险表)
- **跨进程类型契约**:`apps/bridge/src/{channels,types,api}.ts`
- **主进程入口**:`apps/main/src/main/index.ts`(90 行,看 `bootstrap()` 流程)
- **preload 桥**:`apps/main/src/preload/index.ts`(91 行,白名单 API)
- **窗口管理**:`apps/main/src/main/window/window-manager.ts`(102 行,看 `webPreferences` 安全设置)
- **扩展宿主(P0 桩)**:`apps/main/src/main/ext-host/extension-host.ts`(P6 实现)
- **渲染端 App**:`apps/renderer/src/App.tsx`(已串通 TitleBar/Sidebar/Breadcrumb/FileList/PaneContainer/StatusBar)
- **Mavis 团队**:`.harness/`(orchestrator + 5 reins);团队本身在本仓库见 `.harness/agent.md`。

---

> 最后更新:bootstrap 阶段(2026-06-05)。后续每完成一个 P 阶段,这里和 `docs/PLAN.md` 同步更新。
