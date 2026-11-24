import { randomUUID } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'

export interface StagedWrite {
  readonly path: string
  readonly content: string
}

export async function publishStagedWrites(writes: readonly StagedWrite[]): Promise<void> {
  const suffix = `.staging-${randomUUID()}`
  const staged: string[] = []
  try {
    for (const write of writes) {
      staged.push(`${write.path}${suffix}`)
      await writeFile(`${write.path}${suffix}`, write.content)
    }
  } catch (error) {
    await Promise.allSettled(staged.map(file => rm(file, { force: true })))
    throw error
  }
  const replaced: string[] = []
  for (const [index, write] of writes.entries()) {
    try {
      await rename(`${write.path}${suffix}`, write.path)
      replaced.push(write.path)
    } catch (error) {
      await Promise.allSettled(staged.slice(index).map(file => rm(file, { force: true })))
      throw new Error(
        `snapshot publication failed after replacing ${String(replaced.length)} of ${String(writes.length)} files: ${replaced.join(', ') || 'none'}`,
        { cause: error },
      )
    }
  }
}
