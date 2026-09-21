// Web e2e scenario: Chat Sections in the assembled application under a real
// browser. The package-level jsdom specs drive the same operations through
// synthetic events; what they cannot show is the assembled experience — real
// HTML5 drag-and-drop across the sidebar's scroll container, the portaled row
// menus, and the browser-local layer surviving a document reload. This
// scenario drives those three and asserts the sidebar the operator sees.
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

/** The section column, distinguished from the Workspace tree by its aria-label. */
const sectionTree = (page: Page) => page.getByRole('tree', { name: 'Sections' })
/** The section's header row, which carries its action verbs. */
const sectionHeader = (page: Page, name: string) =>
  sectionTree(page).getByRole('treeitem', { name: `Section actions for ${name}` })
const ungrouped = (page: Page) => page.getByRole('group', { name: 'Ungrouped chats' })
/**
 * The chat rows inside one section, scoped to the section tree and identified
 * by their aria-selected seat — a section's group also contains the header
 * row, and a Workspace group can carry the section's name.
 */
const sectionMembers = (page: Page, name: string) =>
  sectionTree(page).getByRole('group', { name }).locator('[role="treeitem"][aria-selected]')

/** Create a section through the header control and its dialog. */
async function createSection(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New section' }).click()
  const dialog = page.getByRole('dialog', { name: 'New section' })
  await dialog.getByRole('textbox').fill(name)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await sectionHeader(page, name).waitFor()
}

describe('web e2e: Chat Sections', () => {
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

  it('organizes chats into sections, keeps ungrouped chats, and survives a reload', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-chat-sections'))

    // Before any section exists the sidebar keeps its ordinary projection.
    await expect.poll(() => page.getByRole('tree', { name: 'Sessions' }).count()).toBe(1)
    expect(await sectionTree(page).count()).toBe(0)

    // Creating a section selects the Sections mode and leaves every seeded chat
    // in the ungrouped area.
    await createSection(page, 'Work')
    await ungrouped(page).waitFor()
    const beforeMove = await ungrouped(page).getByRole('treeitem').count()
    expect(beforeMove).toBe(2)

    // With sections present, the other Group by modes stay reachable — that is
    // what keeps Workspaces, search, and Activity usable after organizing.
    const pickView = async (name: string): Promise<void> => {
      await page.getByRole('button', { name: 'View options' }).click()
      await page.getByRole('menuitem', { name, exact: true }).click()
    }
    await pickView('WorkSpace')
    await expect.poll(() => page.getByRole('tree', { name: 'Sessions' }).count()).toBe(1)
    expect(await sectionTree(page).count()).toBe(0)
    await pickView('Sections')
    await expect.poll(() => sectionHeader(page, 'Work').count()).toBe(1)

    // Drag one chat onto the section header: the section joins it.
    const chatRow = ungrouped(page).getByRole('treeitem').first()
    await chatRow.dragTo(sectionHeader(page, 'Work'))
    await expect.poll(() => sectionMembers(page, 'Work').count()).toBe(1)
    expect(await ungrouped(page).getByRole('treeitem').count()).toBe(1)

    // Collapsing hides the member and keeps the section's chat count.
    await sectionHeader(page, 'Work').click()
    await expect.poll(() => sectionHeader(page, 'Work').getAttribute('aria-expanded')).toBe('false')
    expect(await sectionMembers(page, 'Work').count()).toBe(0)
    await sectionHeader(page, 'Work').click()
    await expect.poll(() => sectionHeader(page, 'Work').getAttribute('aria-expanded')).toBe('true')
    await expect.poll(() => sectionMembers(page, 'Work').count()).toBe(1)

    // A reload restores the layer: sections, membership, and order are all
    // browser-local, so nothing here depends on the Host.
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await expect.poll(() => sectionHeader(page, 'Work').count()).toBe(1)
    await expect.poll(() => sectionMembers(page, 'Work').count()).toBe(1)

    // The row menu offers the same move drag-and-drop does: send it back.
    const restored = sectionMembers(page, 'Work').first()
    await restored.hover()
    await restored.getByRole('button', { name: /Session actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Remove from section' }).click()
    await expect.poll(() => ungrouped(page).getByRole('treeitem').count()).toBe(beforeMove)

    // The menu also moves a chat in, so a move needs no drag gesture.
    await ungrouped(page).getByRole('treeitem').first().hover()
    await ungrouped(page).getByRole('button', { name: /Session actions for/ }).first().click()
    await page.getByRole('menuitem', { name: 'Move to section' }).click()
    await page.getByRole('menuitem', { name: 'Work' }).click()
    await expect.poll(() => sectionMembers(page, 'Work').count()).toBe(1)

    // Renaming rebinds nothing: the section keeps its chats under a new name.
    await sectionHeader(page, 'Work').hover()
    await sectionHeader(page, 'Work').getByRole('button', { name: /Section actions for Work/ }).click()
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    const rename = page.getByRole('dialog', { name: 'Rename section' })
    await rename.getByRole('textbox').fill('Server Debugging')
    await rename.getByRole('button', { name: 'Rename' }).click()
    await expect.poll(() => sectionHeader(page, 'Server Debugging').count()).toBe(1)
    await expect.poll(() => sectionMembers(page, 'Server Debugging').count()).toBe(1)

    // Deleting the section leaves every chat in the ungrouped area rather than
    // deleting them, and does not move the operator to another mode.
    const beforeDelete = await ungrouped(page).getByRole('treeitem').count()
    await sectionHeader(page, 'Server Debugging').hover()
    await sectionHeader(page, 'Server Debugging').getByRole('button', { name: /Section actions for/ }).click()
    await page.getByRole('menuitem', { name: 'Delete section' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete section' })
    await confirm.getByText(/Its chats are not deleted/).waitFor()
    await confirm.getByRole('button', { name: 'Delete section' }).click()
    await expect.poll(() => sectionHeader(page, 'Server Debugging').count()).toBe(0)
    // The freed chat rejoins the ungrouped list, one row more than before.
    await expect.poll(() => ungrouped(page).getByRole('treeitem').count()).toBe(beforeDelete + 1)

    // And the ordinary Workspace view is still one menu pick away.
    await pickView('WorkSpace')
    await expect.poll(() => page.getByRole('tree', { name: 'Sessions' }).count()).toBe(1)
    await expect.poll(() => page.getByRole('treeitem').count()).toBeGreaterThan(0)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 180_000)
})
