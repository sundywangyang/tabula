/**
 * 插件发现
 *
 * 扫描以下目录寻找插件：
 * - 内置插件：<app>/extensions/  (打包时)
 * - 内置插件：<repo>/extensions/  (开发时)
 * - 用户插件：<userData>/extensions/
 *
 * 读取每个插件的 package.json，验证 manifest 完整性。
 */
import { readFile } from 'node:fs/promises';
import { readdirSync, statSync, existsSync, promises as fsPromises } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { app } from 'electron';
import type {
  ExtensionManifest,
  ExtensionContributions,
} from '@tabula/bridge';

const BUILTIN_EXTENSIONS_DEV = join(app.getAppPath(), 'extensions');
const BUILTIN_EXTENSIONS_PROD = join(process.resourcesPath ?? '', 'extensions');

function isBuiltinExtensionsDir(dir: string): boolean {
  try {
    statSync(dir);
    return true;
  } catch {
    return false;
  }
}

async function readManifest(dir: string): Promise<ExtensionManifest | null> {
  try {
    const pkgPath = join(dir, 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    return parseAndValidateManifest(pkg, dir);
  } catch {
    return null;
  }
}

function parseAndValidateManifest(
  pkg: Record<string, unknown>,
  dir: string,
): ExtensionManifest | null {
  // 必须字段
  const id = pkg['name'] as string | undefined;
  const name = pkg['name'] as string | undefined;
  const version = pkg['version'] as string | undefined;
  const main = (pkg['main'] as string | undefined) ?? 'index.js';

  if (!id || !name || !version) return null;

  const displayName = (pkg['displayName'] as string | undefined) ?? id;
  const description = pkg['description'] as string | undefined;
  const publisher = pkg['publisher'] as string | undefined;
  const engines = (pkg['engines'] as { app?: string }) ?? { app: '*' };
  const activationEvents = (pkg['activationEvents'] as string[]) ?? [];
  const contributes = (pkg['contributes'] as ExtensionContributions) ?? {};

  return {
    id,
    name,
    displayName,
    version,
    description,
    publisher,
    main,
    engines: { app: engines.app ?? '*' },
    activationEvents,
    contributes,
    path: dir,
    enabled: true,
    builtin: false,
  };
}

async function scanDir(
  dir: string,
  builtin: boolean,
): Promise<ExtensionManifest[]> {
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir);
  const manifests: ExtensionManifest[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) continue;

      const manifest = await readManifest(fullPath);
      if (manifest) {
        manifest.builtin = builtin;
        manifests.push(manifest);
      }
    } catch {
      // 跳过无法访问的目录
    }
  }

  return manifests;
}

export interface DiscoveredExtension {
  manifest: ExtensionManifest;
  userEnabled: boolean; // 用户设置（electron-store）
}

/**
 * 发现所有插件
 */
export async function discoverExtensions(
  userExtensionsDir: string,
  devMode: boolean,
): Promise<ExtensionManifest[]> {
  const manifests: ExtensionManifest[] = [];

  // 1. 内置插件目录
  const builtinDirs = devMode
    ? [BUILTIN_EXTENSIONS_DEV]
    : [BUILTIN_EXTENSIONS_PROD];

  for (const dir of builtinDirs) {
    if (isBuiltinExtensionsDir(dir)) {
      const found = await scanDir(dir, true);
      manifests.push(...found);
      console.log(`[ext-host] discovered ${found.length} builtin extensions from ${dir}`);
    }
  }

  // 2. 用户插件目录
  if (isBuiltinExtensionsDir(userExtensionsDir)) {
    const userFound = await scanDir(userExtensionsDir, false);
    manifests.push(...userFound);
    console.log(`[ext-host] discovered ${userFound.length} user extensions from ${userExtensionsDir}`);
  }

  return manifests;
}

/**
 * 安装插件（从 zip 或目录复制到用户扩展目录）
 * 返回新安装插件的 manifest
 */
export async function installExtension(
  sourcePath: string,
  userExtensionsDir: string,
): Promise<ExtensionManifest> {
  // 读取源 package.json
  const manifest = await readManifest(sourcePath);
  if (!manifest) {
    throw new Error(`Invalid extension: no valid package.json at ${sourcePath}`);
  }

  // 目标目录
  const destDir = join(userExtensionsDir, manifest.id);

  await fsPromises.mkdir(userExtensionsDir, { recursive: true });

  // 如果目标已存在，报错
  if (existsSync(destDir)) {
    throw new Error(`Extension already installed: ${manifest.id}`);
  }

  // 复制整个目录
  await fsPromises.cp(sourcePath, destDir, { recursive: true });

  // 返回新的 manifest（path 指向安装位置）
  return { ...manifest, path: destDir, builtin: false };
}

/**
 * 卸载插件（从用户扩展目录删除）
 */
export async function uninstallExtension(
  extId: string,
  userExtensionsDir: string,
): Promise<void> {
  const extDir = join(userExtensionsDir, extId);

  if (!existsSync(extDir)) {
    throw new Error(`Extension not found: ${extId}`);
  }

  await fsPromises.rm(extDir, { recursive: true, force: true }); // 永久删除，不用回收站
}
