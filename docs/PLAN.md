# Windows 文件夹工具 — 方案设计

> 状态: **v1 方案待确认**
> 决策日期: 2026-06-05
> 工作区: `C:\Users\admin\Desktop\WorkSpaces\MinimaxWS\Beta`

---

## 1. 目标 & 范围

### 1.1 目标

做一个 **Windows 桌面端的现代化文件管理器**,核心差异化是:

- **多标签页(Tabs)** + **窗格分区(Split Panes)** 自由组合
- 现代化、卡片化、动效流畅(参考 macOS Finder / Windows 11 Files)
- **VS Code 级别的插件扩展能力** —— 第三方可以贡献命令、面板、预览器、主题
- 完整文件管理能力(浏览、操作、预览、搜索、收藏、主题)
- 单个 .exe 安装,自包含,不依赖系统装 Python/Node

### 1.2 v1 范围内 (In Scope)

| 模块 | 能力 |
|---|---|
| 窗口 | 多窗口,每个窗口独立布局,支持还原/最大化 |
| 标签 | 多标签,拖拽,固定,关闭,历史 |
| 窗格 | 水平/垂直任意切分,任意嵌套,焦点切换 |
| 浏览 | 列表/网格/详情视图,排序,过滤,显示选项 |
| 操作 | 复制/移动/删除/重命名/新建,拖放,回收站 |
| 预览 | 快速预览(Space),图片/Markdown/代码/文本 |
| 搜索 | 当前目录文件名/内容,全局模糊搜索(类似 Ctrl+P) |
| 收藏 | 收藏夹,历史记录,常用目录,侧边栏 |
| 主题 | 亮/暗/系统跟随,用户可定制颜色 |
| 插件 | VS Code 式扩展机制(独立宿主进程 + 贡献点) |
| 设置 | 完整设置页,快捷键自定义,导入/导出 |
| 打包 | 单 .exe 安装包,自动更新,代码签名预留 |

### 1.3 v1 不做 (Out of Scope)

- 云存储 / 网盘同步
- 内置终端(可作为扩展)
- 内置 Git(可作为扩展)
- 文件 Tag 管理
- 文件版本/快照
- macOS / Linux(代码层面预留,先发 Windows)

---

## 2. 技术栈(已确认)

| 层 | 选型 | 理由 |
|---|---|---|
| 运行时 | **Electron 30+** | 用户已选;VS Code 同款,扩展机制成熟 |
| 语言 | **TypeScript** | 类型安全,跨进程契约清晰 |
| UI 框架 | **React 18+** | 生态最熟,招人/招社区扩展方便 |
| 构建 | **Vite + electron-builder** | Vite 启动快,HMR 体验好;electron-builder 是事实标准 |
| 包管理 | **pnpm workspace** | monorepo 必备 |
| 状态管理 | **Zustand** | 轻、TS 友好、跨窗格状态自然 |
| 样式 | **Tailwind CSS + CSS Variables** | 主题切换靠 CSS 变量 |
| 组件库 | **Radix UI (无样式) + 自绘** | 现代化、无锁定、可定制 |
| 动效 | **Framer Motion** | 现代化动效 |
| 虚拟滚动 | **@tanstack/react-virtual** | 大目录必备 |
| 文件监听 | **chokidar** | 跨平台稳 |
| 持久化 | **electron-store** | 配置持久化够用 |
| 国际化 | **i18next + react-i18next** | |
| 自动更新 | **electron-updater** | |
| 测试 | **Vitest + Playwright (Electron)** | |

---

## 3. 架构总览

### 3.1 进程模型(参考 VS Code)

