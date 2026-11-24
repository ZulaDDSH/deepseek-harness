import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import { SubagentError } from './error.ts'

async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return resolve(path)
  }
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export async function assertExternalCwdWithinParentWorkspace(ctx: Context, session: Session, cwd: string): Promise<void> {
  const policy = ctx.get('sandboxPolicy')?.resolve({ session })
  if (policy === undefined || policy.mode === 'danger-full-access') return
  const roots = [policy.workspaceRoot, ...policy.mode === 'workspace-write' ? policy.additionalWritableRoots ?? [] : []]
  const target = await physicalPath(cwd)
  for (const root of roots) {
    if (isInside(await physicalPath(root), target)) return
  }
  throw new SubagentError(
    `external subagent cwd must stay inside the parent session workspace (${policy.workspaceRoot}): ${cwd}`,
    'INVALID_CWD',
  )
}
