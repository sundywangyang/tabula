# Tabula快捷键参考

> **最后更新**:2026-06-08(随 P2 v2 split-handle拖动 + P7 v1快捷键自定义 UI同步落地)
> 相关方案:`docs/PLAN.md` 第5 节「关键交互 /快捷键」、第7 节「分阶段交付」。

##简介

Tabula 的所有命令都通过统一的 `commandId` 注册,内置 35+ 个命令,**支持用户在「设置 →快捷键」中自定义绑定**(P7 v1 已实现)。本节列出所有内置命令的语义、默认绑定,以及 P2 v2 新增的 split-handle 拖动手势与键盘步进。

快捷键的**优先级**:

1. 用户自定义绑定(最高)
2. 内置默认绑定
3.冲突时,「设置 →快捷键」页面给出红色告警条 +占用方提示

---

## 命令清单(按组)

>命名规则:`<域>.<动词>`,全部小写。括号内为**默认绑定**;用户可在设置页改写。

### 文件操作(`file.*`)

| 命令 ID | 默认绑定 |行为 |
|---|---|---|
| `file.open` | `Ctrl+O` / `Enter` | 在当前 pane打开选中文件或进入子目录 |
| `file.copy` | `Ctrl+C` | 复制选中项到剪贴板 |
| `file.cut` | `Ctrl+X` | 剪切选中项到剪贴板 |
| `file.paste` | `Ctrl+V` | 从剪贴板粘贴到当前目录 |
| `file.rename` | `F2` | 进入内联重命名状态 |
| `file.refresh` | `F5` | 重新扫描当前目录 |
| `file.delete` | `Delete` | 删除到回收站 |
| `file.delete-permanent` | `Shift+Delete` | 永久删除 |
| `file.duplicate` | `Ctrl+D` | 复制到同级目录 |
| `file.new-folder` | `Ctrl+Shift+N` | 在当前目录新建文件夹 |
| `file.select-all` | `Ctrl+A` | 全选 |

###标签(`tabs.*`)

| 命令 ID | 默认绑定 |行为 |
|---|---|---|
| `tab.new` | `Ctrl+T` | 在当前 pane 新建空白标签(默认打开「此电脑」) |
| `tab.close` | `Ctrl+W` / `Ctrl+F4` |关闭当前 pane 的活动标签 |
| `tab.next` | `Ctrl+Tab` |切到下一个标签(循环) |
| `tab.prev` | `Ctrl+Shift+Tab` |切到上一个标签(循环) |

###窗格(`panes.*`)

