import { test, expect } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let directory
const fixtures = {
  'jobs/hopsworks/create-repos-r1.txt': 'Name: create-repos-r1\n  Containers:\n    Command:\n      kubectl rollout status statefulset/opensearch\n    Environment:\nEvents:\n Warning BackoffLimitExceeded 5m job-controller Job has reached the specified backoff limit',
  'pods/logs/hopsworks/opensearch-0/opensearch.log': '[2026-10-03T09:24:38,464][ERROR] Failed to complete delete batches\njava.lang.RuntimeException: Missing required header for this request: Content-Md5.\n\n\tat example.Client.delete(Client.java:1)\n[2026-10-03T09:24:39Z][WARN ] failed to finish repository verification\nCaused by: Missing required header for this request: Content-Md5.',
  'jobs/hopsworks/migrate-r1.txt': 'Pods Statuses: 0 Active (0 Ready) / 1 Succeeded / 1 Failed\nNormal Completed 5m job-controller Job completed',
  'pods/logs/hopsworks/migrate-r1-old/migrate.log': '[rondb] FATAL: tables missing after conversion: task_reschedule',
  'pods/logs/hopsworks/opensearch-0/opensearch.previous.log': 'previous terminated container "opensearch" in pod "opensearch-0" not found',
  'events.hopsworks.txt': '5m Warning FailedMount pod/service secret not found',
  'empty.txt': '',
}
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'utils-ci-e2e-'))
  for (const [path, text] of Object.entries(fixtures)) {
    const target = join(directory, path)
    await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, text)
  }
})
test.afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

test('CI folder import correlates failures, exposes source context, exports findings, and opens the log viewer', async ({ page }) => {
  const errors = [], external = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4174') && !request.url().startsWith('blob:')) external.push(request.url()) })
  await page.goto('/?tool=ci')
  await page.getByLabel('CI log folder', { exact: true }).setInputFiles(directory)
  await expect(page.locator('.ci-summary')).toContainText('7 files')
  await expect(page.locator('.ci-summary')).toContainText('1 failed Job')
  const lead = page.getByLabel('Investigation starting point')
  await expect(lead).toContainText('create-repos-r1.txt:7')
  await expect(lead).toContainText('S3 request is missing a required checksum')
  await lead.getByRole('button', { name: /S3 request is missing/ }).click()
  await expect(page.getByLabel('Source context')).toContainText('opensearch.log:2')
  await expect(page.locator('.ci-source-line.selected')).toContainText('Content-Md5')
  await expect(page.getByLabel('Source lines')).toContainText('example.Client.delete')
  await expect(page.getByLabel('Source lines').locator('.ci-source-line').nth(2).locator('pre')).toHaveText('')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save findings', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('ci-log-findings.md')
  const report = await readFile(await download.path(), 'utf8')
  expect(report).toContain('create-repos-r1.txt:7'); expect(report).toContain('Content-Md5')
  await page.getByLabel('Evidence', { exact: true }).selectOption('recovered')
  await expect(page.getByLabel('Failure findings')).toContainText('The owning Job completed')
  await expect(page.getByLabel('Failure findings')).not.toContainText('S3 request is missing')
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
  await page.setViewportSize({ width: 1800, height: 1100 })
  await page.screenshot({ path: '/tmp/utils-ci-explorer.png', animations: 'disabled' })
  await page.getByRole('button', { name: 'Open in log viewer', exact: true }).click()
  await expect(page.locator('.log-file-info')).toContainText('opensearch.log')
  await expect(page.getByText('2 matching', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'CI log explorer', exact: true }).click()
  await expect(page.locator('.ci-summary')).toContainText('7 files')
  expect(errors).toEqual([]); expect(external).toEqual([])
})

test('CI cross-file search filters sources, browses files, preserves full downloads, and works on mobile', async ({ page }) => {
  await page.goto('/?tool=ci')
  await page.getByLabel('CI log folder', { exact: true }).setInputFiles(directory)
  await expect(page.locator('.ci-summary')).toContainText('7 files')
  await page.getByLabel('Search all logs', { exact: true }).fill('content-md5')
  await expect(page.getByLabel('Cross-file search results')).toContainText('2 matching lines')
  await page.getByRole('button', { name: 'Inspect pods/logs/hopsworks/opensearch-0/opensearch.log line 6', exact: true }).click()
  await expect(page.locator('.ci-source-line.selected')).toContainText('Content-Md5')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  const download = await downloadPromise
  expect(await readFile(await download.path(), 'utf8')).toBe(fixtures['pods/logs/hopsworks/opensearch-0/opensearch.log'])
  await page.getByLabel('Search all logs', { exact: true }).fill('opensearch')
  await expect(page.getByLabel('Cross-file search results')).toContainText('2 matching lines')
  await page.getByLabel('Include previous logs', { exact: true }).uncheck()
  await expect(page.getByLabel('Cross-file search results')).toContainText('1 matching lines')
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click()
  await page.getByLabel('Find files', { exact: true }).fill('empty.txt')
  await page.getByLabel('Collected files').getByRole('button', { name: /empty.txt/ }).click()
  await expect(page.getByLabel('Source context')).toContainText('This file is empty.')
  await page.getByRole('button', { name: 'All files', exact: true }).click()
  await page.getByLabel('Find files', { exact: true }).fill('')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/utils-ci-mobile.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByText('Explore a CI run', { exact: true })).toBeVisible()
})

test('CI multi-file import caps search rows and cancels stale searches when cleared or replaced', async ({ page }) => {
  await page.goto('/?tool=ci')
  await page.getByLabel('CI log files', { exact: true }).setInputFiles([
    { name: 'runner.log', mimeType: 'text/plain', buffer: Buffer.from('needle\n'.repeat(250) + 'Process completed with exit code 1') },
    { name: 'binary.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2]) },
  ])
  await expect(page.locator('.ci-summary')).toContainText('2 files')
  await expect(page.getByText(/1 file could not be read/)).toBeVisible()
  await page.getByLabel('Search all logs', { exact: true }).fill('needle')
  await expect(page.getByLabel('Cross-file search results')).toContainText('250 matching lines · first 200 shown')
  await expect(page.locator('.ci-search-result')).toHaveCount(200)
  await page.getByLabel('Search all logs', { exact: true }).fill('not present')
  await page.getByLabel('CI log files', { exact: true }).setInputFiles({ name: 'new.log', mimeType: 'text/plain', buffer: Buffer.from('ready') })
  await expect(page.locator('.ci-summary')).toContainText('1 file')
  await expect(page.getByLabel('Search all logs', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Failure findings')).toContainText('No matching evidence')
})
