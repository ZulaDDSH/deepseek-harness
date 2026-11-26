window.__ModuleLoader__.load({
  id: 'dsh-antigravity-cli',
  factory: require => {
    const {createElement: h, useEffect, useState} = require('react')
    const pending = ['starting', 'authorization', 'verifying']
    const css = `
      .dsh-agy-settings {color:var(--dsw-alias-label-primary,inherit);max-width:46rem}
      .dsh-agy-settings h2 {font-size:1.15rem;margin:0 0 .5rem;font-weight:500}
      .dsh-agy-settings p {line-height:1.45;margin:.5rem 0;color:var(--dsw-alias-label-secondary,inherit)}
      .dsh-agy-settings small {color:var(--dsw-alias-label-secondary,inherit)}
      .dsh-agy-settings .agy-card {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.65rem;padding:.75rem .9rem;margin:.8rem 0;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent)}
      .dsh-agy-settings .agy-card strong {font-weight:500}
      .dsh-agy-settings .agy-stack {display:grid;gap:.2rem;min-width:0}
      .dsh-agy-settings .agy-actions {display:flex;align-items:center;flex-wrap:wrap;gap:.5rem}
      .dsh-agy-settings form {display:grid;gap:.55rem;margin:.75rem 0;padding:.75rem .9rem;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent)}
      .dsh-agy-settings label {display:grid;gap:.3rem;font-size:.86rem}
      .dsh-agy-settings :is(button,input) {font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l3,#8887);border-radius:7px;padding:.38rem .66rem}
      .dsh-agy-settings button.primary {background:var(--dsw-alias-button-info-fill,#445fb1);color:var(--dsw-alias-label-on-color,#fff);border-color:transparent;font-weight:500}
      .dsh-agy-settings button.primary:enabled:hover {background:var(--dsw-alias-button-info-hover,#38509a)}
      .dsh-agy-settings button:enabled {cursor:pointer}
      .dsh-agy-settings button:enabled:hover {background:var(--dsw-alias-interactive-bg-hover-solid,#8883)}
      .dsh-agy-settings button:disabled {opacity:.55}
      .dsh-agy-settings :is(button,input,a):focus-visible {outline:2px solid var(--dsw-focus-ring-color,#8aaffc);outline-offset:2px}
      .dsh-agy-settings [role="alert"] {color:var(--dsw-alias-state-error-primary,#cf786c)}
      .dsh-agy-settings ul {list-style:none;margin:.6rem 0 0;padding:0}
      .dsh-agy-settings li {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.45rem;padding:.55rem 0;border-bottom:1px solid var(--dsw-alias-border-l2,#8886)}
      .dsh-agy-settings .agy-model-name {font-weight:500}
      .dsh-agy-settings .agy-meta {display:flex;align-items:center;flex-wrap:wrap;gap:.35rem}
      .dsh-agy-settings .agy-pill {font-size:.7rem;font-weight:500;padding:.1rem .42rem;border-radius:999px;border:1px solid var(--dsw-alias-border-l3,#8886);color:var(--dsw-alias-label-secondary,inherit)}
    `

    async function call(rpc, method, args = {}) {
      const response = await rpc.call('/antigravity-accounts', method, args)
      if (!response.ok) throw new Error(response.error.message)
      return response.value
    }

    function formatContext(tokens) {
      if (!Number.isFinite(tokens) || tokens <= 0) return ''
      if (tokens >= 1_000_000) return Math.round(tokens / 100_000) / 10 + 'M'
      return Math.round(tokens / 1000) + 'K'
    }

    function Accounts({rpc}) {
      const [revision, refresh] = useState(0)
      const [cliInfo, setCliInfo] = useState(null)
      const [catalog, setCatalog] = useState({busy: true})
      const [login, setLogin] = useState({status: 'idle'})
      const [code, setCode] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      useEffect(() => {
        let active = true
        call(rpc, 'version').then(info => {
          if (active) setCliInfo(info)
        }).catch(err => {
          if (active) setCliInfo({error: err.message})
        })
        return () => { active = false }
      }, [rpc, revision])

      useEffect(() => {
        let active = true
        call(rpc, 'list', {refresh: revision > 0}).then(models => {
          if (active) setCatalog({models})
        }).catch(err => {
          if (active) setCatalog({error: err.message})
        })
        return () => { active = false }
      }, [rpc, revision])

      useEffect(() => {
        let active = true
        let timer
        async function poll() {
          try {
            const next = await call(rpc, 'status')
            if (!active) return
            setLogin(next)
            if (next.status === 'complete' && pending.includes(login.status)) refresh(v => v + 1)
            if (pending.includes(next.status)) timer = setTimeout(poll, 1000)
          } catch (err) {
            if (active) setError(err.message)
          }
        }
        if (!busy) void poll()
        return () => { active = false; clearTimeout(timer) }
      }, [rpc, login.status, busy])

      async function act(method, args) {
        setBusy(true)
        setError('')
        try {
          const next = await call(rpc, method, args)
          setLogin(next)
          if (next.status === 'complete') refresh(v => v + 1)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }

      const signingIn = pending.includes(login.status)
      return h('section', {className: 'dsh-agy-settings', 'aria-label': 'Antigravity accounts'},
        h('h2', null, 'Antigravity accounts'),
        h('p', null, 'Connect your Google account via Antigravity CLI (ACP + native Harness MCP tools, streaming, vision, reasoning efforts, and prompt caching).'),
        h('div', {className: 'agy-card'},
          h('div', {className: 'agy-stack'},
            h('strong', null, cliInfo?.version ? 'Antigravity CLI v' + cliInfo.version : 'Antigravity CLI'),
            h('small', null,
              cliInfo?.error ? cliInfo.error
                : catalog.models?.length ? catalog.models.length + ' models ready under Antigravity CLI in the chat model picker.'
                  : catalog.busy ? 'Checking Antigravity CLI…'
                    : catalog.error || 'Sign in with Google to load your models.')),
          h('div', {className: 'agy-actions'},
            h('button', {type: 'button', className: catalog.models?.length ? '' : 'primary', disabled: busy || signingIn, onClick: () => act('start')},
              catalog.models?.length ? 'Reconnect Google' : 'Sign in with Google'),
            h('button', {type: 'button', disabled: catalog.busy, onClick: () => {
              setCatalog({busy: true})
              refresh(v => v + 1)
            }}, 'Refresh models'),
            signingIn && h('button', {type: 'button', disabled: busy, onClick: () => { setCode(''); void act('cancel') }}, 'Cancel sign-in'))),
        login.status === 'starting' && h('p', {role: 'status'}, 'Starting Google sign-in…'),
        login.status === 'verifying' && h('p', {role: 'status'}, 'Verifying authorization code…'),
        login.status === 'complete' && h('p', {role: 'status'}, 'Google sign-in complete.'),
        login.status === 'authorization' && h('form', {onSubmit: event => {
          event.preventDefault()
          const authorizationCode = code
          setCode('')
          void act('authorize', {code: authorizationCode})
        }},
        h('p', null, h('a', {href: login.url, target: '_blank', rel: 'noreferrer'}, 'Open Google sign-in'),
          ' and paste the authorization code Google gives you.'),
        h('label', null, 'Authorization code',
          h('input', {type: 'password', value: code, autoComplete: 'off', maxLength: 4096,
            onChange: event => setCode(event.target.value)})),
        h('div', {className: 'agy-actions'},
          h('button', {type: 'submit', className: 'primary', disabled: busy || !code.trim()}, 'Connect account'))),
        (error || login.status === 'error') && h('p', {role: 'alert'}, error || login.message),
        catalog.models?.length > 0 && h('ul', {'aria-label': 'Available models'},
          catalog.models.map(model => h('li', {key: model.id},
            h('div', {className: 'agy-stack'},
              h('span', {className: 'agy-model-name'}, model.name),
              h('small', null, model.efforts?.length ? 'Efforts: ' + model.efforts.join(' · ') : model.id)),
            h('div', {className: 'agy-meta'},
              model.contextWindow && h('span', {className: 'agy-pill'}, formatContext(model.contextWindow) + ' ctx'),
              model.vision && h('span', {className: 'agy-pill'}, 'Vision'))))))
    }

    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = css
          document.head.append(style)
          return () => style.remove()
        }, 'Antigravity accounts settings styles')
        const slot = 'settings.section'
        ctx.slots.inject(slot, () => ctx.slots.register({
          name: slot, id: 'antigravity-accounts', order: 13, label: () => 'Antigravity accounts',
          inject: () => ({rpc: ctx.get('connection').rpc}),
        }, Accounts))
      },
    }
  },
})
