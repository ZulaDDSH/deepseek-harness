import {assertTarget} from './sessions.js'

export async function readTranscript(ctx, id, {limit = 10, beforeSeq}, signal) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new Error('Use a message limit from 1 to 20.')
  if (beforeSeq !== undefined && (!Number.isSafeInteger(beforeSeq) || beforeSeq < 0))
    throw new Error('Use a nonnegative sequence number for before_seq.')
  await assertTarget(ctx,id,signal)
  using observation = await ctx.sessionQuery.observeSession(id,{signal,projectionMode:'none'})
  signal?.throwIfAborted()
  if (ctx.workspaceRegistry.archivedSessionIds.includes(id))
    throw new Error('That session is no longer available.')

  const messages = []
  let remaining = 16_000
  let hasEarlier = false
  const events = observation.events
  for (let index = events.length - 1; index >= 0; index--) {
    signal?.throwIfAborted()
    const {type,seq,time,data} = events[index]
    if (beforeSeq !== undefined && seq >= beforeSeq) continue
    const message = type === 'user/message' ? data : type === 'assistant/message' ? data.message : undefined
    const text = message?.content.filter(block=>block.type==='text').map(block=>block.text).join('\n')
    if (!text?.trim()) continue
    const length = Math.min(text.length,8_000)
    if (messages.length === limit || length > remaining) {
      hasEarlier = true
      break
    }
    messages.push({seq,time,role:message.role,text:text.slice(0,length),...(length < text.length && {truncated:true})})
    remaining -= length
  }
  const nextBeforeSeq = hasEarlier ? messages.at(-1).seq : undefined
  return {sessionId:id,lastSeq:observation.cursor,messages:messages.reverse(),nextBeforeSeq}
}
