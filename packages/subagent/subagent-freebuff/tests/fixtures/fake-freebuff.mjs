import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const mode = process.env.FAKE_FREEBUFF_MODE ?? 'ok'
const configDir = process.env.FAKE_FREEBUFF_TRANSCRIPT === '1' ? process.env.FREEBUFF_CONFIG_DIR : undefined
const trusted = process.argv.includes('--trust-agents')
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'
const WIDTH = 100

const out = text => process.stdout.write(text)
const frame = lines => out(`\x1b[2J\x1b[H${lines.join('\r\n')}`)

const box = (open, close, rows) => [open + '─'.repeat(WIDTH - 2) + close, ...rows.map(row => `│ ${row.padEnd(WIDTH - 4)} │`), `${close === '╮' ? '╰' : '└'}${'─'.repeat(WIDTH - 2)}${close === '╮' ? '╯' : '┘'}`]
const BANNER = [' ███████████  fake banner', ...box('┌', '┐', ['May use data for AI training', 'Your first message starts the session.'])]
const AD = box('╭', '╮', ['Sponsored: a fake ad box', 'Try the thing  example.invalid'])
const input = hint => box('╭', '╮', ['', `▍${hint}`, ''])
const footer = chat => [` DeepSeek V4.1 Flash Fast • high · ${process.cwd()} · /model to change · Chat: ${chat}`, ' ← for history · ? for help']
const spaced = (left, right) => `${left}${' '.repeat(Math.max(1, WIDTH - left.length - right.length))}${right}`

if (process.env.FREEBUFF_CONFIG_DIR !== undefined) writeFileSync(join(process.env.FREEBUFF_CONFIG_DIR, 'fake.pid'), String(process.pid))

if (mode === 'exit') process.exit(3)

let buffer = ''
let trust = trusted ? 'flag' : 'none'
let armed = false

function writeChat(id, messages, future = false) {
  if (configDir === undefined) return
  const dir = join(configDir, 'projects', basename(process.cwd()), 'chats', id)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'chat-messages.json')
  writeFileSync(file, JSON.stringify(messages))
  if (future) {
    const later = new Date(Date.now() + 60_000)
    utimesSync(file, later, later)
  }
}

function showReady() {
  out('\x1b[?1049h\x1b[?2004h')
  if (mode === 'login') return frame(['Welcome', 'Press ENTER to login...'])
  if (mode === 'blocked') return frame(['Session in use', 'Enter: take over', 'Esc: back to draft'])
  frame([...BANNER, ...AD, ...input('Enter a coding task or / for commands'), ...footer('New chat')])
  armed = true
}

const echoRows = task => ['   [08:07 AM]', ...task.split('\n').map((line, index) => `   ${line}${index === 0 ? ' ⎘' : ''}`)]

function doneFrame(task, answerRows) {
  frame([
    ...BANNER, ...echoRows(task), ...answerRows, spaced('', '⎘ • 3s • △▽'), ...AD,
    spaced(' 54.1K (5%)', '✕ End session'), ...input('Enter a coding task or / for commands'), ...footer(task.split('\n')[0].slice(0, 28)),
  ])
}

function submit(task) {
  const lines = task.split('\n')
  const user = { variant: 'user', content: task }
  if (mode === 'foreign') {
    writeChat('foreign-chat', [{ variant: 'user', content: 'someone else' }, { variant: 'ai', content: 'FOREIGN-ANSWER', isComplete: true }], true)
  }
  writeChat('fake-chat', [{ variant: 'ai', content: '', blocks: [{ type: 'mode-divider' }] }, user])
  frame([
    ...BANNER, ...echoRows(task), ...AD, spaced(' thinking...', '1s  ■ Esc'),
    ...input('Add to the current task (/ for commands)'), ...footer(lines[0].slice(0, 28)),
  ])
  if (mode === 'hang') return
  if (mode === 'blocked-late') {
    return setTimeout(() => frame([
      ...BANNER, ...echoRows(task), ...box('┌', '┐', ['Session in use elsewhere', 'Enter: take over', 'Esc: back to draft']), ...footer(lines[0].slice(0, 28)),
    ]), 600)
  }
  setTimeout(() => {
    const answer = `FAKE-ANSWER lines=${lines.length} esc=${task.includes('\x1b')} trust=${trust} args=${process.argv.slice(2).join(',')}`
    const finish = text => writeChat('fake-chat', [user, { variant: 'ai', content: text, isComplete: true }])
    if (mode === 'error') {
      writeChat('fake-chat', [user, { variant: 'ai', content: 'partial', userError: 'boom: usage policy refusal' }])
    } else if (mode === 'recover') {
      writeChat('fake-chat', [user, { variant: 'ai', content: 'partial', userError: 'transient' }])
      setTimeout(() => writeChat('fake-chat', [user, { variant: 'ai', content: 'partial', userError: 'transient' }, { variant: 'ai', content: 'RECOVERED-ANSWER', isComplete: true }]), 100)
    } else {
      finish('TRANSCRIPT-ANSWER')
    }
    if (mode === 'long') return doneFrame(task, Array.from({ length: 70 }, (_, index) => `long answer line ${index}`))
    if (mode === 'quote') return doneFrame(task, [answer, 'The footer says thinking... while a turn runs.'])
    doneFrame(task, [answer])
  }, 1200)
}

process.stdin.setRawMode?.(true)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (data) => {
  buffer += data
  if (!armed) {
    if (mode === 'trust' && buffer.includes('n\r')) {
      trust = 'n'
      buffer = ''
      showReady()
    }
    return
  }
  const end = buffer.indexOf(PASTE_END)
  if (end >= 0 && buffer.slice(end + PASTE_END.length).includes('\r')) {
    const task = buffer.slice(buffer.indexOf(PASTE_START) + PASTE_START.length, end)
    buffer = ''
    armed = false
    submit(task)
  }
})
process.stdin.resume()

if (mode === 'trust' && !trusted) out('Load and run these? [y/N] ')
else showReady()
