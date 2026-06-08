# Tabula

Windows 端现代化文件管理器,核心特性:**多标签 + 窗格分区** + VS Code 式插件扩展。

## 开发

```bash
pnpm install
pnpm dev          # 启动开发模式(带 HMR)
pnpm build        # 构建
pnpm package      # 打包成 .exe
```

## 目录结构

```
apps/
  main/        Electron 主进程
  renderer/    React 渲染层
  bridge/      跨进程共享类型/IPC 通道
packages/
  core/        跨进程纯函数/工具
  ui/          设计系统
  ext-api/     插件 SDK
extensions/    内置扩展
docs/          文档
```

## 详细设计

见 [docs/PLAN.md](./docs/PLAN.md)。
