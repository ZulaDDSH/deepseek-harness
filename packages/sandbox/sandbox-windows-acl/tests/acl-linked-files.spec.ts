/** Real-Win32 checks that a grant or revoke never changes a multiply-linked file's security descriptor. */

import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Win32Error } from '@deepseek-ai/dsh-win32-process'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { grantWrite, linkedMarkerPath, lockFilePath, revokeWrite } from '../src/acl.ts'
import { allocPtrSlot, allocUint32, decodePtr, decodeUint32, decodeUint8At, win32Sync } from '../src/ffi.ts'
import type { NativePtr, Win32Bindings } from '../src/ffi.ts'
import * as abi from '../src/win32-abi.ts'

const isWin32 = process.platform === 'win32'

const CAPABILITY_SID = 'S-1-4-4242-61'
const LOW_SID = 'S-1-16-4096'
const WORLD_SID = 'S-1-1-0'

function sidFromString(api: Win32Bindings, sid: string): NativePtr {
  const slot = allocPtrSlot()
  if (api.convertStringSidToSidW(sid, slot) === 0) throw new Error(`ConvertStringSidToSidW failed for ${sid}`)
  const ptr = decodePtr(slot)
  if (ptr === null) throw new Error(`ConvertStringSidToSidW returned null for ${sid}`)
  return ptr
}

function sidBytes(api: Win32Bindings, sid: NativePtr): Buffer {
  return Buffer.from(Array.from({ length: api.getLengthSid(sid) }, (_, index) => decodeUint8At(sid, index)))
}

function securityOf(api: Win32Bindings, path: string): Buffer {
  const scratch = Buffer.alloc(abi.SECURITY_DESCRIPTOR_SCRATCH_BYTES)
  const needed = allocUint32()
  if (api.getFileSecurityW(path, abi.DACL_SECURITY_INFORMATION | abi.LABEL_SECURITY_INFORMATION, scratch, scratch.length, needed) === 0) {
    throw new Error(`GetFileSecurityW failed for ${path}`)
  }
  return Buffer.from(scratch.subarray(0, decodeUint32(needed)))
}

function daclOf(descriptor: Buffer): Buffer {
  const offset = descriptor.readUInt32LE(16)
  return offset === 0 ? Buffer.alloc(0) : descriptor.subarray(offset, offset + descriptor.readUInt16LE(offset + 2))
}

function hasLabel(descriptor: Buffer): boolean {
  return descriptor.readUInt32LE(12) !== 0
}

describe.skipIf(!isWin32)('hard-linked files under a granted root', () => {
  const roots: string[] = []
  const granted: string[] = []
  const sids: NativePtr[] = []

  afterEach(() => {
    const api = win32Sync()
    vi.restoreAllMocks()
    for (const sid of sids.splice(0)) api.localFree(sid)
    for (const workspace of granted.splice(0)) {
      rmSync(lockFilePath(api, workspace), { force: true })
      rmSync(linkedMarkerPath(api, workspace), { force: true })
    }
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function setup() {
    const api = win32Sync()
    const capability = sidFromString(api, CAPABILITY_SID)
    const low = sidFromString(api, LOW_SID)
    const world = sidFromString(api, WORLD_SID)
    sids.push(capability, low, world)
    return { api, capability, low, world }
  }

  function tree() {
    const root = mkdtempSync(join(tmpdir(), 'dsh-acl-linked-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const outside = join(root, 'outside')
    mkdirSync(workspace)
    mkdirSync(outside)
    granted.push(workspace)
    const shared = join(outside, 'shared.txt')
    writeFileSync(shared, 'original')
    const link = join(workspace, 'link.txt')
    linkSync(shared, link)
    const own = join(workspace, 'own.txt')
    writeFileSync(own, 'own')
    return { workspace, outside, shared, link, own }
  }

  it('a grant leaves a hard-linked file exactly as it was and stamps its single-link sibling', () => {
    const { api, capability, low, world } = setup()
    const { workspace, shared, own } = tree()
    const before = daclOf(securityOf(api, shared))
    grantWrite(api, workspace, capability, low, world)
    expect(daclOf(securityOf(api, shared)).equals(before)).toBe(true)
    expect(hasLabel(securityOf(api, shared))).toBe(false)
    expect(daclOf(securityOf(api, own)).includes(sidBytes(api, capability))).toBe(true)
    expect(hasLabel(securityOf(api, own))).toBe(true)
  })

  it('a revoke leaves a hard-linked file exactly as it was', () => {
    const { api, capability, low, world } = setup()
    const { workspace, shared, own } = tree()
    const before = daclOf(securityOf(api, shared))
    grantWrite(api, workspace, capability, low, world)
    revokeWrite(api, workspace, capability)
    expect(daclOf(securityOf(api, shared)).equals(before)).toBe(true)
    expect(hasLabel(securityOf(api, shared))).toBe(false)
    expect(daclOf(securityOf(api, own)).includes(sidBytes(api, capability))).toBe(false)
  })

  it('the next grant repairs a hard-linked file that an earlier build stamped', () => {
    const { api, capability, low, world } = setup()
    const { workspace, shared } = tree()
    const before = daclOf(securityOf(api, shared))
    vi.spyOn(api, 'setFileSecurityW').mockReturnValue(1)
    grantWrite(api, workspace, capability, low, world)
    vi.restoreAllMocks()
    expect(daclOf(securityOf(api, shared)).includes(sidBytes(api, capability))).toBe(true)
    rmSync(linkedMarkerPath(api, workspace), { force: true })
    grantWrite(api, workspace, capability, low, world)
    expect(daclOf(securityOf(api, shared)).equals(before)).toBe(true)
    expect(hasLabel(securityOf(api, shared))).toBe(false)
  })

  it('a junction under the granted root is not followed and single-link files are not restored', () => {
    const { api, capability, low, world } = setup()
    const { workspace, outside, link } = tree()
    const elsewhere = join(outside, 'elsewhere')
    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'a.txt'), 'a')
    linkSync(join(elsewhere, 'a.txt'), join(elsewhere, 'b.txt'))
    symlinkSync(elsewhere, join(workspace, 'junction'), 'junction')
    const restore = vi.spyOn(api, 'setFileSecurityW')
    grantWrite(api, workspace, capability, low, world)
    expect(restore.mock.calls.map(([path]) => path)).toEqual([link])
    expect(daclOf(securityOf(api, join(elsewhere, 'a.txt'))).includes(sidBytes(api, capability))).toBe(false)
  })

  it('a failed restore is reported with the file path and still releases the lock', () => {
    const { api, capability, low, world } = setup()
    const { workspace, link } = tree()
    vi.spyOn(api, 'setFileSecurityW').mockReturnValue(0)
    const unlock = vi.spyOn(api, 'unlockFileEx')
    let caught: unknown
    try {
      grantWrite(api, workspace, capability, low, world)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('SetFileSecurityW')
    expect((caught as Error).message).toContain(link)
    expect(unlock).toHaveBeenCalled()
  })

  it('a failed snapshot read fails closed before anything is applied', () => {
    const { api, capability, low, world } = setup()
    const { workspace } = tree()
    vi.spyOn(api, 'getFileSecurityW').mockReturnValue(0)
    const apply = vi.spyOn(api, 'setNamedSecurityInfoW')
    const unlock = vi.spyOn(api, 'unlockFileEx')
    let caught: unknown
    try {
      grantWrite(api, workspace, capability, low, world)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Win32Error)
    expect((caught as Win32Error).api).toBe('GetFileSecurityW')
    expect(apply).not.toHaveBeenCalled()
    expect(unlock).toHaveBeenCalled()
  })
})
