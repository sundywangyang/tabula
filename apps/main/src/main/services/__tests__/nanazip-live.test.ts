// @vitest-environment node
import { expect, it } from 'vitest';
import { getArchiveApplications, openWithArchiveApplication } from '../archive-applications';

// Opt-in only: opens a user-installed application with a dedicated test archive.
it.skipIf(process.platform !== 'win32' || !process.env.TABULA_NANAZIP_TEST_ARCHIVE)('detects NanaZip and submits a Windows open request', async () => {
  const path = process.env.TABULA_NANAZIP_TEST_ARCHIVE!;
  const app = (await getArchiveApplications(path)).find(item => item.name === 'NanaZip');
  expect(app).toBeDefined();
  const result = await openWithArchiveApplication(path, app!.id);
  expect(['application', 'system-chooser']).toContain(result.method);
});

it.skipIf(process.platform !== 'win32' || !process.env.TABULA_NANAZIP_RAR_ARCHIVE)('discovers registered handlers for an actual RAR file', async () => {
  const apps = await getArchiveApplications(process.env.TABULA_NANAZIP_RAR_ARCHIVE!);
  expect(apps.some(app => app.name === 'NanaZip')).toBe(true);
  expect(apps.length).toBeGreaterThan(0);
});
