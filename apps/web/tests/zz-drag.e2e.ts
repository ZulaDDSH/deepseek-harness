// Temporary: trace the cross-pane drag path in the real browser.
import { chromium } from 'playwright'
import { describe, it } from 'vitest'
import { launchWebScaffold, seedSession, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.v3.jsonl', import.meta.url))

describe('probe', () => {
  it('traces dragstart to drop', async () => {
    const scaffold: WebScaffold = await launchWebScaffold({})
    await seedSession(scaffold, await readFile(SEED, 'utf8'), 'drag-a')
    const browser = await chromium.launch()
    const page = await newEnglishPage(browser, 900)
    page.on('console', (m) => { console.log('[browser]', m.text()) })
    page.on('pageerror', (e) => { console.log('[pageerror]', e.message) })
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await page.waitForTimeout(2000)

    // Create one section.
    await page.getByRole('button', { name: 'New section' }).click()
    const d = page.getByRole('dialog', { name: 'New section' })
    await d.getByRole('textbox').fill('Work')
    await d.getByRole('button', { name: 'Create' }).click()
    await page.waitForTimeout(400)

    // Expand the workspace group so a chat row exists.
    await page.getByRole('treeitem', { hasText: 'Ungrouped' }).first().click()
    await page.waitForTimeout(400)

    // Instrument the DOM to log what the browser actually delivers.
    await page.evaluate(() => {
      const log = (tag: string) => (e: Event) => {
        const t = e.target as HTMLElement
        console.log(`DRAGEVT ${tag} on ${t.getAttribute('aria-label') ?? t.className.slice(0, 30)}`)
      }
      document.addEventListener('dragstart', log('dragstart'), true)
      document.addEventListener('dragover', log('dragover'), true)
      document.addEventListener('drop', log('drop'), true)
      document.addEventListener('dragend', log('dragend'), true)
    })

    const chat = page.getByRole('tree', { name: 'Sessions' }).getByRole('treeitem')
      .filter({ hasNotText: 'Ungrouped' }).first()
    const header = page.getByRole('tree', { name: 'Sections' })
      .getByRole('treeitem', { name: 'Section actions for Work' })
    console.log('CHAT_COUNT:', await chat.count(), 'HEADER_COUNT:', await header.count())

    const cBox = await chat.boundingBox()
    const hBox = await header.boundingBox()
    console.log('CHAT_BOX:', JSON.stringify(cBox), 'HEADER_BOX:', JSON.stringify(hBox))
    if (cBox === null || hBox === null) throw new Error('boxes missing')

    // The screenshot shows the drop hint ("Drop here to add to this section"),
    // which renders for a COLLAPSED section. Try each realistic target.
    const tryDrop = async (label: string, target: { x: number; y: number }): Promise<void> => {
      await page.mouse.move(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2)
      await page.mouse.down()
      for (let i = 1; i <= 10; i += 1) {
        await page.mouse.move(
          cBox.x + cBox.width / 2 + (target.x - (cBox.x + cBox.width / 2)) * (i / 10),
          cBox.y + cBox.height / 2 + (target.y - (cBox.y + cBox.height / 2)) * (i / 10),
        )
        await page.waitForTimeout(50)
      }
      await page.mouse.up()
      await page.waitForTimeout(700)
      const n = await page.getByRole('tree', { name: 'Sections' })
        .getByRole('group', { name: 'Work' }).locator('[role="treeitem"][aria-selected]').count()
      console.log(`TRY ${label} -> filed=${n}`)
    }

    console.log('--- drop on expanded header ---')
    await tryDrop('expanded-header', { x: hBox.x + hBox.width / 2, y: hBox.y + hBox.height / 2 })

    // Collapse the section: the hint appears, exactly as in the screenshot.
    await header.click()
    await page.waitForTimeout(400)
    const hint = await page.getByText('Drop here to add to this section').first().boundingBox()
    console.log('HINT_BOX:', JSON.stringify(hint))
    // Does the workspace row that starts the drag publish to the bus?
    const rowInfo = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="tree"][aria-label="Sessions"] [role="treeitem"]'))
        .map(r => ({
          label: r.getAttribute('aria-label') ?? r.textContent?.slice(0, 24) ?? '',
          draggable: r.getAttribute('draggable'),
        })))
    console.log('WORKSPACE_ROWS:', JSON.stringify(rowInfo))
    await page.evaluate(() => {
      document.addEventListener('dragstart', (e) => {
        const t = e.target as HTMLElement
        const item = t.closest('[role="treeitem"]')
        console.log(`DRAGSTART tree=${t.closest('[role="tree"]')?.getAttribute('aria-label')} item=${item?.getAttribute('aria-label') ?? item?.textContent?.slice(0, 20)}`)
      }, true)
    })

    // Re-read the header box AFTER the collapse re-layout: the pre-collapse
    // box is stale and points at whatever now occupies that y.
    const hBoxLive = await header.boundingBox()
    console.log('LIVE_HEADER_BOX:', JSON.stringify(hBoxLive))
    if (hBoxLive !== null) {
      const tx = hBoxLive.x + hBoxLive.width / 2
      const ty = hBoxLive.y + hBoxLive.height / 2
      console.log('TARGET_POINT:', tx, ty)
      const at = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        if (el === null) return 'none'
        // Walk up to the nearest tree to learn which PANE this belongs to.
        const tree = el.closest('[role="tree"]')
        const item = el.closest('[role="treeitem"]')
        return {
          tag: el.tagName,
          cls: el.className.slice(0, 40),
          tree: tree?.getAttribute('aria-label') ?? 'no-tree',
          itemLabel: item?.getAttribute('aria-label') ?? item?.textContent?.slice(0, 30) ?? 'no-item',
        }
      }, { x: tx, y: ty })
      console.log('ELEMENT_AT_TARGET:', JSON.stringify(at))

      await page.mouse.move(cBox.x + cBox.width / 2, cBox.y + cBox.height / 2)
      await page.mouse.down()
      for (let i = 1; i <= 10; i += 1) {
        await page.mouse.move(
          cBox.x + cBox.width / 2 + (tx - (cBox.x + cBox.width / 2)) * (i / 10),
          cBox.y + cBox.height / 2 + (ty - (cBox.y + cBox.height / 2)) * (i / 10),
        )
        await page.waitForTimeout(50)
      }
      await page.waitForTimeout(300)
      const atDrop = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y)
        if (el === null) return 'none'
        const tree = el.closest('[role="tree"]')
        const item = el.closest('[role="treeitem"]')
        return {
          tree: tree?.getAttribute('aria-label') ?? 'no-tree',
          itemLabel: item?.getAttribute('aria-label') ?? 'no-item',
        }
      }, { x: tx, y: ty })
      console.log('AT_DROP:', JSON.stringify(atDrop))
      // Does the app consider a cross-pane drag in flight right now?
      const state = await page.evaluate(() => {
        const pane = document.querySelector('[class*="sectionsPane"]')
        return {
          paneHasJoin: pane?.querySelector('[class*="sectionJoinActive"]') !== null,
          dropHints: document.querySelectorAll('[class*="sectionHint"]').length,
        }
      })
      console.log('DRAG_STATE:', JSON.stringify(state))
      await page.mouse.up()
      await page.waitForTimeout(700)
    }
    const n2 = await page.getByRole('tree', { name: 'Sections' })
      .getByRole('group', { name: 'Work' }).locator('[role="treeitem"][aria-selected]').count()
    console.log('COLLAPSED_RESULT:', n2)

    await browser.close()
    await scaffold.close()
  }, 180_000)
})
