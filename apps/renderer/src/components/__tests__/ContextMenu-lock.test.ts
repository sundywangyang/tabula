/**
 * G010 lock/unlock: read-only 位判定单元测试 (防回归)
 *
 * 背景:
 *  - 修复前使用 `(mode & 0o400) === 0` 判定「owner 只读」。
 *  - 但 0o400 是 owner-READ 位。Windows 上 fs.chmod(0o444)→mode=100444,
 *    fs.chmod(0o644)→mode=100666。两种 mode 都含 0o400 位,无法区分。
 *  - 正确做法:检查 owner-WRITE 位 (0o200),缺失则表示 read-only。
 *
 * 此测试只覆盖纯函数 `isReadOnly`,不依赖 React/IPC。
 */
import { describe, expect, it } from 'vitest';
import { isReadOnly } from '../../utils/permissions';

describe('ContextMenu.isReadOnly (G010)', () => {
  it('mode=0o444 → read-only (write bit 缺失)', () => {
    expect(isReadOnly(0o444)).toBe(true);
  });

  it('mode=0o644 → not read-only (write bit 存在)', () => {
    expect(isReadOnly(0o644)).toBe(false);
  });

  it('mode=0o600 → not read-only (write bit 存在)', () => {
    expect(isReadOnly(0o600)).toBe(false);
  });

  it('mode=0o400 → read-only (no write bit)', () => {
    expect(isReadOnly(0o400)).toBe(true);
  });

  // Windows 上 stat 返回的 mode 会带 filetype 位 (S_IFREG = 0o100000)
  it('Windows mode=100444 (0o444 + S_IFREG) → read-only', () => {
    expect(isReadOnly(0o100444)).toBe(true);
  });

  it('Windows mode=100666 (0o666 + S_IFREG, chmod 0o644 后) → not read-only', () => {
    expect(isReadOnly(0o100666)).toBe(false);
  });

  // 防御性:不能意外把 0o400(read 位)误当成「只读」判据
  it('mode=0o444 也包含 0o400 位 — 证明用 0o400 判定会出错', () => {
    // 0o444 = 0b 100 100 100; 与 0o400 (0b 100 000 000) AND 不为 0
    expect((0o444 & 0o400) !== 0).toBe(true);
    // 0o644 = 0b 110 100 100; 与 0o400 AND 也不为 0
    expect((0o644 & 0o400) !== 0).toBe(true);
    // 这两个 mode 不能用 0o400 区分
  });

  // 必须用 0o200 (write bit) 区分
  it('mode=0o444 与 0o644 用 0o200 位可正确区分', () => {
    expect((0o444 & 0o200) === 0).toBe(true); // locked
    expect((0o644 & 0o200) === 0).toBe(false); // unlocked
  });
});