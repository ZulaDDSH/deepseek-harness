import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const ALLOWED_TRUSTEES = new Set(['SY', 'BA', 'OW', 'CO', 'S-1-5-18', 'S-1-5-32-544', 'S-1-3-4', 'S-1-3-0'])
let userSid: Promise<string> | undefined

function system32(tool: string): string {
  return join(process.env.SystemRoot ?? 'C:\Windows', 'System32', tool)
}

function currentUserSid(): Promise<string> {
  userSid ??= run(system32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { windowsHide: true, encoding: 'utf8' }).then(({ stdout }) => {
    const sid = /"(S-1-[0-9-]+)"/u.exec(stdout)?.[1]
    if (sid === undefined) throw new Error('credentials-local: could not determine the current user SID')
    return sid
  })
  return userSid
}

export async function windowsAclViolations(filename: string): Promise<string[]> {
  const sid = await currentUserSid()
  const dir = await mkdtemp(join(tmpdir(), 'dsh-acl-'))
  try {
    const out = join(dir, 'acl.txt')
    const { stdout } = await run(system32('icacls.exe'), [filename, '/save', out, '/c'], { windowsHide: true, encoding: 'utf8' })
    const text = (await readFile(out)).toString('utf16le')
    const sddl = text.split(/\r?\n/u).find(line => line.startsWith('D:'))
    if (sddl === undefined) throw new Error(`credentials-local: could not read the access list of ${filename}: ${JSON.stringify(text)} ${stdout.trim()}`)
    const trustees: string[] = []
    for (const [, ace] of sddl.matchAll(/\(([^()]*)\)/gu)) {
      const parts = ace!.split(';')
      const trustee = parts[5]
      if (parts[0] === 'A' && trustee !== undefined && trustee !== sid && !ALLOWED_TRUSTEES.has(trustee)) trustees.push(trustee)
    }
    return trustees
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export async function restrictToOwnerWindows(filename: string): Promise<void> {
  const sid = await currentUserSid()
  await run(system32('icacls.exe'), [filename, '/inheritance:r', '/grant:r', `*${sid}:F`, '/grant:r', '*S-1-5-18:F', '/grant:r', '*S-1-5-32-544:F'], { windowsHide: true })
}

export async function ownerOnlyFixCommand(filename: string): Promise<string> {
  const sid = await currentUserSid()
  return `icacls "${filename}" /inheritance:r /grant:r *${sid}:F /grant:r *S-1-5-18:F /grant:r *S-1-5-32-544:F`
}