```
┌─────────────────────────────────────────────────────────────────┐
│                       Electron Main Process                      │
│  - 窗口生命周期                                                    │
│  - 操作系统集成(菜单/托盘/快捷键全局监听)                                │
│  - 文件系统权限管理                                                  │
│  - 扩展宿主进程管理(启动/通信/回收)                                     │
│  - 自动更新 / 通知                                                  │
└──────────┬──────────────────────────────────────┬────────────────┘
           │ ipcMain / contextBridge             │ child_process.fork
           │                                      │
┌──────────▼────────────────────┐    ┌──────────▼────────────────┐
│   Renderer Process (per win)  │    │  Extension Host Process   │
│  - React UI                   │    │  - 沙箱 Node 环境           │
│  - 文件列表/标签/窗格          │    │  - 加载扩展                 │
│  - 主题                       │    │  - 调用 API               │
│  - 扩展 UI 贡献(面板/视图)     │◄──►│                          │
└───────────────────────────────┘    └──────────────────────────┘
```

**为什么这样分:**
- **主进程隔离 OS 权限**:文件系统、注册表、全局快捷键只暴露特定 API
- **渲染进程隔离 DOM/UI**:不直接碰 Node,只能通过 IPC
- **扩展宿主隔离第三方代码**:崩溃的扩展不拖垮主程序,卸载/启用代价小

### 3.2 通信契约

**Renderer ↔ Main**:`ipcRenderer` / `ipcMain`,通过 `contextBridge` 暴露白名单 API

**Renderer ↔ Extension Host**:`vscode-jsonrpc` 风格的 RPC(轻量 JSON-RPC 2.0)

**关键频道**:
- `fs:*` —— 文件系统操作(read/write/copy/move/delete/watch)
- `tabs:*` —— 标签 CRUD、激活、拖拽
- `panes:*` —— 窗格分割/合并/焦点
- `windows:*` —— 窗口管理
- `ext:*` —— 插件激活/停用/通信
- `settings:*` —— 设置读写

### 3.3 模块结构(monorepo)

```
beta/
├── package.json
├── pnpm-workspace.yaml
├── electron-builder.yml
├── tsconfig.base.json
├── apps/
│   ├── main/                    # Electron 主进程
│   │   └── src/
│   │       ├── index.ts
│   │       ├── window/          # 窗口管理
│   │       ├── ipc/             # IPC 路由
│   │       ├── fs/              # 文件系统封装
│   │       ├── ext-host/        # 扩展宿主管理
│   │       ├── store/           # 持久化
│   │       ├── menu/            # 原生菜单
│   │       └── updater/         # 自动更新
│   ├── renderer/                # React 渲染层
│   │   └── src/
│   │       ├── app.tsx
│   │       ├── features/
│   │       │   ├── tabs/        # 标签系统
│   │       │   ├── panes/       # 窗格分区
│   │       │   ├── file-list/   # 文件列表
│   │       │   ├── breadcrumb/  # 路径导航
│   │       │   ├── preview/     # 预览面板
│   │       │   ├── search/      # 搜索
│   │       │   ├── favorites/   # 收藏
│   │       │   ├── theme/       # 主题
│   │       │   └── settings/    # 设置
│   │       ├── components/      # 通用组件
│   │       ├── ext/             # 渲染端插件桥
│   │       └── ipc/             # IPC 客户端
│   └── bridge/                  # 主↔渲染共享的 IPC 类型/工具
│       └── src/
│           ├── channels.ts      # 通道常量
│           ├── types.ts         # 共享类型
│           └── ts/
├── packages/
│   ├── ui/                      # 设计系统
│   │   └── src/
│   │       ├── tokens.ts        # 设计 token
│   │       ├── components/
│   │       └── icons/
│   ├── ext-api/                 # 插件 SDK(给插件作者用)
│   │   └── src/
│   │       ├── extension.ts     # ExtensionContext, activate
│   │       ├── commands.ts      # registerCommand
│   │       ├── panels.ts        # registerPanel(侧边面板)
│   │       ├── previewers.ts    # registerPreviewer
│   │       ├── views.ts         # registerView(标签视图)
│   │       ├── themes.ts        # registerTheme / registerColor
│   │       ├── keybindings.ts   # registerKeybinding
│   │       └── workspace.ts     # 监听工作区事件
│   └── core/                    # 跨进程纯函数/工具
│       └── src/
│           ├── fs/              # 文件路径处理
│           ├── mime/
│           └── id/
├── extensions/                  # 内置扩展(随主程序发)
│   ├── ext.markdown-preview/
│   ├── ext.image-preview/
│   ├── ext.code-preview/
│   ├── ext.fuzzy-search/
│   ├── ext.git/
│   └── ext.terminal/            # 可选,后期
├── resources/                   # 图标/字体/原生资源
├── docs/
│   ├── PLAN.md                  # 本文档
│   ├── plugin-dev-guide.md
│   └── user-guide.md
└── scripts/                     # 脚手架/构建脚本
```

