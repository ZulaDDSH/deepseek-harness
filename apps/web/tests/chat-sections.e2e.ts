// Web e2e scenario: the Chat Sections pane in the assembled application under
// a real browser. Sections are a saved visual filter over the Workspace pane:
// this drives the two-pane layout, the cross-pane drag that files a Chat, the
// browser-local layer surviving a reload, and the Workspace pane keeping its
// own mode and filter control throughout.
//
// Seed sessions come from a recorded fixture, so the sidebar has real chats to
// organize. Zero model calls: organizing chats is browser-local and needs no
// Host support, which is what the reload assertion pins.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, seedSession, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const FIRST_ID = 'chat-sections-first'
const SECOND_ID = 'chat-sections-second'

/** The Sections pane's tree (the lower pane). */
const sectionsPane = (page: Page) => page.getByRole('tree', { name: 'Sections' })
/** The Workspace pane's tree (the upper pane). */
const workspaceTree = (page: Page) => page.getByRole('tree', { name: 'Sessions' })
/** A section's header row, which carries its action verbs. */
const sectionHeader = (page: Page, name: string) =>
  sectionsPane(page).getByRole('treeitem', { name: `Section actions for ${name}` })
/** The chats filed under one section. */
const filedChats = (page: Page, name: string) =>
  sectionsPane(page).getByRole('group', { name }).locator('[role="treeitem"][aria-selected]')

/** Create a section through the header control and its dialog. */
async function createSection(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New section' }).click()
  const dialog = page.getByRole('dialog', { name: 'New section' })
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await sectionHeader(page, name).waitFor()
}

describe('web e2e: Chat Sections pane', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const raw = await readFile(SEED, 'utf8')
    await seedSession(scaffold, raw, FIRST_ID)
    await seedSession(scaffold, raw, SECOND_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('stacks Sections below Workspaces and files a chat by dragging across panes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-chat-sections'))

    // Before any section exists there is one pane, and the Workspace list owns
    // the whole region.
    await expect.poll(() => workspaceTree(page).count()).toBe(1)
    expect(await sectionsPane(page).count()).toBe(0)

    // Creating a section adds the pane BELOW the existing list; the Workspace
    // list stays exactly where it was.
    await createSection(page, 'Work')
    await expect.poll(() => sectionsPane(page).count()).toBe(1)
    expect(await workspaceTree(page).count()).toBe(1)

    // The Workspace pane keeps its mode control AND its color/icon filter.
    expect(await page.getByRole('button', { name: 'View options' }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Filter workspaces' }).count()).toBe(1)

    // Drag a workspace row onto the section header: the cross-pane filing.
    // Seeded chats live inside their workspace group, so open it first.
    const group = workspaceTree(page).getByRole('treeitem', { hasText: 'Ungrouped' }).first()
    await group.click()
    const source = workspaceTree(page).getByRole('treeitem')
      .filter({ hasNotText: 'Ungrouped' }).first()
    await source.dragTo(sectionHeader(page, 'Work'))
    await expect.poll(() => filedChats(page, 'Work').count()).toBe(1)

    // Collapse hides the filed chat but keeps the section and its count.
    await sectionHeader(page, 'Work').click()
    await expect.poll(() => sectionHeader(page, 'Work').getAttribute('aria-expanded')).toBe('false')
    expect(await filedChats(page, 'Work').count()).toBe(0)
    await sectionHeader(page, 'Work').click()
    await expect.poll(() => sectionHeader(page, 'Work').getAttribute('aria-expanded')).toBe('true')
    await expect.poll(() => filedChats(page, 'Work').count()).toBe(1)

    // The pane and its contents are browser-local: a reload restores both, with
    // the Workspace list still above it.
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await expect.poll(() => sectionsPane(page).count()).toBe(1)
    await expect.poll(() => workspaceTree(page).count()).toBe(1)
    await expect.poll(() => sectionHeader(page, 'Work').count()).toBe(1)
    await expect.poll(() => filedChats(page, 'Work').count()).toBe(1)

    // Deleting the section removes the pane and returns the region to the
    // Workspace list alone, with every chat untouched.
    await sectionHeader(page, 'Work').hover()
    await sectionHeader(page, 'Work').getByRole('button', { name: /Section actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Delete section' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete section' })
    await confirm.getByText(/Its chats are not deleted/).waitFor()
    await confirm.getByRole('button', { name: 'Delete section' }).click()
    await expect.poll(() => sectionsPane(page).count()).toBe(0)
    await expect.poll(() => workspaceTree(page).count()).toBe(1)
    // The Workspace controls are still in place.
    expect(await page.getByRole('button', { name: 'View options' }).count()).toBe(1)
    expect(await page.getByRole('button', { name: 'Filter workspaces' }).count()).toBe(1)
    await expect.poll(() => workspaceTree(page).getByRole('treeitem').count()).toBeGreaterThan(0)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 180_000)
})
