export function parseTurn(stdout,stderr,exitCode) {
  let result
  for(const line of stdout.split(/\r?\n/)) {
    if(!line.trim()) continue
    let event
    try {event=JSON.parse(line)} catch {continue} // Startup diagnostics may share stdout.
    if(event?.event==='result') result=event.result
  }
  if(exitCode===0 && result?.status==='SUCCESS' &&
      typeof result.response==='string' && result.response.trim())
    return {text:result.response}

  const diagnostic=[result?.error,stderr].filter(value=>typeof value==='string').join('\n')
  if(/headless mode cannot prompt|tool (?:permission|confirmation).{0,120}(?:auto.denied|rejected)/i.test(diagnostic))
    return {code:'UNSUPPORTED_OPTION',message:'Antigravity stopped when a tool needed approval. This CLI route cannot ask for tool permission in chat. Use another model for this workspace task.'}
  if(/not logged in|authentication required|unauthenticated/i.test(diagnostic))
    return {code:'INVALID_REQUEST',message:'Antigravity needs Google sign-in. Open Settings → Antigravity accounts and sign in.'}
  if(/RESOURCE_EXHAUSTED|quota exceeded|rate limit|\b429\b/i.test(diagnostic))
    return {code:'RATE_LIMIT',message:'Antigravity reported a subscription quota or rate limit.'}
  if(/invalid model selection|not recognized as a known model/i.test(diagnostic))
    return {code:'INVALID_REQUEST',message:'Antigravity rejected the selected model. Refresh models in Antigravity accounts and select an available model.'}
  if(/deadline exceeded|print.mode timeout|timed out/i.test(diagnostic))
    return {code:'TIMEOUT',message:'Antigravity CLI timed out before returning an answer.'}
  if(result?.status==='WAITING')
    return {code:'UNSUPPORTED_OPTION',message:'Antigravity stopped waiting for input or permission that its headless mode cannot collect.'}
  if(exitCode===0 && result?.status==='SUCCESS')
    return {code:'EMPTY_RESPONSE',message:'Antigravity finished without returning any answer text.'}
  return {code:'SERVER',message:'Antigravity CLI ended without a usable answer. Try again or select a different model.'}
}
