import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { expect, it } from 'vitest'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'
import { MockAdapter, textResponse } from '../../../packages/core/agent-loop/tests/mock-adapter.ts'

it('opens one ungrouped master home and imports, groups, filters, and opens external history', async () => {
  let scaffold: WebScaffold | undefined
  let browser: Browser | undefined
  let page: Page | undefined
  try {
    const app = await launchWebScaffold()
    scaffold = app
    await app.ctx.workspaceRegistry.create(app.workspaceCwd, 'Import project')
    const source = join(app.workspaceCwd, '.claude-home', 'projects', 'demo')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'chat.jsonl'), [
      { type: 'user', cwd: app.workspaceCwd, message: { role: 'user', content: 'Remember amber' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Amber confirmed' }] } },
    ].map(row => JSON.stringify(row)).join('\n') + '\n')
    browser = await chromium.launch()
    const activePage = await newEnglishPage(browser)
    page = activePage
    const errors: string[] = []
    activePage.on('pageerror', error => errors.push(error.message))
    await activePage.goto(app.authenticatedUrl, { waitUntil: 'load' })
    const panel = activePage.locator('nav').getByRole('button', { name: 'Master Control', exact: true })
    await panel.click()
    await activePage.getByRole('button', { name: 'Open master chat' }).click()
    await expect.poll(() => app.ctx.sessions.list().filter(s => s.id.startsWith('master-control-home-')).length).toBe(1)
    const home = app.ctx.sessions.list().find(s => s.id.startsWith('master-control-home-'))!
    await activePage.getByLabel('Sessions', { exact: true }).getByText('Master Control', { exact: true }).waitFor()
    expect(app.ctx.workspaceRegistry.list().some(workspace => workspace.sessionIds.includes(home.id))).toBe(false)
    await panel.click()
    await activePage.getByRole('button', { name: 'Open master chat' }).click()
    await expect.poll(() => app.ctx.sessions.list().filter(s => s.id.startsWith('master-control-home-')).length).toBe(1)
    await panel.click()
    await activePage.getByRole('button', { name: 'Import chats…' }).click()
    await activePage.getByRole('checkbox', { name: 'claude: Remember amber' }).check()
    await activePage.getByText('Preview text', { exact: true }).click()
    await activePage.getByText('user: Remember amber\n\nassistant: Amber confirmed', { exact: true }).waitFor()
    await activePage.getByRole('button', { name: 'Import selected' }).click()
    await activePage.getByText('Remember amber: Imported', { exact: false }).waitFor()
    await activePage.getByRole('button', { name: 'Close', exact: true }).click()
    await activePage.getByRole('heading', { name: 'Import project' }).waitFor()
    await activePage.getByRole('textbox', { name: 'Search title or folder' }).fill('amber')
    await activePage.getByRole('table').getByText('[Imported] Remember amber', { exact: true }).waitFor()
    await activePage.getByRole('button', { name: 'Failed', exact: true }).click()
    await activePage.getByText('No matching sessions.').waitFor()
    await activePage.getByRole('button', { name: 'All', exact: true }).click()
    await saveFailureShot(activePage, 'master-control-home-import-roster')
    await activePage.getByRole('button', { name: 'Open', exact: true }).click()
    await activePage.getByText('Amber confirmed', { exact: true }).waitFor()
    const imported = app.ctx.sessions.list().find(session => session.id.startsWith('imported-chat-'))!
    const adapter = new MockAdapter([textResponse('DSH remembers amber')])
    adapter.listModels = async provider => [{ provider, id: 'test-model', name: 'Test model' }]
    app.ctx.llm.registerAdapter(['master-control-test'], adapter)
    await app.ctx.sessionController.selectModel({ sessionId: imported.id, provider: 'master-control-test', model: 'test-model' })
    const settled = app.whenTurnSettled(30_000)
    const input = activePage.locator('[data-composer-input][contenteditable="true"]').first()
    await input.fill('What did I ask you to remember?')
    await input.press('Enter')
    await settled
    await activePage.getByText('DSH remembers amber', { exact: true }).waitFor()
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('Remember amber')
    expect(JSON.stringify(adapter.requests.at(-1)?.messages)).toContain('Amber confirmed')
    await activePage.reload({ waitUntil: 'load' })
    await activePage.getByText('Amber confirmed', { exact: true }).waitFor()
    expect(errors).toEqual([])
  } catch (error) {
    if (page !== undefined) {
      console.error('Master Control alerts:', await page.getByRole('alert').allTextContents())
      await saveFailureShot(page, 'master-control-browser-failure')
    }
    throw error
  } finally {
    await browser?.close()
    await scaffold?.close()
  }
})
