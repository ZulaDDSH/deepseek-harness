window.__ModuleLoader__.load({
  id: 'dsh-claude-account-manager',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const channel = '/claude-subscription-accounts'
    const css = `
      .dsh-accounts { max-width: 48rem; padding: 10px 0 18px; color: inherit; font: inherit; }
      .dsh-accounts h2 { margin: 8px 0; font-size: 20px; font-weight: 600; }
      .dsh-accounts p { margin: 6px 0 14px; line-height: 1.45; }
      .dsh-accounts .account-row { display:flex; align-items:center; justify-content:space-between;
        gap:16px; padding:12px 0; border-bottom:1px solid color-mix(in srgb,currentColor 18%, transparent); }
      .dsh-accounts .account-detail { margin-top:3px; font-size:.9em; opacity:.82; overflow-wrap:anywhere; }
      .dsh-accounts .account-error { margin:8px 0; color:var(--color-danger,#d67767); }
      .dsh-accounts button, .dsh-accounts input { font: inherit; color: inherit; border-radius: 8px;
        border: 1px solid color-mix(in srgb,currentColor 32%, transparent); background:transparent; padding:7px 12px; }
      .dsh-accounts input { width:min(100%, 17rem); }
      .dsh-accounts button:enabled {cursor:pointer;}
      .dsh-accounts button:disabled {opacity:.55;}
      .dsh-accounts form {display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin:15px 0 8px;}
      .dsh-accounts button:focus-visible, .dsh-accounts input:focus-visible {outline:2px solid currentColor;}
    `
    function AccountPage({ rpc }) {
      const [rows, setRows] = React.useState(null)
      const [name, setName] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const serial = React.useRef(0)
      const locked = React.useRef(false)
      const mounted = React.useRef(true)
      const acknowledged = React.useRef(0)
      const call = React.useCallback(
        async (method, args = {}) => {
          if (locked.current) return
          const seq = ++serial.current
          if (method !== 'list') {
            locked.current = true
            setBusy(true)
          }
          try {
            const result = await rpc.call(channel, method, {
              ...args,
              includeNotice: true,
              ackNotice: acknowledged.current,
            })
            if (!result.ok) throw new Error(result.error?.message || 'Account request failed.')
            if (!mounted.current || seq !== serial.current) return
            setRows(result.value.accounts || result.value)
            setNotice(result.value.notice || '')
            if (result.value.notice) acknowledged.current = result.value.noticeId
            setError('')
            if (method === 'add') setName('')
          } catch (err) {
            if (mounted.current && seq === serial.current) setError(err.message)
          } finally {
            if (method !== 'list') {
              locked.current = false
              if (mounted.current) setBusy(false)
            }
          }
        },
        [rpc],
      )
      React.useEffect(() => {
        mounted.current = true
        void call('list')
        return () => {
          mounted.current = false
          serial.current++
        }
      }, [call])
      const pending = (rows || [])
        .filter((a) => a.pending)
        .map((a) => a.id)
        .sort()
        .join(',')
      React.useEffect(() => {
        if (!pending) return
        let stopped = false
        let timer
        let delay = 3000
        const poll = async () => {
          await call('list')
          if (stopped) return
          delay = Math.min(delay * 2, 30000)
          timer = setTimeout(poll, delay)
        }
        timer = setTimeout(poll, delay)
        return () => {
          stopped = true
          clearTimeout(timer)
        }
      }, [call, pending])
      return h(
        'section',
        { className: 'dsh-accounts', 'aria-label': 'Claude accounts' },
        h('h2', null, 'Claude accounts'),
        h(
          'p',
          null,
          'Sign in with Claude Code. To switch accounts, choose a model under that account’s group in the chat model picker.',
        ),
        !rows && !error && h('p', { role: 'status' }, 'Checking Claude sign-ins…'),
        ...(rows || []).map((a) =>
          h(
            'div',
            { key: a.id, className: 'account-row' },
            h(
              'div',
              null,
              h('strong', null, a.picker),
              h(
                'div',
                { className: 'account-detail' },
                a.signedIn
                  ? [a.email, a.plan && a.plan.toUpperCase()].filter(Boolean).join(' · ') || 'Signed in'
                  : a.pending
                    ? 'Finish signing in with Anthropic in the browser.'
                    : a.error
                      ? 'Sign-in unavailable'
                      : 'Signed out',
              ),
              a.error && h('div', { className: 'account-error', role: 'alert' }, a.error),
            ),
            !a.signedIn &&
              h(
                'button',
                {
                  type: 'button',
                  disabled: busy || a.pending,
                  onClick: () => call('login', { id: a.id }),
                  'aria-label': 'Sign in to ' + a.label,
                },
                a.pending ? 'Signing in…' : 'Sign in',
              ),
          ),
        ),
        h(
          'form',
          {
            onSubmit: (e) => {
              e.preventDefault()
              if (name.trim()) void call('add', { label: name })
            },
          },
          h('input', {
            value: name,
            onChange: (e) => setName(e.target.value),
            maxLength: 32,
            required: true,
            'aria-label': 'Account name',
            placeholder: 'Account name, e.g. Work',
          }),
          h('button', { type: 'submit', disabled: busy || !name.trim() }, 'Add account and sign in'),
        ),
        h('button', { type: 'button', disabled: busy, onClick: () => call('list') }, 'Refresh sign-ins'),
        notice && h('p', { role: 'status' }, notice),
        error && h('p', { role: 'alert', className: 'account-error' }, error),
      )
    }
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        const rpc = ctx.get('connection').rpc
        ctx.effect(() => {
          const style = document.createElement('style')
          style.textContent = css
          document.head.append(style)
          return () => style.remove()
        }, 'Claude account styles')
        for (const [slot, order] of [
          ['settings.section', 11],
          ['settings.models.footer', 0],
        ]) {
          ctx.slots.inject(slot, () =>
            ctx.slots.register(
              {
                name: slot,
                id: 'claude-accounts',
                order,
                label: () => 'Claude accounts',
                inject: () => ({ rpc }),
              },
              AccountPage,
            ),
          )
        }
      },
    }
  },
})
