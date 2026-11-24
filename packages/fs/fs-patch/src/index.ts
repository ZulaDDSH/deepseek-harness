/** Pure patch parsing and text application, independent of filesystem providers. */

export { parsePatch, PatchParseError } from './parse.ts'
export { applyHunks, describeHunkFailure } from './apply.ts'
export type { ApplyHunksResult, HunkApplyFailure, PatchHunk, PatchOperation } from './types.ts'
