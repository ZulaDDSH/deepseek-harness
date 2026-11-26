import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

const exec = promisify(execFile)

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max']
const EFFORT_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
}
const EFFORT_SUFFIX = /^(.+)-(low|medium|high|xhigh|max)$/i
const LABEL_SUFFIX = /\s*\((?:Low|Medium|High|XHigh|Extra|Max)\)\s*$/i

const observedContextWindows = new Map()
let cachedCatalog = null

export function invalidateCatalog() {
  cachedCatalog = null
}

export function recordContextWindow(modelId, size) {
  if (typeof modelId !== 'string' || !Number.isFinite(size) || size < 8192) return
  observedContextWindows.set(modelId, Math.floor(size))
  const match = EFFORT_SUFFIX.exec(modelId)
  if (match) observedContextWindows.set(match[1], Math.floor(size))
}

export function contextWindowFor(modelId) {
  const direct = observedContextWindows.get(modelId)
  if (direct) return direct
  const match = EFFORT_SUFFIX.exec(modelId)
  if (match && observedContextWindows.has(match[1])) return observedContextWindows.get(match[1])
  if (/^claude-/i.test(modelId)) return 200_000
  if (/^gemini-/i.test(modelId)) return 1_048_576
  return 128_000
}

/** Parse `agy models` tab-separated output into grouped base models plus exact variant lookups. */
export function parseModelsOutput(stdout) {
  const raw = []
  const seen = new Set()
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.includes('\t')) continue
    const [id, label] = trimmed.split('\t')
    if (!id || !label || !/^[\w.-]+$/.test(id) || seen.has(id)) continue
    seen.add(id)
    raw.push({id, label: label.trim()})
  }

  const groups = new Map()
  const order = []
  for (const entry of raw) {
    const match = EFFORT_SUFFIX.exec(entry.id)
    const base = match ? match[1] : entry.id
    const effort = match ? match[2].toLowerCase() : null
    let group = groups.get(base)
    if (!group) {
      group = {
        base,
        baseName: match ? entry.label.replace(LABEL_SUFFIX, '').trim() || base : entry.label,
        variants: [],
      }
      groups.set(base, group)
      order.push(group)
    }
    group.variants.push({id: entry.id, label: entry.label, effort})
  }

  const models = []
  const byId = new Map()
  const byWireId = new Map()

  for (const group of order) {
    const withEffort = group.variants.filter(v => v.effort !== null)
    // Only collapse into a reasoning-effort picker when a base model actually has multiple effort variants.
    if (withEffort.length >= 2 && withEffort.length === group.variants.length) {
      const sorted = [...withEffort].sort((a, b) => {
        const ai = EFFORT_ORDER.indexOf(a.effort)
        const bi = EFFORT_ORDER.indexOf(b.effort)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      })
      const efforts = sorted.map(v => ({
        id: v.effort,
        name: EFFORT_LABELS[v.effort] || v.effort,
      }))
      // First listed variant from `agy models` is Antigravity's preferred default for that family.
      const defaultEffort = withEffort[0].effort
      const effortToWire = Object.fromEntries(sorted.map(v => [v.effort, v.id]))
      const entry = {
        id: group.base,
        name: group.baseName,
        defaultWireId: effortToWire[defaultEffort] || sorted[0].id,
        effortToWire,
        reasoning: {efforts, defaultEffort},
      }
      models.push(entry)
      byId.set(entry.id, entry)
      for (const variant of sorted) {
        byWireId.set(variant.id, {entry, fixedEffort: variant.effort, wireId: variant.id})
      }
    } else {
      for (const variant of group.variants) {
        const entry = {
          id: variant.id,
          name: variant.label,
          defaultWireId: variant.id,
          effortToWire: null,
          reasoning: undefined,
        }
        models.push(entry)
        byId.set(entry.id, entry)
        byWireId.set(variant.id, {entry, fixedEffort: variant.effort, wireId: variant.id})
      }
    }
  }

  return {raw, models, byId, byWireId}
}

export async function loadCatalog(command, {force = false, signal} = {}) {
  if (!force && cachedCatalog && cachedCatalog.expires > Date.now() && cachedCatalog.command === command) {
    return cachedCatalog.data
  }
  const {stdout} = await exec(command, ['models'], {windowsHide: true, timeout: 15000, signal})
  const data = parseModelsOutput(stdout)
  cachedCatalog = {command, data, expires: Date.now() + 60_000}
  return data
}

export function projectListModels(provider, catalog) {
  return catalog.models.map(entry => ({
    provider,
    id: entry.id,
    name: entry.name,
    inputModalities: ['text', 'image'],
  }))
}

export function projectResolvedModel(provider, modelId, catalog) {
  const grouped = catalog?.byId.get(modelId)
  if (grouped) {
    return {
      provider,
      id: grouped.id,
      name: grouped.name,
      inputModalities: ['text', 'image'],
      context: {contextWindow: contextWindowFor(grouped.id)},
      ...(grouped.reasoning && {reasoning: grouped.reasoning}),
    }
  }
  const legacy = catalog?.byWireId.get(modelId)
  if (legacy) {
    return {
      provider,
      id: modelId,
      name: legacy.entry.reasoning
        ? `${legacy.entry.name} (${EFFORT_LABELS[legacy.fixedEffort] || legacy.fixedEffort})`
        : legacy.entry.name,
      inputModalities: ['text', 'image'],
      context: {contextWindow: contextWindowFor(modelId)},
      ...(legacy.entry.reasoning && {
        reasoning: {efforts: legacy.entry.reasoning.efforts, defaultEffort: legacy.fixedEffort},
      }),
    }
  }
  return {
    provider,
    id: modelId,
    name: modelId,
    inputModalities: ['text', 'image'],
    context: {contextWindow: contextWindowFor(modelId)},
  }
}

/** Resolve a Harness (model, reasoningEffort) pair to the exact wire model ID expected by `agy acp`. */
export function resolveWireModel(modelId, reasoningEffort, catalog) {
  const effort = typeof reasoningEffort === 'string' && reasoningEffort.trim()
    ? reasoningEffort.trim().toLowerCase()
    : undefined
  const grouped = catalog?.byId.get(modelId)
  if (grouped) {
    if (effort && grouped.effortToWire?.[effort]) return grouped.effortToWire[effort]
    return grouped.defaultWireId
  }
  const legacy = catalog?.byWireId.get(modelId)
  if (legacy) {
    if (effort && legacy.entry.effortToWire?.[effort]) return legacy.entry.effortToWire[effort]
    return legacy.wireId
  }
  if (effort && !EFFORT_SUFFIX.test(modelId)) return `${modelId}-${effort}`
  return modelId
}
