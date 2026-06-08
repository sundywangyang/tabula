/**
 * ID 生成
 * P0: 简单随机
 * 后续可换 nanoid
 */
export function uid(prefix = ''): string {
  const r = Math.random().toString(36).slice(2, 10);
  const t = Date.now().toString(36);
  return prefix ? `${prefix}_${t}${r}` : `${t}${r}`;
}
