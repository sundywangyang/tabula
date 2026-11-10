// @vitest-environment node
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { needsSystemChooser } from '../archive-applications';

let root = '';
beforeEach(async () => {
  const base = join(process.cwd(), 'out', 'test-fixtures');
  await fs.mkdir(base, { recursive: true });
  root = await fs.mkdtemp(join(base, 'archive-zone-'));
});
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); });

it.skipIf(process.platform !== 'win32')('detects downloaded files without altering the archive or its security marker', async () => {
  const file = join(root, '中文 & archive.rar');
  await fs.writeFile(file, 'archive contents');
  expect(await needsSystemChooser(file)).toBe(false);
  const stream = `${file}:Zone.Identifier`;
  await fs.writeFile(stream, '[ZoneTransfer]\r\nZoneId=3\r\n');
  expect(await needsSystemChooser(file)).toBe(true);
  expect(await fs.readFile(stream, 'utf8')).toContain('ZoneId=3');
  expect(await fs.readFile(file, 'utf8')).toBe('archive contents');
  await fs.writeFile(stream, '[ZoneTransfer]\r\nZoneId=2\r\n');
  expect(await needsSystemChooser(file)).toBe(false);
  await fs.writeFile(stream, '[ZoneTransfer]\r\nUnknown=1\r\n');
  expect(await needsSystemChooser(file)).toBe(true);
});
