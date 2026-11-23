import assert from 'node:assert/strict'
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { hasBridge, setup } from './harness.mjs'

test('login lifecycle, registry recovery and profile names', { skip: !hasBridge }, async (t) => {
  const h = await setup(t, { signedIn: [], dirs: [] })
  const { call, raw, children, root } = h
  const row = async (id) => (await call('list')).accounts.find((a) => a.id === id)

  await t.test('invalid names are rejected before a directory is created', async () => {
    for (const label of ['a/b', '../x', 'con', 'NUL', '', '   ', 'x'.repeat(40), '-lead', 'trail-', 'a_b', 12]) {
      const response = await raw('add', { label })
      assert.equal(response.ok, false, String(label))
    }
    assert.deepEqual((await readdir(root).catch(() => [])).filter((name) => !name.startsWith('.')), [])
  })

  await t.test('names that differ only by a space or a hyphen get different ids', async () => {
    await call('add', { label: 'Ab Cd' })
    await call('add', { label: 'ab-cd' })
    assert.deepEqual(await h.visible(), ['ab-cd', 'ab_cd', 'main'])
    children.get(h.dir('Ab Cd')).emit('close', 0)
    children.get(h.dir('ab-cd')).emit('close', 0)
    await call('list')
  })

  await t.test('a spawn error clears the pending state and allows another attempt', async () => {
    await call('add', { label: 'Boom' })
    const before = h.spawned()
    children.get(h.dir('Boom')).emit('error', new Error('ENOENT'))
    const failed = await row('boom')
    assert.equal(failed.pending, false)
    assert.match(failed.error, /Could not start Claude Code/)
    await call('login', { id: 'boom' })
    assert.equal(h.spawned(), before + 1)
    assert.equal((await row('boom')).pending, true)
    children.get(h.dir('Boom')).emit('close', 0)
  })

  await t.test('a failed exit is reported and the entry is removed', async () => {
    await call('add', { label: 'Closed' })
    const child = children.get(h.dir('Closed'))
    child.emit('close', 1)
    const failed = await row('closed')
    assert.equal(failed.pending, false)
    assert.match(failed.error, /did not finish/)
    assert.equal(child.killed, false)
  })

  await t.test('a login that never finishes is killed and reported', async () => {
    process.env.DSH_CLAUDE_LOGIN_TIMEOUT_MS = '1000'
    t.after(() => delete process.env.DSH_CLAUDE_LOGIN_TIMEOUT_MS)
    await call('add', { label: 'Slow' })
    const child = children.get(h.dir('Slow'))
    assert.equal((await row('slow')).pending, true)
    await sleep(1300)
    assert.equal(child.killed, true)
    const timedOut = await row('slow')
    assert.equal(timedOut.pending, false)
    assert.match(timedOut.error, /timed out/)
    child.emit('close', null)
    assert.match((await row('slow')).error, /timed out/)
    delete process.env.DSH_CLAUDE_LOGIN_TIMEOUT_MS
  })

  await t.test('on Windows taskkill finishes before the plain kill, and a failure is still followed by it', { skip: process.platform !== 'win32' }, async () => {
    h.taskkills.length = 0
    process.env.DSH_CLAUDE_LOGIN_TIMEOUT_MS = '1000'
    await call('add', { label: 'Tree' })
    const child = children.get(h.dir('Tree'))
    await sleep(1300)
    const [first] = h.taskkills.splice(0)
    assert.match(first.file, /\\System32\\taskkill\.exe$/i)
    assert.deepEqual(first.args, ['/pid', String(child.pid), '/T', '/F'])
    assert.equal(first.killedAtCall, false)
    assert.equal(child.killed, true)
    h.taskkill.fails = true
    await call('add', { label: 'Tree2' })
    const second = children.get(h.dir('Tree2'))
    await sleep(1300)
    assert.equal(h.taskkills.length, 1)
    assert.equal(second.killed, true)
    h.taskkill.fails = false
    delete process.env.DSH_CLAUDE_LOGIN_TIMEOUT_MS
  })

  await t.test('the login timeout is clamped and invalid values use the default', () => {
    const { loginTimeoutMs } = h.plugin
    for (const bad of ['', 'undefined', 'abc', '0', '-5', 'NaN', 'Infinity', '-Infinity']) assert.equal(loginTimeoutMs(bad), 300000, String(bad))
    assert.equal(loginTimeoutMs('1'), 1000)
    assert.equal(loginTimeoutMs('999'), 1000)
    assert.equal(loginTimeoutMs('60000'), 60000)
    assert.equal(loginTimeoutMs('99999999999'), 2 ** 31 - 1)
  })

  await t.test('the PowerShell and taskkill paths fall back to the default Windows directory', () => {
    const { windowsSystemPath } = h.plugin
    assert.equal(windowsSystemPath({}, 'taskkill.exe'), 'C:\\Windows\\System32\\taskkill.exe')
    assert.equal(windowsSystemPath({ windir: 'D:\\Win' }, 'taskkill.exe'), 'D:\\Win\\System32\\taskkill.exe')
    assert.equal(windowsSystemPath({ SYSTEMROOT: 'E:\\W', windir: 'D:\\Win' }, 'x'), 'E:\\W\\System32\\x')
    assert.equal(
      windowsSystemPath({ SystemRoot: 'C:\\Windows' }, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    )
  })

  await t.test('a corrupt registry is backed up and treated as empty', async () => {
    await writeFile(`${root}/.ownership.json`, '{not json')
    const listed = await call('list')
    assert.ok(Array.isArray(listed.accounts))
    const backups = (await readdir(root)).filter((f) => f.startsWith('.ownership.json.corrupt-'))
    assert.equal(backups.length, 1)
    assert.equal(await readFile(`${root}/${backups[0]}`, 'utf8'), '{not json')
    assert.equal(JSON.parse(await readFile(`${root}/.ownership.json`, 'utf8')).version, 2)
    await call('list')
    assert.equal((await readdir(root)).filter((f) => f.startsWith('.ownership.json.corrupt-')).length, 1)
  })

  await t.test('unreadable status output becomes a plain account error', async () => {
    await mkdir(h.dir('Junk'))
    h.unreadable.add(h.dir('Junk'))
    const junk = await row('junk')
    assert.match(junk.error, /unreadable sign-in status/)
    assert.ok(!/Unexpected token|JSON/.test(junk.error))
  })

  await t.test('a managed profile displaced by the default profile is announced', async () => {
    await mkdir(h.dir('Displaced'))
    h.accounts.set(h.dir('Displaced'), { email: 'shared@example.test' })
    assert.ok(await row('displaced'))
    assert.ok(h.providers().includes('claude-sub-displaced'))
    h.accounts.set(h.main, { email: 'shared@example.test' })
    const listed = await call('list')
    assert.match(listed.notice, /same account as Displaced/)
    assert.ok(!h.providers().includes('claude-sub-displaced'))
    assert.ok(h.providers().includes('claude-code-session'))
    assert.match((await call('list')).notice, /same account as Displaced/)
    await h.manager.dispose()
    h.manager = await h.ctx.plugin(h.plugin)
    assert.match((await call('list')).notice, /same account as Displaced/)
    h.accounts.set(h.dir('Displaced'), { email: 'other@example.test' })
    assert.equal((await call('list')).notice, '')
    assert.ok(h.providers().includes('claude-sub-displaced'))
  })

  await t.test('a notice stays until the client acknowledges that it showed it', async () => {
    await call('add', { label: 'Lost' })
    h.accounts.set(h.dir('Lost'), { email: 'shared@example.test' })
    children.get(h.dir('Lost')).emit('close', 0)
    const dropped = await h.raw('list')
    assert.match(dropped.value.notice, /already connected as Main/)
    const again = await h.raw('list')
    assert.match(again.value.notice, /already connected as Main/)
    assert.equal(again.value.noticeId, dropped.value.noticeId)
    const wrong = await h.raw('list', { ackNotice: dropped.value.noticeId + 1 })
    assert.match(wrong.value.notice, /already connected as Main/)
    const shown = await h.raw('list', { ackNotice: dropped.value.noticeId })
    assert.equal(shown.value.notice, '')
    assert.equal((await h.raw('list')).value.notice, '')
  })

  await t.test('disposing the plugin kills every running login', async () => {
    await call('add', { label: 'Alpha' })
    await call('add', { label: 'Beta' })
    const running = [children.get(h.dir('Alpha')), children.get(h.dir('Beta'))]
    assert.deepEqual(running.map((c) => c.killed), [false, false])
    await h.manager.dispose()
    assert.deepEqual(running.map((c) => c.killed), [true, true])
  })
})