---

## 4. 关键数据模型

```typescript
// 窗口
type WindowState = {
  id: string;
  bounds: Rectangle;
  rootLayout: LayoutNode;
  activePaneId: string;
  isMaximized: boolean;
};

// 布局树(支持任意嵌套切分)
type LayoutNode =
  | { type: 'split'; dir: 'horizontal' | 'vertical'; sizes: number[]; children: LayoutNode[] }
  | { type: 'pane'; id: string; tabs: Tab[]; activeTabId: string };

// 标签
type Tab = {
  id: string;
  type: 'folder' | 'preview' | 'plugin-view';
  // folder 类型
  path?: string;
  // plugin-view 类型
  pluginId?: string;
  viewType?: string;
  viewState?: Record<string, unknown>;
  // 通用
  title: string;
  icon?: string;
  history: string[];        // 路径历史
  historyIndex: number;
  pinned: boolean;
  closable: boolean;
  dirty?: boolean;
};
```

---

## 5. 关键交互 / 快捷键

| 操作 | 快捷键 | 备注 |
|---|---|---|
| 新建标签 | `Ctrl+T` | |
| 关闭标签 | `Ctrl+W` | |
| 重新打开关闭的标签 | `Ctrl+Shift+T` | |
| 切到第 N 个标签 | `Ctrl+1~9` | |
| 下一个/上一个标签 | `Ctrl+Tab` / `Ctrl+Shift+Tab` | |
| **左右切分窗格** | `Ctrl+\` | 在当前焦点窗格右/下方新建 |
| **取消窗格(合并)** | `Ctrl+Alt+Shift+\` | |
| **焦点在窗格间移动** | `Ctrl+Alt+方向键` | |
| 新建窗口 | `Ctrl+N` | |
| 打开文件夹 | `Ctrl+O` | |
| 地址栏聚焦 | `Ctrl+L` / `F6` | |
| 全局搜索 | `Ctrl+Shift+F` | |
| 快速搜索(文件名模糊) | `Ctrl+P` | |
| 快速预览 | `Space` | 类似 macOS QuickLook |
| 重命名 | `F2` | |
| 刷新 | `F5` | |
| 删除到回收站 | `Delete` | |
| 永久删除 | `Shift+Delete` | |
| 复制/粘贴/剪切 | `Ctrl+C/V/X` | |
| 切换主题 | `Ctrl+Shift+T` | |

---

## 6. 插件系统设计(VS Code 风格)

### 6.1 插件形态

每个插件是一个独立的 Node 模块,带 `package.json` 声明元数据:

```json
{
  "name": "my-extension",
  "displayName": "My Extension",
  "version": "0.1.0",
  "engines": { "app": "^1.0.0" },
  "main": "./out/extension.js",
  "activationEvents": [
    "onStartup",
    "onCommand:myExt.hello",
    "onFileSystem:.md"
  ],
  "contributes": {
    "commands": [
      { "command": "myExt.hello", "title": "Hello", "category": "MyExt" }
    ],
    "panels": [
      { "id": "myExt.side", "title": "My Sidebar", "icon": "star" }
    ],
    "previewers": [
      { "extension": ".md", "scheme": "file" }
    ],
    "themes": [
      { "id": "my-theme", "label": "My Theme" }
    ],
    "keybindings": [
      { "command": "myExt.hello", "key": "ctrl+shift+h" }
    ]
  }
}
```

### 6.2 插件 API 概览

```typescript
// 插件入口
export function activate(context: ExtensionContext) {
  // 命令
  context.subscriptions.push(
    commands.registerCommand('myExt.hello', () => {
      window.showInformationMessage('Hi!');
    })
  );
  // 侧边面板
  context.subscriptions.push(
    panels.register({
      id: 'myExt.side',
      title: 'My Sidebar',
      icon: 'star',
      render(container) { /* DOM/React */ },
    })
  );
  // 文件预览
  context.subscriptions.push(
    previewers.register({
      extension: '.md',
      provide(uri) { return renderMarkdown(uri); }
    })
  );
  // 事件订阅
  context.subscriptions.push(
    workspace.onDidChangeActiveTab(tab => { /* ... */ })
  );
}

