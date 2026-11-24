import { readFileSync, writeFileSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'

const args = process.argv.slice(2)
const command = args.find(arg => arg === 'login' || arg === 'doctor')
const [state, loginExit = '0', mode = 'normal'] = args

function read() {
  try {
    return readFileSync(state, 'utf8').trim()
  } catch {
    return 'out'
  }
}

if (command === 'doctor') {
  if (mode === 'broken') {
    process.stdout.write('not json at all')
  } else {
    const id = read() === 'in' ? 'auth.ok' : 'auth.signed-out'
    process.stdout.write(`${JSON.stringify({ findings: [{ id, path: 'C:/secret/place' }] })}\n`)
  }
  process.exit(0)
}

if (command === 'login') {
  process.stdout.write('\u001b[32mWelcome\u001b[0m person@example.com\n')
  process.stdout.write('Open \u001b[4mhttps://freebuff.example/login?code=ABC\u001b[0m to continue\n')
  process.stdout.write('Then https://freebuff.example/second-link\n')
  if (mode === 'hang') await delay(600_000)
  await delay(50)
  if (loginExit === '0' && mode !== 'no-save') writeFileSync(state, 'in')
  process.stdout.write('Logged in as secret@example.com\n')
  process.exit(Number(loginExit))
}

process.exit(2)
