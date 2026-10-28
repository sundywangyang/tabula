import type { FileTypeCategory } from '../../../apps/bridge/src/tools';

const categories: Record<string, string[]> = {
  image: ['jpg','jpeg','png','gif','webp','svg','bmp','ico','avif','tif','tiff','heic','psd'],
  document: ['txt','md','markdown','pdf','doc','docx','xls','xlsx','ppt','pptx','rtf','csv','ods','odt'],
  code: ['ts','tsx','js','jsx','json','css','html','xml','yml','yaml','py','go','rs','java','c','cpp','h','cs','sh','sql','lua','toml'],
  archive: ['zip','zipx','tar','tgz','gz','bz2','7z','rar'],
  audio: ['mp3','wav','ogg','flac','m4a','aac','opus'], video: ['mp4','webm','mov','mkv','avi','wmv'],
};
export function matchesCategory(entry: { name: string; isDirectory: boolean }, category: FileTypeCategory = 'all'): boolean {
  if (category === 'all') return true;
  if (category === 'folder') return entry.isDirectory;
  if (entry.isDirectory) return false;
  return categories[category]?.includes(entry.name.toLowerCase().split('.').pop() ?? '') ?? false;
}
export interface RenameRules { find: string; replace: string; prefix: string; suffix: string; template: string; start: number; step: number; padding: number; caseMode: 'keep' | 'lower' | 'upper' }
export const defaultRenameRules: RenameRules = { find: '', replace: '', prefix: '', suffix: '', template: '{name}', start: 1, step: 1, padding: 3, caseMode: 'keep' };
export function renameByRules(original: string, index: number, rules: RenameRules): string {
  const dot = original.lastIndexOf('.');
  const extension = dot > 0 ? original.slice(dot) : '';
  const stem = dot > 0 ? original.slice(0, dot) : original;
  const replaced = rules.find ? stem.split(rules.find).join(rules.replace) : stem;
  const number = String(rules.start + index * rules.step).padStart(Math.max(1, Math.min(12, rules.padding)), '0');
  let name = rules.template.replace(/\{(name|ext|n)\}/g, (_, token: string) => token === 'name' ? replaced : token === 'ext' ? extension.slice(1) : number);
  name = `${rules.prefix}${name}${rules.suffix}${rules.template.includes('{ext}') ? '' : extension}`;
  if (rules.caseMode === 'lower') name = name.toLowerCase();
  if (rules.caseMode === 'upper') name = name.toUpperCase();
  return name;
}
