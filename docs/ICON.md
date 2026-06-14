# Tabula App Icon

## 设计方向: "多 tab 文件夹"

- **底层符号**: 经典 macOS Finder 风格文件夹（带顶部翻边 tab）
- **Tabula 区别于 Finder 的核心**: 顶部 3 个 tab pill（暗示多 tab）
- **第二特性**: 中间一条细分割线 + split handle（暗示 split pane）
- **Finder 蓝渐变** `#1F6FE5 → #1252B8 → #0A3478`: 让人一眼联想到 macOS Finder / Windows Explorer

## 文件清单

```
build-assets/icon/
  icon.svg              1024×1024 矢量主稿 (master)
  export.sh             多尺寸导出脚本
  png/                  16/32/64/128/256/512/1024 PNG
  Tabula.icns           macOS (16+32@2x+...+1024)
  Tabula.ico            Windows 多分辨率合集

docs/icon-preview.html  浏览器预览页 (含 dock / 任务栏 / dash 模拟)
```

## 重新生成 PNG / icns / ico

```bash
brew install librsvg imagemagick
cd build-assets/icon
./export.sh            # 全套
./export.sh png        # 只要 PNG
./export.sh icns       # 只要 icns
./export.sh ico        # 只要 ico
```

## 接入 app

### dev 模式 (`pnpm dev`)

`apps/main/src/main/window/window-manager.ts` 已在 `BrowserWindow` options 加 `icon` 字段：

- macOS: `build-assets/icon/Tabula.icns`
- Windows: `build-assets/icon/Tabula.ico`
- Linux/其他: `build-assets/icon/png/512.png`

### 打包 (`pnpm package`)

`electron-builder.yml` 显式配置：

- `mac.icon: build-assets/icon/Tabula.icns`
- `win.icon: build-assets/icon/Tabula.ico`
- `linux.icon: build-assets/icon/png/512.png`

`extraResources` 把多尺寸 PNG + icns + ico 一起打进 `resources/` 目录（asarUnpack 之外），打包后位于 `process.resourcesPath/resources/`。dev 模式 window-manager 直接从仓库路径读。

## 改 icon 后

1. 改 `build-assets/icon/icon.svg`
2. 跑 `./export.sh` 重生成 PNG + icns + ico
3. dev 模式：重启 `pnpm dev` 即可
4. 打包模式：跑 `pnpm package` 重新出包

## 预览

```bash
open docs/icon-preview.html
```

包含：多尺寸网格 / macOS dock / Windows 任务栏 / Linux dash 三平台 mock，深/浅/蓝三种背景环境测试。
