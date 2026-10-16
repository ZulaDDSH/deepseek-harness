/**
 * Inspection results for `inspect`: the accepted and refused shapes built from a
 * package manifest, and the refusal pnpm prints for a registry lookup.
 * @module @deepseek-ai/dsh-plugin-manager/inspect-result
 */

import type { PluginInspectProblem, PluginSpecInspection, Registry } from './types.ts'

/** A manifest field that is a string, when the manifest carries one. */
function stringField(manifest: object, field: string): string | undefined {
  const value = (manifest as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : undefined
}

/**
 * What a package manifest says about the package: identity, one-liner, and whether it is a bundle.
 * @param kind - whether the spec named a registry package or a local path.
 * @param manifest - the parsed package.json.
 * @param registry - the registry consulted, or null for a path.
 * @returns the accepted inspection.
 */
export function inspectionOf(kind: 'registry' | 'path', manifest: object, registry: Registry): Extract<PluginSpecInspection, { status: 'accepted' }> {
  const dsh = (manifest as { dsh?: unknown }).dsh
  const declared = typeof dsh === 'object' && dsh !== null ? dsh as { bundle?: unknown } : undefined
  const bundle = declared !== undefined && typeof declared.bundle === 'object' && declared.bundle !== null
  const name = stringField(manifest, 'name')
  const version = stringField(manifest, 'version')
  const description = stringField(manifest, 'description')
  return {
    status: 'accepted', kind, bundle, registry,
    ...name === undefined ? {} : { name },
    ...version === undefined ? {} : { version },
    ...description === undefined || description === '' ? {} : { description },
  }
}

/**
 * A refused inspection carrying its stable problem code and reason.
 * @param problem - the stable refusal code.
 * @param reason - the human-readable refusal.
 * @returns the refused inspection.
 */
export function refused(problem: PluginInspectProblem, reason: string): PluginSpecInspection {
  return { status: 'refused', problem, reason }
}

/**
 * The refusal `pnpm view --json` prints on stdout, `{ error: { code, message } }`, as one log line; empty for anything else.
 * @param printed - what pnpm printed on stdout.
 * @returns the refusal line, or an empty string.
 */
export function printedError(printed: string): string {
  let parsed: unknown
  try { parsed = JSON.parse(printed || 'null') }
  catch { return '' /* not JSON: nothing pnpm printed as a refusal */ }
  const error = typeof parsed === 'object' && parsed !== null ? (parsed as { error?: unknown }).error : undefined
  if (typeof error !== 'object' || error === null) return ''
  const { code, message } = error as { code?: unknown; message?: unknown }
  return [code, message].filter((part): part is string => typeof part === 'string').join('  ')
}
