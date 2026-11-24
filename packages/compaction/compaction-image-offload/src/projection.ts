/** Browser-safe durable image selection declaration and pure replay definition. */

import type { Message } from '@deepseek-ai/dsh-llm'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionMessageProjection } from '@deepseek-ai/dsh-session/surface'
import { setMessageImagesOffloaded } from './project-message.ts'

/** Exact input-image occurrences selected by one durable offload decision. */
export interface ImageOffloadTarget {
  /** Current message-producing event containing these occurrences. */
  seq: SessionSeq
  /** Zero-based depth-first image indexes within the immutable message. */
  imageIndexes: number[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Omit selected input-image occurrences from subsequent requests; an image/restore must name them to undo it.
     * Targets name unique current user/message or tool/result nodes. Nonempty, strictly
     * increasing indexes count all images in depth-first order, including nested tool
     * results and already omitted images. Message nodes and identities remain unchanged.
     * @messageProjection
     */
    'image/offload': { targets: ImageOffloadTarget[] }
    /** Send selected input-image occurrences again; every selected occurrence must currently be offloaded.
     * @messageProjection requires the owning plugin to register its projection.
     */
    'image/restore': { targets: ImageOffloadTarget[] }
  }
}

/** Whether a durable value is a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a durable occurrence index or sequence is canonical. */
function isIndex(value: unknown): value is SessionSeq {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
}

/** Atomic validation and reconstruction shared by live sessions and detached replay. */
function imageSelectionProjection<T extends 'image/offload' | 'image/restore'>(type: T): SessionMessageProjection<T> {
  return {
    type,
    project(event, context) {
      const data: unknown = event.data
      if (!isRecord(data) || Object.keys(data).length !== 1 || !Array.isArray(data['targets']) || data['targets'].length === 0) {
        throw new Error(`${type}: data must contain a nonempty targets array`)
      }
      const messages = new Map<SessionSeq, Message>()
      const nodes = new Set(context.nodes)
      for (const target of data['targets'] as unknown[]) {
        if (!isRecord(target) || Object.keys(target).length !== 2 || !isIndex(target['seq'])
          || !Array.isArray(target['imageIndexes']) || target['imageIndexes'].length === 0) {
          throw new Error(`${type}: each target must contain a seq and nonempty imageIndexes`)
        }
        const seq = target['seq']
        if (messages.has(seq)) throw new Error(`${type}: duplicate target seq ${seq}`)
        if (!nodes.has(seq)) throw new Error(`${type}: target seq ${seq} is not a current surface node`)
        const source = context.events[seq - context.baseSeq]
        if (source?.type !== 'user/message' && source?.type !== 'tool/result') {
          throw new Error(`${type}: target seq ${seq} must be user/message or tool/result`)
        }
        let previous = -1
        for (const index of target['imageIndexes'] as unknown[]) {
          if (!isIndex(index) || index <= previous) {
            throw new Error(`${type}: imageIndexes must be strictly increasing non-negative safe integers`)
          }
          previous = index
        }
        const message = context.messages.get(seq)
          ?? (source.type === 'user/message' ? source.data : source.data.message)
        messages.set(seq, setMessageImagesOffloaded(message, target['imageIndexes'] as number[], type))
      }
      return messages
    },
  }
}

export const imageOffloadProjection: SessionMessageProjection<'image/offload'> = imageSelectionProjection('image/offload')

export const imageRestoreProjection: SessionMessageProjection<'image/restore'> = imageSelectionProjection('image/restore')
