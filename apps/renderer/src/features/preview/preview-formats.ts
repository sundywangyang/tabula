// 阈值:文本/代码/MD 超过此大小截断到 100 行
export const TEXT_TRUNCATE_BYTES = 1024 * 1024; // 1 MB
export const TEXT_TRUNCATE_LINES = 100;

// 图片超过此大小直接拒绝(避免一次性载入大图片卡死)
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
// 视频/音频 — 浏览器原生播放器对大文件支持较好, 上限放宽到 500MB
export const MEDIA_MAX_BYTES = 500 * 1024 * 1024;

// PDF — 太大直接拒绝, 100MB 够日常文档
export const PDF_MAX_BYTES = 100 * 1024 * 1024;

// 字体 — 单个字体文件通常 100KB-5MB, 20MB 上限足够
export const FONT_MAX_BYTES = 20 * 1024 * 1024;

// 压缩包 — 大型 zip(如带 node_modules) 几百 MB, 上限 1GB
export const ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024;

// Office 文档 (docx 等) — 单文件通常 <50MB
export const DOCX_MAX_BYTES = 50 * 1024 * 1024;

// Excel 表格
export const XLSX_MAX_BYTES = 100 * 1024 * 1024;

// PowerPoint
export const PPTX_MAX_BYTES = 100 * 1024 * 1024;

export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp',
  '.ico', '.heic', '.avif', '.tiff', '.tif', '.psd', '.raw',
]);

export const PDF_EXTS = new Set(['.pdf']);

export const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

export const ARCHIVE_EXTS = new Set(['.zip', '.tar', '.tgz', '.gz', '.bz2', '.7z', '.rar']);

export const DOCX_EXTS = new Set(['.docx', '.dotx']);

export const XLSX_EXTS = new Set(['.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.csv']);

export const PPTX_EXTS = new Set(['.pptx', '.ppt', '.odp']);

export const RTF_EXTS = new Set(['.rtf']);

export const VIDEO_EXTS = new Set([
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.ogv',
]);

export const AUDIO_EXTS = new Set([
  '.mp3', '.m4a', '.wav', '.flac', '.ogg', '.oga', '.opus', '.aac', '.wma',
]);

export const MARKDOWN_EXTS = new Set(['.md', '.markdown', '.mdx']);

export const CODE_EXTS = new Set([
  // 已有主流
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.json5', '.jsonc',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.htm', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.sh', '.bash', '.zsh', '.ps1', '.sql', '.lua', '.rb', '.php', '.pl',
  // 前端框架
  '.vue', '.svelte', '.astro', '.scss', '.sass', '.less', '.styl',
  // 现代语言
  '.swift', '.kt', '.kts', '.dart', '.scala', '.sc', '.mjs',
  // 函数式
  '.hs', '.elm', '.clj', '.cljs', '.cljc', '.edn', '.ex', '.exs', '.erl', '.hrl',
  // 数据科学
  '.r', '.R', '.jl', '.m', '.mm',
  // 数据/协议
  '.proto', '.graphql', '.gql', '.thrift', '.avro',
  // 系统/构建
  '.zig', '.nim', '.cr', '.v', '.sv', '.vhd', '.vhdl',
  // 文本格式 (会被当代码高亮)
  '.diff', '.patch', '.tex',
  // 配置/工具
  '.dockerignore', '.editorconfig', '.gitattributes', '.gitignore',
  // 编译产物 (字节码 / 字节码文本)
  '.class', '.wasm',
]);

export const TEXT_EXTS = new Set(['.txt', '.log', '.csv', '.tsv', '.env', '.properties']);

