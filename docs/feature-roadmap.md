# Tabula Feature Roadmap

> 基于 Windows 11 File Explorer / macOS Finder 差距分析,按用户频率 × 实现成本优先级排序。

---

## 🔴 P0 — 日常必用,缺失明显

| 状态 | 功能 | 成本 | 说明 |
|------|------|------|------|
| ✅ 完成 | 压缩/解压 ZIP | 中 | fflate 0.8.3,list/compress/extract/cancelJob/progress事件 |
| 🔲 待做 | **Invert Selection(反选)** | 低 | 10行代码,大列表刚需 |
| 🔲 待做 | **属性对话框(modal)** | 中 | Toast装不下size+时间戳+路径+权限 |
| 🔲 待做 | **橡皮筋选择(拖框选)** | 中 | 点选太痛 |
| 🔲 待做 | **详情视图列头点击排序** | 低 | 已经能看,点列头排序是"理应如此" |
| 🔲 待做 | **Quick Look快捷键(Space)** | 低 | PreviewPanel已存在,加快捷键直通 |
| 🔲 待做 | **Group By(分组)** | 中 | list视图下多文件时效率高 |

## 🟡 P1 — 专业用户高频,普通用户偶尔

| 状态 | 功能 | 成本 |
|------|------|------|
| 🔲 待做 | **Tags(标记)** | 中-高 |
| 🔲 待做 | **Connect to Server(SMB/NFS) / Map Network Drive | 中 |
| 🔲 待做 | **Lock File只读/锁定** | 低 |
| 🔲 待做 | **Make Alias / 符号链接** | 低 |
| 🔲 待做 | **撤销/重做(操作栈)** | 中 |
| 🔲 待做 | **批量重命名(Total Commander风格)** | 中 |
| 🔲 待做 | **Show in Folder后保留选中** | 低 |
| 🔲 待做 | **文件校验和SHA-256** | 低 |
| 🔲 待做 | **计算文件夹大小改善(已有入口,改善UX)** | 低 |
| 🔲 待做 | **tar/tgz 支持** | 低 | fflate已支持,加TarArchiveProvider |
| 🔲 待做 | **选中文件高亮拖拽到外部App(系统D&D)** | 中 | Electron drag API |
| 🔲 待做 | **按文件类型筛选工具栏** | 中 | Finder工具栏风格 |

## 🟢 P2 — 低频/可改进

| 功能 | 成本 | 说明 |
|------|------|------|
| Undo/Redo操作栈 | 中 | Finder没有,Win有,值得做 |
| 智能搜索(全文内容搜索) | 高 | 需文件类型dispatcher |
| Duplicate Finder(找重复文件) | 高 | 按size+hash |
| 文件历史时间线 | 中 | 与mtime排序有关 |
| 文件名批量重命名 | 中 | Total Commander风格 |
| 软链接/硬链接管理 | 低 | fs.symlink |
| 自定义文件夹图标 | 中 | 平台API |
| 缩略图尺寸调整 | 低 | View options |
| 文件关联管理(改默认应用) | 中 | 设置页 |

## ⛔ 跳过 — 平台专属/成本过高

- AirDrop, BitLocker, File History, Home Group, 3D Objects(Windows专属)
- Versions, Spotlight集成, iCloud共享, Quick Look extensions(macOS专属)
- Cloud providers(OAuth+各SDK)
- 加密/密码解压(短期跳过,已有ArchiveEncrypted错误码占位)
- ZIP64(>4GB单文件)
- GBK文件名转码(WinRAR中文ZIP兼容) — 留v2

---

## 最近完成

- `83b32f9` feat(archive): compress/extract ZIP via fflate
  - Bridge契约/IPC/Provider/Manager/UI集成/15个单元测试/75个全部通过
  - `pnpm typecheck` exit 0

## 架构约束

- Electron 33 + Vite 5 + React 18 + TypeScript 5.7 strict
- contextIsolation: true, 全OS访问走 `window.tabula.*`
- `Result<T>` discriminated union: `{ ok: true, data } | { ok: false, error }`
- Provider模式: `providers/{drive,trash,window,shell,archive}/`
- 跨进程错误: `Result<T>` 从不throw
