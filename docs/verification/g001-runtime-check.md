# G001 Runtime Verification (2026-06-24)

> 历史 ZIP 运行记录，保留 2026-06-24 当时的 75 项测试、11 项往返检查及原始观察。下文行号、临时脚本和安全审阅结论只属于当时场景，不代表当前全项目验收。最新基线 `d76f7c8` 的 370 项测试与已知缺口见[真实进度核查](project-progress-audit-2026-10-28.md)，后续工作见[项目路线图](../feature-roadmap.md)。

## Summary
G001 (ZIP compress/extract via fflate) verified as RUNTIME WORKING.

## Verifications
- Typecheck: 0 errors
- Tests: 75/75 passed (vitest)
- Runtime roundtrip test: 11/11 checks PASS
  - 3 flat files (a/b/c.txt)
  - Nested dir (nested/inner1.txt + nested/inner2.txt with Chinese content)
  - Empty dir (empty-dir/) preserved as `empty-dir/` key in zip + recreated on disk
  - Unicode filename (中文文件.txt) preserved byte-identical
  - Spaces-in-filename (file with spaces.txt) preserved byte-identical
  - All files byte-identical after roundtrip

## Security Review
No issues found.
- Zip Slip: guarded at zip-provider.ts:528 (`target.startsWith(normDest + sep) && target !== normDest`)
- Symlinks: skipped in scanDir (zip-provider.ts:84-87)
- Path separators: toZipPath() normalizes `\` → `/` for zip keys
- Empty dir: directory entries preserved via `${name}/` keys with empty Uint8Array
- Memory scale: documented GB-level limit (acceptable per source comment)

## Test Script
`/tmp/g001-runtime-test.mjs` (resolves fflate from workspace pnpm store)