| 命令 ID | 默认绑定 |行为 |
|---|---|---|
| `pane.splitHorizontal` | `Ctrl+\` | 在当前焦点 pane **下方**新建 pane(垂直分隔) |
| `pane.splitVertical` | `Ctrl+Shift+\` | 在当前焦点 pane **右侧**新建 pane(水平分隔) |
| `pane.close` | `Ctrl+Alt+Shift+\` |关闭当前焦点 pane(其余兄弟按比例放大) |
| `pane.focusLeft` | `Ctrl+Alt+←` |焦点切到左侧 pane |
| `pane.focusRight` | `Ctrl+Alt+→` |焦点切到右侧 pane |
| `pane.focusUp` | `Ctrl+Alt+↑` |焦点切到上方 pane |
| `pane.focusDown` | `Ctrl+Alt+↓` |焦点切到下方 pane |
| **`pane.resizeLeft`** ← **P2 v2 新增** | `Alt+←` | 当前焦点 pane所在 split **向左挤**20px |
| **`pane.resizeRight`** ← **P2 v2 新增** | `Alt+→` | 当前焦点 pane所在 split **向右挤**20px |
| **`pane.resizeUp`** ← **P2 v2 新增** | `Alt+↑` | 当前焦点 pane所在 split **向上挤**20px |
| **`pane.resizeDown`** ← **P2 v2 新增** | `Alt+↓` | 当前焦点 pane所在 split **向下挤**20px |

> **resize 系列**:按一下移动20px,按住不松开则连续步进。最小约束:**任一 pane ≥60px**;剩余空间分配给兄弟。详见下文「P2 v2 split-handle章节」。

###视图(`view.*`)

| 命令 ID | 默认绑定 |行为 |
|---|---|---|
| `view.list` | `Ctrl+1` |列表视图 |
| `view.grid` | `Ctrl+2` |网格视图(图标 +名称) |
| `view.details` | `Ctrl+3` |详情视图(列:名称 / 修改时间 / 大小 / 类型) |

###搜索(`search.*`)

| 命令 ID | 默认绑定 |行为 |
|---|---|---|
| `search.focus` | `Ctrl+L` / `F6` | 地址栏/搜索框聚焦 |
| `search.global` | `Ctrl+P` / `Ctrl+Shift+F` | 全局模糊搜索(类似 VS Code Ctrl+P) |

###预览(`preview.*`)

| 命令 ID | 默认绑定 |行为 |
|---|---|---|
| `preview.toggle` | `Space` |切换快速预览面板(macOS Finder QuickLook风格) |

###主题(`theme.*`)

| 命令 ID | 默认绑定 |行为 |
|---|---|---|
| `theme.toggle` | `Ctrl+Shift+T` | 在 `light` / `dark` / `system` 三态间循环 |

### 设置(`settings.*`)

| 命令 ID | 默认绑定 |行为 |
|---|---|---|
| `settings.open` | `Ctrl+,` |打开设置页(支持「快捷键」「主题」「外观」「高级」4 个 tab) |

---

## P2 v2 split-handle章节(新)

> **P2 v2关键交互**:`SplitNode` 中央的分隔条(splitter)现在支持**鼠标拖动**、**双击重置**、**键盘步进**三种交互。

###1.鼠标拖动

- 把鼠标放在 split节点**中央的分隔条**上(命中区8px)。
- 光标自动变 `col-resize`(水平分隔条)或 `row-resize`(垂直分隔条)。
- **按住左键拖动**实时调整相邻两 pane 的比例:
 - **最小**:`60px`(任一 pane不能再小,再拖就锁住该侧)
 - **最大**:`总宽 -60px`(留给兄弟)
-拖动过程中实时绘制 ghost 高亮线;松开后通过 IPC持久化到当前 `WindowState`。
-拖动结束时,如果总尺寸变化导致超过60px约束,会**自动 clamp** 而非报错。

###2. 双击分隔条

- 双击(split节点的)分隔条 = **重置当前 split节点为50/50**。
- 若 split已有 `n` 个子节点,均匀重置为 `1/n`比例(总和不等于1 时,会 normalize)。

###3.键盘步进(`Alt+方向键`)

- **触发条件**:焦点在某个 pane 内(任意子元素均可,不需要先点 splitter)。
- **行为**:对焦点 pane **所在的最内层 split** 进行20px步进的尺寸调整。
-方向语义与 `pane.resizeLeft/Right/Up/Down` 一致(详见上文命令清单)。
- 与 `Ctrl+Alt+方向键`(`pane.focus*`)的区别:**焦点不移动**,只调比例。

---

## P7 v1 自定义快捷键章节(新)

> **P7 v1 新增**:「设置 →快捷键」标签页允许用户**重绑定**任意内置命令 /插件命令。

###能力

- **26 个内置命令** +插件贡献的命令均可被重绑定。
- 支持单修饰键(`Ctrl` / `Alt` / `Shift` / `Meta`) + 主键组合;不支持纯功能键(`F1`–`F24` 可以)。
- **11 个系统保留组合**(「`Ctrl+Alt+Delete`」「`Ctrl+Shift+Esc`」等)只读,灰色标记不可改。
- 重绑定走 **capture模式**:按下「录制」按钮后,所有按键被监听并写入绑定。
- `Esc` =取消 capture;`Backspace` = **解除当前绑定**(置空)。
-冲突时,右侧实时显示「已被 `commandId`占用」+ 一键跳转。

### 数据流

```
Renderer: User录入按键 → setKeybinding(cmdId, chord)
 ↓ IPC
Main: electron-store持久化到 ~/.tabula/config.json#keybindings
 ↓ IPC
Renderer: Zustand keybindingStore重新解析 →重新注册 DOM keydown listener
```

###导入 /导出

- 设置页右上角支持 **导出 JSON** / **导入 JSON**(合并模式或覆盖模式二选一)。

---

##附录:快捷键优先级与冲突解决

```
优先级(高 → 低):
1. 用户自定义 keybindingMap[commandId]
2. 内置 defaultKeybindingMap[commandId]
3.插件贡献 keybindings(由 ext-host 注册)
```

- **冲突检测**:同一 chord绑到 ≥2 个命令时,设置页给出红色 banner +占用方提示。
- **解决方式**:用户可选择「保留现有」或「改用新绑定」,改写后即时生效。

---

> 本文档随 P2 v2 与 P7 v1 同时落地;P3 文件操作补全后同步更新了 file.* 节(P3 完成)。后续新增命令时请同步更新本文件 + `apps/bridge/src/api.ts`。
