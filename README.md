# Tabula

> 现代化的多标签 + 分屏窗格文件管理器,带 VS Code 风格插件系统。  
> 跨平台:macOS / Windows / Linux。

![macOS](https://img.shields.io/badge/macOS-supported-blue) ![Windows](https://img.shields.io/badge/Windows-supported-blue) ![Linux](https://img.shields.io/badge/Linux-supported-blue) ![license](https://img.shields.io/badge/license-AGPL--3.0-lightgrey)

---

## ✨ 核心特性

### 🗂 多标签 + 分屏窗格
- 同一窗口内开多个**标签**
- 标签可**水平 / 垂直分屏**成多个 pane,每个 pane 独立浏览路径
- 标签**拖拽改 pane**布局:在 pane 之间移动 / 复制 tab
- 单个 tab 可**关闭** / 固定 / 设为预览态

### 📁 文件操作
- 复制 / 移动 / 重命名 / 删除(支持**多选 + 批量**)
- 跨盘移动自动降级为 copy + delete
- **拖放**到目录 / sidebar / breadcrumb / tab 都能接收
- `Ctrl/⌘` 切换拖动为 copy,默认 move
- 粘贴遇同名时弹**冲突解决**对话框(覆盖 / 跳过 / 重命名)
- **批量重命名**对话框(统一前缀 / 后缀 / 替换 / 编号)
- 系统**剪贴板**:copy 与 cut 模式区分
- 系统**回收站**:macOS Finder / Windows 回收站 / Linux gio

### 🔍 搜索
- **命令面板**(`Cmd/Ctrl + Shift + P`):模糊匹配所有命令 + 路径
- **全局搜索**(`Cmd/Ctrl + Shift + F`):跨目录递归搜索,带文件类型过滤
- **历史记录**:最近访问过的路径
- **书签 / 收藏**:固定常用目录

### 🖼 文件预览
覆盖 95+ 扩展名,大文件全部按需加载:

| 类别 | 格式 |
|------|------|
| 🖼 图片 | `.jpg .png .gif .webp .svg .bmp .ico` 等 |
| 🎬 视频 | `.mp4 .webm .mov .mkv .avi` |
| 🎵 音频 | `.mp3 .wav .ogg .flac` |
| 📕 PDF | `.pdf` |
| 🔤 字体 | `.ttf .otf .woff .woff2` |
| 📦 压缩包 | `.zip .tar .gz .tgz .bz2 .7z` |
| 📝 Word | `.docx` |
| 📊 Excel | `.xlsx .xlsm .xlsb` |
| 🎞 PowerPoint | `.pptx` |
| 📄 RTF | `.rtf` |
| 🔡 Markdown | `.md .markdown` |
| 💻 代码 | `.ts .tsx .js .py .go .rs .java .c .cpp ...` |
| 📃 文本 | `.txt .log .csv .env ...` |

不支持的格式给**转换提示**:`.doc` / RAW 相机格式(`.cr2 .cr3 .nef .arw .dng .rw2 .orf`) / Adobe(`.psd .ai`) / `.heic .heif` / `.flac .ape .midi` / `.sketch` 等,提示用什么工具转成可预览的格式。

无扩展名文件也能识别:`Dockerfile` / `Makefile` / `README` / `LICENSE` / dotfile 等。

### 📊 多种视图模式
- **List** — 紧凑行 + 排序
- **Details** — 多列(名称 / 大小 / 修改时间 / 类型)
- **Grid** — 缩略图视图

### 🪟 窗口管理
- macOS / Windows / Linux 各自原生窗口行为
- macOS 风格:Dock 图标 + 标题栏 traffic light 占位
- 多窗口:每个窗口独立状态
- 单实例锁:第二次启动聚焦已有窗口

### 🎨 主题
- 内置暗 / 亮主题
- Accent 色可自定义(默认 macOS 系统蓝)
- 半透明 + 毛玻璃效果
- macOS 风格设计(圆角 / 阴影 / 系统字体 / lucide 图标)

### ⌨️ 快捷键
- `Cmd/Ctrl + T` 新标签 / `Cmd/Ctrl + W` 关标签 / `Cmd/Ctrl + L` 地址栏
- `Cmd/Ctrl + C/V/X` 复制 / 粘贴 / 剪切
- `F2` 重命名 / `Delete` 删除(移入回收站) / `F5` 刷新
- 可由扩展注册新快捷键

### 🧩 插件扩展系统
- VS Code 风格的扩展机制
- 沙箱化运行环境,扩展无法直接访问系统
- 生命周期:`onStartup` / `onCommand:xxx` / `onFileSystem:xxx`
- 贡献点:命令 / 配置 / 视图

### 🔐 许可证
- 启动 / 续期激活
- 状态在启动屏显示

### 🚀 启动体验
- **Splash 屏**:显示启动进度,不会卡死

---

## 🛠 开发

### 环境
- Node 20+
- pnpm 9(`npm i -g pnpm`)

### 常用命令

```bash
pnpm install      # 安装依赖
pnpm dev          # 启动开发模式(带 HMR)
pnpm build        # 构建
pnpm package      # 打包成平台安装包
pnpm package:dir  # 输出未打包目录(本地快速验证)
```

---

## 🔌 扩展开发

每个扩展是一个带 `extension.json` 的目录:

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
| P0 | 脚手架 | ✅ |
| P1 | 核心浏览 | ✅ |
| P2 | 标签 + 窗格 | ✅ |
| P3 | 文件操作 | ✅ |
| P4 | 搜索 + 预览 | ✅ |
| P5 | 主题 / 快捷键 / 命令面板 | ✅ |
| P6 | 扩展系统 | ✅ |
| P7 | Splash / 性能 / 错误日志 | ✅ |
| P8 | 打包(macOS / Windows / Linux) | ✅ |
| P9 | 文档站 + 社区扩展市场 | 🚧 |

---

## 📄 详细设计

见 [docs/PLAN.md](./docs/PLAN.md)。

---

## 📜 许可

AGPL-3.0(or your commercial license — see LICENSE file).
