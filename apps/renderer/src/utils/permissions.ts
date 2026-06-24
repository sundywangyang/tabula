/**
 * 文件权限位工具 (G010)
 *
 * 判断一个文件的 POSIX mode 是否对 owner 只读。
 *
 * 正确做法:检查 owner-WRITE 位 (0o200)。
 * - 0o444 (locked):   write bit 缺失 → 只读
 * - 0o644 (unlocked): write bit 存在 → 可写
 *
 * 不要用 0o400 (owner-read 位) 判定:
 *   Windows 上 fs.chmod(path, 0o444) → mode = 100444,
 *   fs.chmod(path, 0o644)              → mode = 100666,
 *   两种 mode 都包含 0o400 位,无法区分 locked / unlocked。
 *
 * @param mode - POSIX 权限位(可能含 S_IFREG 0o100000 等 filetype 位)
 * @returns true 表示对 owner 只读(write bit 缺失)
 */
export function isReadOnly(mode: number): boolean {
  return (mode & 0o200) === 0;
}