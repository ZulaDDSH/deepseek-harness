/** End-to-end: a workspace grant stamps its own files and leaves a hard link into outside the workspace untouched. */

import { spawnSync } from 'node:child_process'
import { linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { linkedMarkerPath, lockFilePath } from '../src/acl.ts'
import { AclWriteGrant } from '../src/grant.ts'
import { win32Sync } from '../src/ffi.ts'
import { workspaceWriteSid } from '../src/workspace-sid.ts'

const isWin32 = process.platform === 'win32'

function icaclsText(path: string): string {
  const result = spawnSync('icacls', [path], { encoding: 'utf8' })
  expect(result.status, `icacls failed: ${result.stderr}`).toBe(0)
  return result.stdout
}

describe.skipIf(!isWin32)('workspace grant with a hard link into outside the workspace', () => {
  it('stamps the workspace file, leaves the shared file alone, and revoke removes the grant', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-acl-hardlinks-'))
    const workspace = join(root, 'ws')
    const outside = join(root, 'outside')
    const shared = join(outside, 'shared.txt')
    const own = join(workspace, 'own.txt')
    mkdirSync(workspace)
    mkdirSync(outside)
    writeFileSync(shared, 'shared')
    linkSync(shared, join(workspace, 'link.txt'))
    writeFileSync(own, 'own')
    const sid = workspaceWriteSid(workspace)
    const grant = AclWriteGrant.create(sid)
    try {
      grant.add(workspace)
      expect(icaclsText(own)).toContain(sid)
      expect(icaclsText(own)).toContain('Low Mandatory Level')
      expect(icaclsText(shared)).not.toContain(sid)
      expect(icaclsText(shared)).not.toContain('Low Mandatory Level')
      grant.dispose()
      expect(icaclsText(own)).not.toContain(sid)
      expect(icaclsText(shared)).not.toContain(sid)
    } finally {
      const api = win32Sync()
      rmSync(lockFilePath(api, workspace), { force: true })
      rmSync(linkedMarkerPath(api, workspace), { force: true })
      rmSync(root, { recursive: true, force: true })
    }
  })
})