/** 无扩展名文件 — 按常见文件名识别为文本/code (Dockerfile / Makefile / LICENSE / README 等) */
export const FILENAME_OVERRIDES: ReadonlyMap<string, PreviewKind> = new Map([
  // dotfiles
  ['.gitignore', 'text'], ['.gitattributes', 'text'], ['.editorconfig', 'text'],
  ['.dockerignore', 'text'], ['.npmrc', 'text'], ['.yarnrc', 'text'],
  ['.npmignore', 'text'], ['.prettierrc', 'text'], ['.eslintrc', 'text'],
  ['.babelrc', 'text'], ['.browserslistrc', 'text'],
  // 项目元数据
  ['README', 'markdown'], ['README.md', 'markdown'], ['README.txt', 'text'],
  ['LICENSE', 'text'], ['LICENSE.md', 'markdown'], ['LICENCE', 'text'],
  ['CHANGELOG', 'text'], ['CHANGELOG.md', 'markdown'],
  ['CONTRIBUTING', 'markdown'], ['AUTHORS', 'text'], ['NOTICE', 'text'],
  // 构建/CI
  ['Makefile', 'code'], ['GNUmakefile', 'code'], ['Rakefile', 'code'],
  ['CMakeLists.txt', 'code'], ['Vagrantfile', 'code'],
  ['Brewfile', 'text'], ['Podfile', 'code'],
  // 容器/shell
  ['Dockerfile', 'code'], ['Containerfile', 'code'],
  ['docker-compose.yml', 'code'], ['docker-compose.yaml', 'code'],
  // shell
  ['gradlew', 'code'], ['mvnw', 'code'],
  // gem
  ['Gemfile', 'code'], ['Rakefile', 'code'],
  // 其他
  ['justfile', 'code'], ['Procfile', 'code'],
]);

