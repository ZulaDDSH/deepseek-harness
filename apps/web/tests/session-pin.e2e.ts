// Pin and unpin through sidebar row menus: the pinned row leads its list, the
// pin is durable on the host and survives reload. This flow makes no model calls.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser, Locator, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  acknowledgeReloadConnectionLoss, launchWebScaffold, seedSession, watchConsole, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))
const OLD_ID = 'session-pin-web-e2e-old'
const NEW_ID = 'session-pin-web-e2e-new'

describe('web e2e: pinned sessions lead the sidebar list', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  async function rowTitles(): Promise<string[]> {
    const all = await page.locator('[role="treeitem"]:not([aria-expanded]) [class*="title"]').allTextContents()
    return all.filter(title => title !== 'New Session')
  }

  async function clickHoverAction(row: Locator, name: string): Promise<void> {
    const button = row.getByRole('button', { name })
    await expect.poll(async () => {
      await row.hover()
      return await button.isVisible()
    }, { timeout: 10_000 }).toBe(true)
    await button.click()
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const seed = await readFile(SEED, 'utf8')
    const workspace = await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    await workspace.attachSession(await seedSession(scaffold, seed, OLD_ID, undefined, { createdAt: Date.now() - 600_000 }))
    await workspace.attachSession(await seedSession(scaffold, seed, NEW_ID, undefined, { createdAt: Date.now() - 60_000 }))
    await scaffold.ctx.sessionController.rename({ sessionId: SessionId(OLD_ID), title: 'Pin target old' })
    await scaffold.ctx.sessionController.rename({ sessionId: SessionId(NEW_ID), title: 'Pin target new' })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    await page.addInitScript((account) => {
      if (localStorage.getItem('dsh.workspace.view.v5') !== null) return
      localStorage.setItem('dsh.workspace.view.v5', JSON.stringify({
        groupBy: 'workspace', orderBy: 'manual', groupExpansion: { [account]: true }, sessionOrderByAccount: {},
      }))
    }, workspace.id)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('pins the older session to the top, keeps it across reload, and unpins it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-session-pin'))
    await expect.poll(rowTitles, { timeout: 15_000 }).toEqual(['Pin target new', 'Pin target old'])

    const oldRow = page.getByRole('treeitem').filter({ has: page.getByText('Pin target old', { exact: true }) })
    await clickHoverAction(oldRow, 'Session actions for Pin target old')
    await page.getByRole('menuitem', { name: 'Pin session' }).click()
    await expect.poll(
      () => [...scaffold.ctx.workspaceRegistry.pinnedSessionIds],
      { timeout: 10_000 },
    ).toEqual([SessionId(OLD_ID)])
    await expect.poll(rowTitles, { timeout: 10_000 }).toEqual(['Pin target old', 'Pin target new'])
    await expect.poll(() => oldRow.getByRole('img', { name: 'Pinned' }).count(), { timeout: 10_000 }).toBe(1)

    const warningStart = tripwire.warnings.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    acknowledgeReloadConnectionLoss(tripwire, warningStart)
    await expect.poll(rowTitles, { timeout: 15_000 }).toEqual(['Pin target old', 'Pin target new'])

    await clickHoverAction(oldRow, 'Session actions for Pin target old')
    await page.getByRole('menuitem', { name: 'Unpin session' }).click()
    await expect.poll(
      () => [...scaffold.ctx.workspaceRegistry.pinnedSessionIds],
      { timeout: 10_000 },
    ).toEqual([])
    await expect.poll(rowTitles, { timeout: 10_000 }).toEqual(['Pin target old', 'Pin target new'])
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
