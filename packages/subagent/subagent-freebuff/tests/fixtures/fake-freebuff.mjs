import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const mode = process.env.FAKE_FREEBUFF_MODE ?? 'ok'
const configDir = process.env.FAKE_FREEBUFF_TRANSCRIPT === '1' ? process.env.FREEBUFF_CONFIG_DIR : undefined
const trusted = process.argv.includes('--trust-agents')
const FOOTER = '/model to change  |  for history'
const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

const out = text => process.stdout.write(text)
const frame = lines => out(`\x1b[2J\x1b[H${lines.join('\r\n')}`)

if (mode === 'exit') process.exit(3)

let buffer = ''
let trust = trusted ? 'flag' : 'none'
let armed = false

function saveChat(messages) {
  if (configDir === undefined) return
  const dir = join(configDir, 'projects', basename(process.cwd()), 'chats', 'fake-chat')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'chat-messages.json'), JSON.stringify(messages))
}

function showReady() {
  out('\x1b[?1049h\x1b[?2004h')
  if (mode === 'login') return frame(['Welcome', 'Press ENTER to login...'])
  if (mode === 'blocked') return frame(['Session in use', 'Enter: take over', 'Esc: back to draft'])
  frame(['Freebuff', '', FOOTER])
  armed = true
}

function submit(task) {
  const lines = task.split('\n')
  const echo = `> ${lines[0]}`
  const user = { variant: 'user', content: task }
  saveChat([user])
  frame([echo, '', 'thinking...', '■ Esc'])
  if (mode === 'hang') return
  setTimeout(() => {
    const answer = `FAKE-ANSWER lines=${lines.length} esc=${task.includes('\x1b')} trust=${trust} args=${process.argv.slice(2).join(',')}`
    if (mode === 'error') saveChat([user, { variant: 'ai', content: 'partial', userError: 'boom' }])
    else saveChat([user, { variant: 'ai', content: 'TRANSCRIPT-ANSWER', isComplete: true }])
    frame([echo, '', answer, '', FOOTER, '✕ End session'])
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
