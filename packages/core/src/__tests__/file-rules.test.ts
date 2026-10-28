import { describe, expect, it } from 'vitest';
import { defaultRenameRules, matchesCategory, renameByRules } from '../file-rules';
describe('rename rules', () => {
  it('combines prefixes, suffixes, replacement and padded numbering without losing extension', () => {
    expect(renameByRules('原图.png', 2, { ...defaultRenameRules, find: '原', replace: '新', prefix: '产品-', suffix: '-完成', template: '{name}-{n}', start: 10, step: 2, padding: 4 })).toBe('产品-新图-0014-完成.png');
  });
  it('supports explicit extension templates and dotfiles', () => {
    expect(renameByRules('Report.TXT', 0, { ...defaultRenameRules, template: '{n}.{ext}', caseMode: 'lower' })).toBe('001.txt');
    expect(renameByRules('Report.TXT', 0, { ...defaultRenameRules, caseMode: 'lower' })).toBe('report.txt');
    expect(renameByRules('.gitignore', 0, defaultRenameRules)).toBe('.gitignore');
  });
  it('filters folders separately from media and uses case-insensitive extensions', () => {
    expect(matchesCategory({ name: 'A.PNG', isDirectory: false }, 'image')).toBe(true);
    expect(matchesCategory({ name: 'a.png', isDirectory: true }, 'image')).toBe(false);
    expect(matchesCategory({ name: 'directory', isDirectory: true }, 'folder')).toBe(true);
    expect(matchesCategory({ name: 'a.mp4', isDirectory: false }, 'video')).toBe(true);
  });
});
