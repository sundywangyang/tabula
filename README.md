# Tabula

> 多标签 + 分屏窗格文件管理器，包含试验性插件宿主。
> 当前以 Windows 本机验证为主，包含 macOS / Linux 适配代码与打包配置。

![license](https://img.shields.io/badge/license-AGPL--3.0-lightgrey)

当前进度基线：`0.1.0 / d76f7c8`（2026-10-28）。42 个测试文件、370 项测试、类型检查和正式构建已重新通过；当前提交尚未完成安装包、macOS / Linux 和外部系统服务验收。完整状态及已确认缺口见[真实进度核查](docs/verification/project-progress-audit-2026-10-28.md)。

产品、交互、架构、数据和后续演进见[项目设计文档](docs/design.md)。

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
- 普通拖动可拖出到其他应用；按住 `Alt` 拖动可在窗口内移动文件
- 粘贴遇同名时弹**冲突解决**对话框(覆盖 / 跳过 / 重命名)
- **批量重命名**对话框(统一前缀 / 后缀 / 替换 / 编号)
- **压缩 / 解压** ZIP、TAR、TGZ，支持任务进度和取消
- 标签随重命名 / 移动迁移，核心文件操作支持撤销 / 重做
- **应用内复制 / 剪切 / 粘贴**：窗口内保存文件操作状态，系统剪贴板写入路径文本；尚未接通资源管理器的原生文件剪贴板格式
- 系统**回收站**:macOS Finder / Windows 回收站 / Linux gio

### 🔍 搜索
- **命令面板**(`Cmd/Ctrl + Shift + P`):模糊匹配内置命令；路径通过地址栏输入
- **全局搜索**(`Cmd/Ctrl + Shift + F`):跨目录递归搜索,带文件类型过滤
- 工具栏 **文件工具 → 全文内容搜索 / 查找重复文件**，支持扫描进度、取消和结果定位
- **历史记录**:最近访问过的路径
- **书签 / 收藏**:固定常用目录

### 🖼 文件预览
包含以下格式的预览入口。预览按类型设定大小上限；文档、媒体、归档等先读取整个文件，文本超过阈值时截断显示。扩展名识别不等同于所有编码都能解码，音视频播放取决于 Electron 的解码能力。

| 类别 | 格式 |
|------|------|
| 🖼 图片 | `.jpg .png .gif .webp .svg .bmp .ico` 等 |
| 🎬 视频 | `.mp4 .webm .mov .mkv .avi` |
| 🎵 音频 | `.mp3 .wav .ogg .flac` |
| 📕 PDF | `.pdf` |
| 🔤 字体 | `.ttf .otf .woff .woff2` |
| 📦 压缩包 | `.zip .tar .gz .tgz`（`.tar.gz` 按 TGZ 处理） |
| 📝 Word | `.docx` |
| 📊 Excel | `.xlsx .xlsm .xlsb` |
| 🎞 PowerPoint | `.pptx` |
| 📄 RTF | `.rtf` |
| 🔡 Markdown | `.md .markdown` |
| 💻 代码 | `.ts .tsx .js .py .go .rs .java .c .cpp ...` |
| 📃 文本 | `.txt .log .csv .env ...` |

不支持的格式给**转换提示**:`.doc` / RAW 相机格式(`.cr2 .cr3 .nef .arw .dng .rw2 .orf`) / Adobe(`.psd .ai`) / `.heic .heif` / `.ape .midi` / `.sketch` 等,提示用什么工具转成可预览的格式。

无扩展名文件也能识别:`Dockerfile` / `Makefile` / `README` / `LICENSE` / dotfile 等。

### 📊 多种视图模式
- **List** — 紧凑行 + 排序
- **Details** — 多列(名称 / 大小 / 修改时间 / 类型)
- **Grid** — 缩略图视图
- 类型 / 日期 / 大小分组，当前目录类型筛选，设置中调整缩略图尺寸

### 🧰 文件工具
- 文件操作历史时间线、软 / 硬链接查看与管理、自定义文件夹图标
- Windows SMB / NFS 映射及系统默认应用设置入口
- 逐项实现与验证范围见 [Feature Roadmap](docs/feature-roadmap.md)

### 🪟 窗口管理
- macOS / Windows / Linux 窗口 Provider 适配；本轮运行核验为 Windows
- macOS 风格:Dock 图标 + 标题栏 traffic light 占位
- 多窗口：各自持有运行时布局，持久化仍共用 `layoutV1`，尚未提供逐窗口独立会话恢复
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
- 设置中可修改内置命令快捷键；扩展快捷键贡献尚未接入此命令目录

### 🧩 插件扩展系统（部分实现）
- 插件发现、独立 Node 子进程、启动激活、命令调用及示例统计面板已接通
- 扩展拥有 Node 文件系统访问能力，当前没有插件权限隔离
- `onStartup` 已接通；`onCommand:xxx` / `onFileSystem:xxx` 的自动激活尚未接通
- 已确认禁用后重新启用不能恢复命令；命令面板 / 快捷键贡献、配置和预览器等集成仍待补齐


### 🚀 启动体验
- **Splash 屏**：显示启动进度，并设超时关闭；包含日志与性能采样入口，尚未建立性能基准验收

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

当前加载器读取扩展目录中的 `package.json`，通过 `name` 识别扩展，入口使用 CommonJS。API 由 `activate(context)` 注入；包导出的同名 API 仍是占位实现。

```json
{
  "name": "my-extension",
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
// dist/extension.js（CommonJS）
exports.activate = function (context) {
  context.commands.registerCommand('myExt.sayHello', () => {
    console.log('Hello from extension!');
    return 'Hello from extension!';
  });
};
exports.deactivate = function () {};
```

---

## 📋 路线图

| Phase | 目标 | 状态 |
|-------|------|------|
| P0 | 脚手架 | 已实现，类型检查与正式构建通过 |
| P1 | 核心浏览 | 主体已实现，Windows 本机验证 |
| P2 | 标签 + 窗格 | 主体已实现；桥接 tabs / panes 仍为占位，持久化未按窗口隔离 |
| P3 | 文件操作 | 核心操作及进程内撤销已接通；原生文件剪贴板与外部拖拽验收待完成 |
| P4 | 搜索 + 预览 | 有界内容扫描、重复文件及多格式预览已实现；不含索引 / OCR / 流式大文件预览 |
| P5 | 主题 / 快捷键 / 命令面板 | 内置流程已接通；命令面板无路径搜索，扩展贡献待接入 |
| P6 | 扩展系统 | 部分实现；存在已复现的激活与重新启用问题，尚无权限隔离 |
| P7 | Splash / 性能 / 错误日志 | 启动屏、日志与采样已实现；性能基准和更新发布链路未验收 |
| P8 | 打包(macOS / Windows / Linux) | 三平台配置与旧 Windows 产物存在；当前提交重包 / 安装、签名及跨平台验收待完成 |
| P9 | 文档站 + 社区扩展市场 | 未交付 |



---

## 📜 许可

AGPL-3.0(or your commercial license — see LICENSE file).
