# Tabula

> 现代化的多标签 + 分屏窗格文件管理器,带 VS Code 风格插件系统。  
> 跨平台:macOS / Windows / Linux。  
> Electron 33 + React 18 + TypeScript 5.7 + Vite 5 + Zustand 5。

![macOS](https://img.shields.io/badge/macOS-supported-blue) ![Windows](https://img.shields.io/badge/Windows-supported-blue) ![Linux](https://img.shields.io/badge/Linux-supported-blue) ![license](https://img.shields.io/badge/license-AGPL--3.0-lightgrey)

---

## ✨ 核心特性

### 🗂 多标签 + 分屏窗格
- 同一窗口内开多个**标签**(`Cmd/Ctrl + T`)
- 标签可**水平 / 垂直分屏**成多个 pane(每个 pane 独立浏览路径)
- 标签**拖拽改 pane**布局:在 pane 之间移动 / 复制 tab,跨分区
- 拖动时 tab 按最小尺寸显示,松手回归正常尺寸
- 单个 tab 可**关闭** / 固定 / 设为预览态

### 📁 文件操作
- 复制 / 移动 / 重命名 / 删除(支持**多选 + 批量**)
- 跨盘移动自动降级为 `copy + delete`
- **拖放**到目标目录 / sidebar / breadcrumb / tab 都能接收
- `Ctrl/⌘` 切换拖动为 copy,默认 move
- 粘贴遇同名时弹**冲突解决**对话框(覆盖 / 跳过 / 重命名)
- **批量重命名**对话框(统一前缀 / 后缀 / 替换 / 编号)
- `Cmd/Ctrl + Z` 撤回上一步操作(预留接口)
- 系统**剪贴板**:`copy` 模式与 `cut` 模式区分
- 系统**回收站**(Windows Shell.Application / macOS Finder trash / Linux gio)

### 🔍 搜索
- **Command Palette**(`Cmd/Ctrl + Shift + P`):模糊匹配所有命令 + 路径
- **GlobalSearch**(`Cmd/Ctrl + Shift + F`):跨目录递归搜索,带文件类型过滤
  - 匹配分数:精确(1000) > 大小写不敏感精确(500) > 前缀(100) > 子串(50) > 模糊(10)
  - 可配置递归深度 / 最大结果数
- **历史记录**:最近访问过的路径
- **书签 / 收藏**:固定常用目录

### 🖼 文件预览
支持 95+ 扩展名,大型库全部 **动态 import** 懒加载,不阻塞主线程:

| 类别 | 格式 | 引擎 |
|------|------|------|
| 🖼 图片 | `.jpg .png .gif .webp .svg .bmp .ico` 等 | 原生 `<img>` |
| 🎬 视频 | `.mp4 .webm .mov .mkv .avi` | `<video>` + 首帧抽帧 |
| 🎵 音频 | `.mp3 .wav .ogg .flac` | `<audio>` + 波形 |
| 📕 PDF | `.pdf` | pdfjs-dist |
| 🔤 字体 | `.ttf .otf .woff .woff2` | FontFace API |
| 📦 压缩包 | `.zip .tar .gz .tgz .bz2 .7z` | fflate |
| 📝 Word | `.docx` | mammoth.js |
| 📊 Excel | `.xlsx .xlsm .xlsb` | SheetJS |
| 🎞 PowerPoint | `.pptx` | JSZip |
| 📄 RTF | `.rtf` | @iarna/rtf-to-html |
| 🔡 Markdown | `.md .markdown` | marked + highlight.js |
| 💻 代码 | `.ts .tsx .js .py .go .rs .java .c .cpp ...` | highlight.js |
| 📃 文本 | `.txt .log .csv .env ...` | 行号显示 |

**17 种 unsupported 格式给转换提示**:`.doc`(旧 Word 二进制) / RAW 相机格式(`.cr2 .cr3 .nef .arw .dng .rw2 .orf`) / Adobe(`.psd .ai`) / `.heic .heif` / `.flac .ape .midi` / `.sketch` 等,提示用什么工具转成可预览的格式。

无扩展名文件通过 **filename override + 内容嗅探**:识别 `Dockerfile` / `Makefile` / `README` / `LICENSE` / dotfile 等。

### 📊 多种视图模式
- **List** — 紧凑行 + 排序
- **Details** — 多列(名称 / 大小 / 修改时间 / 类型)
- **Grid** — 缩略图(图片自动生成 / 其它用 lucide 图标)

### 🪟 窗口管理
- 跨平台 **WindowProvider** 抽象(macOS / Windows / Linux 各自实现)
- macOS:正确处理 `app.dock.setIcon` + traffic light 占位
- 多窗口:每个窗口独立状态
- 单实例锁:第二次启动聚焦已有窗口

### 🎨 主题
- 内置暗 / 亮主题
- Accent 色可在主题中覆盖(默认 macOS 系统蓝 `#007AFF`)
- 设计 token:圆角 / 阴影 / 毛玻璃 / 字体
- 半透明 + `backdrop-filter: blur()` 毛玻璃(Sidebar / StatusBar / PathBar / CommandPalette / GlobalSearch)
- 全 `lucide-react` SVG 图标,零 emoji

### ⌨️ 快捷键
- 通过 **keymap 模块**注册
- 自带常用:`Cmd/Ctrl + T`(新标签) / `Cmd/Ctrl + W`(关标签) / `Cmd/Ctrl + L`(地址栏) / `Cmd/Ctrl + C/V/X`(复制 / 粘贴 / 剪切) / `F2`(重命名) / `Delete`(删除 / 移入回收站) / `F5`(刷新)
- 可扩展(扩展可注册新快捷键)

### 🧩 插件扩展系统 (VS Code 风格)
- **独立进程**:`child_process.fork` 加载每个扩展,沙箱化
- **JSON-RPC** 通信(主进程 ↔ ext-host)
- **生命周期**:`onStartup` / `onCommand:xxx` / `onFileSystem:xxx` 激活事件
- **激活管理**:`ActivationManager` 跟踪已激活 / 已停用
- 贡献点:命令 / 配置 / 视图
- 安全:扩展不可直接 `require('fs')`,必须走 RPC

### 🔐 许可证
- 启动 / 续期激活
- 已签发 license 持久化在 electron-store
- 启动屏显示状态

### 🚀 启动体验
- **Splash 屏**:启动阶段显示进度(`config → ext-host → window → ipc → ready`)
- **超时保护**:5s 未就绪强制关闭 splash,避免卡死
- **错误处理**:renderer crash 自动 log 到 main stderr
- **资源加载进度条**

### 📈 性能监控 (P7)
- **启动阶段计时**:`whenReady` / `windowReady` / `extHostReady` / `firstPaint` / `total`
- **埋点 API**:`PerfEvent` 上报 list-render / scroll / ipc-call 等
- **内存采样**:`setInterval` 周期记录主进程 / 渲染进程 rss + heapUsed
- **IPC 计数**:按 channel 聚合调用次数
- 后台 timer 全部 `unref`,不阻塞进程退出

### 🛡 平台抽象 (Provider 模式)
- **TrashProvider**:Windows(PowerShell + Shell.Application COM) / macOS(Finder) / Linux(gio)
- **WindowProvider**:macOS(`nativeImage.createFromPath` + dock icon) / Windows / Linux
- **DriveProvider**:跨平台枚举磁盘 / 挂载点
- 业务代码只依赖 interface,平台代码各自实现

---

## 🏗 架构 — 进程模型

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process (Node)                       │
│  - Window lifecycle, menus, tray, global shortcuts           │
│  - Filesystem operations (chokidar + electron-store)         │
│  - IPC routing (apps/main/src/main/ipc)                      │
│  - Extension host management (child_process.fork)            │
│  - Splash / Updater / Logger / Perf service                  │
│  - Platform Providers (Trash / Window / Drive)               │
└──────────────┬───────────────────────────────┬───────────────┘
               │ ipcMain / contextBridge       │ child_process.fork
               │                               │
┌──────────────▼──────────────┐ ┌────────────▼────────────────┐
│  Renderer (per window)     │  │  Extension Host (sandboxed)  │
│  React + Zustand            │  │  Loads .ext packages        │
│  via contextBridge only    │◄─┤  JSON-RPC over IPC pipe     │
│  contextIsolation: true     │  │                              │
│  nodeIntegration: false     │  │                              │
└─────────────────────────────┘  └───────────────────────────────┘
```

**🔒 安全原则(永不破坏)**
- Renderer 永远 `nodeIntegration: false` + `contextIsolation: true`
- 所有 OS 能力**异步**通过 `window.tabula.*` 暴露
- 永不在 renderer 里 `require('fs')` / `require('electron')`
- 外部链接走系统浏览器,禁止内嵌跳转
- Extension API 严格 RPC,不暴露 Node 内置

---

## 📦 项目结构

```
apps/
  main/          @tabula/main    Electron 主进程 + preload + 平台 Provider
  renderer/      @tabula/renderer React UI (TitleBar / Sidebar / Tabs / FileList / Preview)
  bridge/        @tabula/bridge  跨进程共享类型 / IPC channels / API 契约(单一来源)
packages/
  core/          @tabula/core    跨进程纯函数工具 (path / mime / id)
  ui/            @tabula/ui      设计系统 (tokens / Surface / Icon)
  ext-api/       @tabula/ext-api 插件 SDK (P6)
extensions/      内置扩展
docs/            设计文档
build-assets/    图标 / 资源
release/         打包产物(.dmg / .exe / .AppImage)
```

---

## 🛠 开发

### 环境
- Node 20+
- pnpm 9(`npm i -g pnpm`)
- 平台对应工具链(macOS 上需要 Xcode CLT;Windows 需要 VS Build Tools;Linux 需要常见 dev libs)

### 常用命令

```bash
pnpm install            # 安装依赖(workspace 自动 link)
pnpm dev                # 启动 Electron 开发模式(带 HMR)
pnpm build              # 构建到 out/{main,preload,renderer}
pnpm typecheck          # 全仓库 tsc --noEmit (strict)
pnpm test               # 跑 vitest(目前 60+ 测试)
pnpm package            # 构建 + 打包平台安装包
pnpm package:dir        # 构建 + 输出未打包目录(本地快速验证)
```

### 添加新的 IPC channel

`apps/bridge` 是**单一来源**。每个新通道需要:
1. 在 `apps/bridge/src/channels.ts` 加常量
2. 在 `apps/bridge/src/types.ts` 加 input/output 类型
3. 在 `apps/bridge/src/api.ts` 加方法签名
4. 然后才在 main / preload / renderer 实现

### 添加新平台适配

- 平台相关代码放进 `apps/main/src/main/providers/<area>/<platform>.ts`
- 同时在 `providers/<area>/index.ts` 的工厂里按 `process.platform` 选择
- 业务代码只 `import { getXxxProvider } from '...'` 拿接口,不要直接导入平台文件

---

## 🔌 扩展开发(预览)

每个扩展是带 `extension.json` 的目录:

```json
{
  "id": "my-extension",
  "version": "0.1.0",
  "main": "./dist/extension.js",
  "activationEvents": ["onStartup"],
  "contributes": {
    "commands": [
      { "id": "myExt.sayHello", "title": "Say Hello" }
    ]
  }
}
```

```ts
// dist/extension.js
export function activate(context) {
  context.subscriptions.push(
    context.commands.registerCommand('myExt.sayHello', () => {
      context.window.showMessage('Hello from extension!');
    })
  );
}
export function deactivate() {}
```

---

## 📋 路线图

| Phase | 目标 | 状态 |
|-------|------|------|
| P0 | 脚手架(Electron + Vite + React + TS + IPC) | ✅ |
| P1 | 核心浏览(文件列表 / breadcrumb / 地址栏 / 排序 / 视图) | ✅ |
| P2 | 标签 + 窗格(多标签 / 分屏 / 拖动 / 焦点切换) | ✅ |
| P3 | 文件操作(复制 / 移动 / 删除 / 重命名 / 拖放) | ✅ |
| P4 | 搜索 + 预览(image / video / audio / pdf / 字体) | ✅ |
| P5 | 主题 / 快捷键 / 命令面板 / 全局搜索 | ✅ |
| P6 | 扩展系统(沙箱 + RPC + activation) | ✅ |
| P7 | Splash / 性能 / 更新 / 错误日志 | ✅ |
| P8 | 打包(macOS .dmg / Windows .exe / Linux .AppImage) | ✅ |
| P9 | 文档站 + 社区扩展市场 | 🚧 |

---

## 🧪 验证

```bash
pnpm typecheck    # 0 errors
pnpm test         # 60+ tests passed
pnpm dev          # macOS 风格 UI 验证
pnpm package:dir  # 平台原生运行(无安装步骤)
pnpm package      # 完整安装包(macOS .dmg / Win .exe / Linux .AppImage)
```

---

## 📄 详细设计

见 [docs/PLAN.md](./docs/PLAN.md)。

---

## 📜 许可

AGPL-3.0(or your commercial license — see LICENSE file).
