/**
 * 示例扩展：文件统计面板
 *
 * 展示如何在 P6 扩展系统中注册侧边栏面板 + 推送 panel 数据。
 *
 * 功能:
 * - 注册一个 "文件统计" 面板 + 同名命令
 * - 用户点 Sidebar 中的 "文件统计" 入口 → invokeCommand('sample-file-stats.panel', { panePath })
 * - ext-host 收到命令后,读 panePath 下的目录,统计文件数/目录数/总大小
 * - 通过 context.pushPanelData() 把数据推给 renderer
 * - renderer 顶层的 <ExtensionPanelView> 渲染成浮层
 *
 * 运行环境: ext-host 子进程(Node.js)
 *
 * @module sample-file-stats
 */

'use strict';

const { readdirSync, statSync } = require('node:fs');
const { join } = require('node:path');

const PANEL_ID = 'sample-file-stats.panel';

/**
 * 格式化字节大小为人类可读字符串
 */
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/**
 * 浅层统计一个目录(不递归,深递归可能非常慢)
 * 跳过无法访问的子目录(权限/符号链接环)
 */
function statDirShallow(dirPath) {
  const result = {
    path: dirPath,
    fileCount: 0,
    dirCount: 0,
    totalSize: 0,
    largestFile: null,
    fileTypes: {},
    error: null,
  };

  let entries;
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    result.error = `无法读取目录: ${err.message}`;
    return result;
  }

  for (const ent of entries) {
    const full = join(dirPath, ent.name);
    try {
      if (ent.isDirectory()) {
        result.dirCount++;
      } else if (ent.isFile()) {
        const st = statSync(full);
        result.fileCount++;
        result.totalSize += st.size;
        if (!result.largestFile || st.size > result.largestFile.size) {
          result.largestFile = { name: ent.name, size: st.size };
        }
        // 简单按扩展名分类
        const dot = ent.name.lastIndexOf('.');
        const ext = dot >= 0 ? ent.name.slice(dot + 1).toLowerCase() : '(无扩展名)';
        result.fileTypes[ext] = (result.fileTypes[ext] || 0) + 1;
      } else if (ent.isSymbolicLink()) {
        // 跳过符号链接,避免环
      }
    } catch {
      // 单个文件/目录无法访问 → 跳过
    }
  }
  return result;
}

/**
 * 激活函数
 */
async function activate(context) {
  console.log('[sample-file-stats] 扩展已激活');

  // 1. 注册面板
  context.subscriptions.push(
    context.panels.register({
      id: PANEL_ID,
      title: '文件统计',
      icon: '📊',
      location: 'left',
    }),
  );
  console.log(`[sample-file-stats] 面板已注册: ${PANEL_ID}`);

  // 2. 注册同名命令 — Sidebar 点击触发
  context.subscriptions.push(
    context.commands.registerCommand(PANEL_ID, async (args) => {
      const panePath = (args && args.panePath) || '';
      console.log(`[sample-file-stats] 统计目录: ${panePath || '(空)'}`);

      if (!panePath) {
        context.pushPanelData(PANEL_ID, {
          error: '当前 pane 没有路径,请先打开一个目录',
          path: '',
        });
        return;
      }

      const stats = statDirShallow(panePath);
      // 推给 renderer
      context.pushPanelData(PANEL_ID, {
        path: stats.path,
        fileCount: stats.fileCount,
        dirCount: stats.dirCount,
        totalSize: stats.totalSize,
        totalSizeFormatted: formatBytes(stats.totalSize),
        largestFile: stats.largestFile
          ? { ...stats.largestFile, sizeFormatted: formatBytes(stats.largestFile.size) }
          : null,
        fileTypes: stats.fileTypes,
        error: stats.error,
        scannedAt: new Date().toISOString(),
      });
    }),
  );

  // 3. 注册刷新命令(供命令面板 / 快捷键用)
  context.subscriptions.push(
    context.commands.registerCommand('sample-file-stats.refresh', async () => {
      console.log('[sample-file-stats] 刷新命令被调用');
    }),
  );

  // 4. 演示 workspace API
  try {
    const pkg = await context.workspace.readFile('package.json');
    const manifest = JSON.parse(pkg);
    console.log(`[sample-file-stats] 版本: ${manifest.version}`);
  } catch (err) {
    console.log(`[sample-file-stats] 无法读 package.json: ${err.message}`);
  }

  console.log('[sample-file-stats] 激活完成');
}

function deactivate() {
  console.log('[sample-file-stats] 扩展已停用');
}

module.exports = { activate, deactivate };
