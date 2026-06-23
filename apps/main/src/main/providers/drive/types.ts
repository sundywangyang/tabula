/**
 * DriveProvider — 平台特定的"列出挂载卷/驱动器"能力抽象。
 *
 * 为什么不直接 if/else: 各平台命令/解析差异巨大 (Win PowerShell, macOS df+mount,
 * Linux df+findmnt), 同一文件 100+ 行 if 链难维护, 也不利于后续单平台单元测试。
 *
 * 工厂按 process.platform 选实现, 调用方拿 DriveProvider 接口就能 listDrives。
 *
 * 见 ./windows.ts, ./macos.ts, ./linux.ts, ./index.ts
 */
import type { DriveInfo } from '@tabula/bridge';

export interface DriveProvider {
  /** 列出该平台所有挂载的卷/驱动器 */
  listDrives(): Promise<DriveInfo[]>;
}