/** 嗅探无扩展名文件的前 4KB 判定 kind (仅在 filename 匹配失败时) */
export function sniffKindFromText(head: string): PreviewKind {
  const s = head.trimStart();
  if (!s) return 'text';
  // Shebang #! — 各种脚本
  if (s.startsWith('#!')) {
    // #!/usr/bin/env python / bash / node / ruby / perl / php
    // #!/bin/sh / bash / zsh / python3
    if (/python|node|deno|bun|ruby|perl|php|tcl|lua|bash|sh|zsh|fish|awk|sed|make/i.test(s)) return 'code';
    return 'text';
  }
  // YAML
  if (/^---\s*$/m.test(head)) return 'code';
  // JSON
  if (/^[\s]*[{\[]/.test(s)) return 'code';
  // XML
  if (/^<\?xml|^\s*<[a-zA-Z]/.test(s)) return 'code';
  // Markdown (起始行 # / ## 或 > )
  if (/^#{1,6}\s+\S|^>\s+\S/m.test(head)) return 'markdown';
  return 'text';
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'font' | 'archive' | 'docx' | 'xlsx' | 'pptx' | 'rtf' | 'markdown' | 'code' | 'text' | 'unsupported';

/**
 * @param name 文件名 (含扩展名), 例如 "README.md" / "Makefile" / "foo.PDF"
 * @param head  可选 — 文件前 4KB (utf-8 字符串), 用于无扩展名嗅探
 */
export function detectKind(name: string, head?: string): PreviewKind {
  const ext = extOf(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (FONT_EXTS.has(ext)) return 'font';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  if (DOCX_EXTS.has(ext)) return 'docx';
  if (XLSX_EXTS.has(ext)) return 'xlsx';
  if (PPTX_EXTS.has(ext)) return 'pptx';
  if (RTF_EXTS.has(ext)) return 'rtf';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (CODE_EXTS.has(ext)) return 'code';
  if (TEXT_EXTS.has(ext)) return 'text';
  // 无扩展名: filename override
  if (!ext) {
    const base = name.split('/').pop() ?? name;
    const override = FILENAME_OVERRIDES.get(base);
    if (override) return override;
    if (head !== undefined) return sniffKindFromText(head);
  }
  return 'unsupported';
}

export function extOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';   // 无扩展名 / 隐藏文件 (.gitignore 走 override)
  return base.slice(dot).toLowerCase();
}

/** unsupported 状态下给用户友好的"如何转存"建议 */
export const CONVERSION_HINTS: ReadonlyMap<string, string> = new Map([
  ['.doc', '旧 Word 二进制格式, 请在 Word 里"另存为 .docx" 或用 LibreOffice 转 .docx'],
  ['.raw', 'RAW 相机格式需要 libraw 解码, 请用相机自带软件或 darktable 导出 .jpg/.png'],
  ['.cr2', 'Canon RAW 格式, 请用 Canon DPP / darktable / Adobe Lightroom 导出 .jpg'],
  ['.cr3', 'Canon CR3 RAW 格式, 同 .cr2 处理方式'],
  ['.nef', 'Nikon RAW 格式, 请用 Nikon NX Studio / darktable 导出 .jpg'],
  ['.arw', 'Sony RAW 格式, 请用 Sony IDC / darktable 导出 .jpg'],
  ['.dng', 'Adobe DNG 格式, 请用 darktable / Adobe Lightroom 导出 .jpg'],
  ['.rw2', 'Panasonic RAW 格式, 请用 Silkypix / darktable 导出 .jpg'],
  ['.orf', 'Olympus RAW 格式, 请用 darktable 导出 .jpg'],
  ['.psd', 'Photoshop 格式, 建议在 Photoshop 里"另存为 .png" 或用 GIMP 打开再导出'],
  ['.ai', 'Adobe Illustrator 格式, 建议在 AI 里"另存为 .svg" 或导出 .pdf'],
  ['.sketch', 'Sketch 设计稿, 建议导出 .pdf 或用 Lunacy 等工具转 .svg'],
  ['.heic', 'HEIF/HEIC 格式, Safari 与 macOS 原生支持, 其他平台可用 heif-convert 转 .jpg'],
  ['.heif', 'HEIF 格式, 同 .heic 处理方式'],
  ['.flac', 'FLAC 音频浏览器已支持播放 (顶部 toolbar 可见时长), 但不显示波形 (浏览器 codec 限制)'],
  ['.ape', 'APE 音频 Monkey\'s Audio 格式, 浏览器不支持, 请转 .flac / .mp3'],
  ['.midi', 'MIDI 文件需要专用渲染器, 浏览器不支持播放, 请转 .mp3 / .wav'],
]);

export function suggestConversionFor(ext: string): string | null {
  return CONVERSION_HINTS.get(ext.toLowerCase()) ?? null;
}

export function mimeFromExt(ext: string): string {
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.bmp':
      return 'image/bmp';
    case '.ico':
      return 'image/x-icon';
    case '.heic':
      return 'image/heic';
    case '.avif':
      return 'image/avif';
    case '.tiff':
    case '.tif':
      return 'image/tiff';
    case '.psd':
      return 'image/vnd.adobe.photoshop';
    case '.raw':
      return 'image/raw';
    case '.pdf':
      return 'application/pdf';
    case '.ttf':
      return 'font/ttf';
    case '.otf':
      return 'font/otf';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    // Archives (binary; previewed via ArchiveView, not <video>/<img>)
    case '.zip':
      return 'application/zip';
    case '.tar':
      return 'application/x-tar';
    case '.tgz':
    case '.gz':
      return 'application/gzip';
    case '.bz2':
      return 'application/x-bzip2';
    case '.7z':
      return 'application/x-7z-compressed';
    case '.rar':
      return 'application/vnd.rar';
    case '.docx':
    case '.dotx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.xlsx':
    case '.xlsm':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.xlsb':
      return 'application/vnd.ms-excel.sheet.binary.macroEnabled.12';
    case '.ods':
      return 'application/vnd.oasis.opendocument.spreadsheet';
    case '.csv':
      return 'text/csv';
    case '.pptx':
    case '.ppt':
    case '.odp':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.rtf':
      return 'application/rtf';
    // Video
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.mkv':
    case '.avi':
    case '.wmv':
    case '.flv':
      return 'video/x-matroska';
    case '.ogv':
      return 'video/ogg';
    // Audio
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
    case '.aac':
      return 'audio/aac';
    case '.wav':
      return 'audio/wav';
    case '.flac':
      return 'audio/flac';
    case '.ogg':
    case '.oga':
    case '.opus':
      return 'audio/ogg';
    case '.wma':
      return 'audio/x-ms-wma';
    default:
      return 'application/octet-stream';
  }
}