export function deactivate() { /* ... */ }
```

### 6.3 生命周期

```
发现(scan 插件目录) → 加载(读 package.json) → 注册贡献点 → 按需激活(activationEvents 触发)
→ 运行(调用 API) → 停用(disposable.dispose)
```

### 6.4 沙箱

- 插件在 **Extension Host 进程** 跑,不接触主进程 DOM
- API 全部走 RPC,**禁止** `require('fs')` 等 Node 底层
- 资源访问通过白名单 API:读文件用 `workspace.readFile`,不能 `fs.readFile`
- 权限粒度:`fs`, `network`, `clipboard`, `process` 等可显式申请

### 6.5 内置扩展(随主程序发布)

| 扩展 | 能力 |
|---|---|
| `ext.markdown-preview` | Markdown 实时预览,代码高亮 |
| `ext.image-preview` | 图片预览,支持 EXIF/缩放 |
| `ext.code-preview` | 代码预览,行号,语法高亮 |
| `ext.fuzzy-search` | Ctrl+P 全局模糊搜索(内容) |
| `ext.git` | Git 状态图标、diff 预览 |
| `ext.terminal` | 内置终端(可选) |

---

## 7. 分阶段交付

| 阶段 | 内容 | 周期 | 验收 |
|---|---|---|---|
| **P0 脚手架** | pnpm + Vite + Electron + TS + React 跑通,基础窗口 | 3-5 天 | 能开 .exe,显示空白窗口,带 HMR |
| **P1 核心浏览** | 文件列表、面包屑、地址栏、排序、视图模式、键盘导航 | 1-2 周 | 能完整浏览本地目录,无明显卡顿 |
| **P2 标签 + 窗格** | 多标签、多窗格、拖拽、焦点切换、多窗口 | 2-3 周 | 核心交互流畅,符合 Mac Finder 直观度 |
| **P3 文件操作** | 复制/移动/删除/重命名、拖放、回收站、冲突处理 | 1-2 周 | 能独立完成日常文件管理任务 |
| **P4 预览 + 搜索** | 快速预览、Markdown/图片/代码预览、文件搜索、全局模糊 | 2 周 | 大文件(>100MB)不卡,搜索 < 200ms |
| **P5 收藏 + 主题** | 收藏夹、历史、侧边栏、主题系统、设置页 | 1 周 | 主题切换无闪烁,设置持久化 |
| **P6 插件系统** | 插件发现/加载/激活/沙箱、API、扩展 UI 贡献 | 2-3 周 | 能装一个示例扩展,功能跑通 |
| **P7 打磨** | 启动屏、自动更新、错误日志、快捷键自定义 UI、性能优化 | 1-2 周 | 启动 < 2s,空载 < 400MB,10K 文件滚动 60fps |

**总周期:约 3-4 个月**做出 v1 完整可发布版本

---

## 8. 关键决策 & 权衡

| 决策 | 选择 | 取舍 |
|---|---|---|
| 进程隔离 | 单 Extension Host 进程(VS Code 同款) | 简单够用,真要严苛再分进程 |
| 状态管理 | Zustand 而非 Redux | 轻、TS 友好、跨窗格状态自然 |
| 样式 | Tailwind + CSS Variables(主题) | 主题切换零闪烁 |
| 文件系统 API | Node `fs/promises` + chokidar | 标准,chokidar 跨平台稳 |
| 大文件预览 | 分块读取 + 流式渲染 | 避免 OOM |
| 持久化 | electron-store + JSON | 配置够用,后期可换 SQLite |
| 虚拟滚动 | @tanstack/react-virtual | 10K+ 文件不卡 |
| 国际化 | i18next | 资源文件按 locale 切 |
| 自动更新 | electron-updater + GitHub Releases | 主流方案 |
| 代码签名 | v1 留空,文档里说明 | 个人项目签名贵,先不发 Store |

---

## 9. 风险 & 缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 标签+窗格状态复杂度爆炸 | UI 状态难调试 | 数据模型单一来源,Zustand store 严格管理;不引入 immer,避免隐式行为 |
| 插件 API 设计不好导致后期重构 | 插件生态卡死 | P6 开始前先写一份 `plugin-dev-guide.md`,确定核心 API;先小范围用再扩 |
| 大目录(>100K 文件)性能 | 滚动卡、内存涨 | 强制虚拟滚动;目录扫描分页;后续可加索引 |
| Windows 资源占用 | 老机器不友好 | P7 性能基线;可考虑未来提供"轻量模式"开关 |
| 第三方扩展安全 | 恶意插件读文件 | 沙箱 + 权限申请 + 用户确认;参考 VS Code 安全模型 |

---

## 10. 验证 / 验收

每个阶段都有明确的 acceptance demo:

- **P0**: 跑 `pnpm dev` 出窗口,改一行代码自动热更新
- **P1**: 录 30 秒视频,展示浏览一个 5K 文件的目录,排序、视图切换
- **P2**: 录视频,展示 3 个标签、左右上下切分、跨窗格拖拽
- **P3**: 录视频,展示拖文件到另一个窗格完成复制
- **P4**: 录视频,展示 Markdown 预览、Ctrl+P 模糊搜索
- **P5**: 切换主题,展示颜色/圆角变化
- **P6**: 装一个示例扩展,展示侧边栏出现新面板
- **P7**: 关掉所有面板再开,启动 < 2s;滚动 10K 文件 60fps

**性能基线**:
- 冷启动 < 2s
- 内存 < 400MB(无插件空载)
- 10K 文件目录滚动 60fps
- 搜索响应 < 200ms

---

## 11. 下一步(Next Step)

如果方案确认,下一步动作:

1. **创建脚手架**(P0) —— 大概 3-5 天
   - pnpm + monorepo 结构
   - Electron + Vite + React + TS
   - electron-builder 打包配置
   - 一个空窗口能跑

2. **跑通 PoC** —— 半天
   - 打开本地任意目录
   - 看到文件列表
   - 双击能进入子目录

3. **按 P1→P7 推进**

---

## 附录 A: 视觉参考(目标)

- macOS Finder(侧边栏、卡片视图、QuickLook)
- Windows 11 Files(Mica/亚克力效果、圆角、动效)
- Raycast / Spotlight(命令面板、快速搜索)

## 附录 B: 命名建议

- 暂定项目代号: **Tabula** (拉丁语"片/板",呼应 tab/panel)
- 可讨论:Tabula、Slate、Panes、Cassini(致敬 Jean-Dominique Cassini,文件管理的隐喻)
- `.exe` 产物名: `tabula.exe` / `slate.exe` 等
