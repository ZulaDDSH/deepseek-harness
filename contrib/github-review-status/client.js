window.__ModuleLoader__.load({
  id:'dsh-github-review-status',
  factory:require=>{
    const React=require('react'),h=React.createElement
    const channel='/desktop-github-review-status'
    const css=`
      .dsh-github-review-settings {color:var(--dsw-alias-label-primary,inherit);max-width:44rem}
      .dsh-github-review-settings h2 {font-size:1.15rem;margin:0 0 .55rem}
      .dsh-github-review-settings p {line-height:1.45;margin:.55rem 0;color:var(--dsw-alias-label-secondary,inherit)}
      .dsh-github-review-settings ul {list-style:none;margin:.75rem 0;padding:0}
      .dsh-github-review-settings li {padding:.7rem 0;border-bottom:1px solid var(--dsw-alias-border-l2,#8886)}
      .dsh-github-review-settings :is(.repo,.actions) {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem}
      .dsh-github-review-settings .actions {justify-content:flex-start}
      .dsh-github-review-settings .name {display:grid;gap:.22rem;min-width:0;overflow-wrap:anywhere}
      .dsh-github-review-settings form {display:grid;gap:.5rem;margin-top:.65rem}
      .dsh-github-review-settings label {display:grid;gap:.28rem}
      .dsh-github-review-settings :is(button,input) {font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,transparent);
        border:1px solid var(--dsw-alias-border-l3,#8887);border-radius:7px;padding:.38rem .62rem}
      .dsh-github-review-settings button:enabled {cursor:pointer}
      .dsh-github-review-settings button:enabled:hover {background:var(--dsw-alias-interactive-bg-hover-solid,#8883)}
      .dsh-github-review-settings button:disabled {opacity:.55}
      .dsh-github-review-settings :is(button,input,a):focus-visible {outline:2px solid var(--dsw-focus-ring-color,#8aaffc);outline-offset:2px}
      .dsh-github-review-settings [role="alert"] {color:var(--dsw-alias-state-error-primary,#cf786c)}
    `
    async function call(rpc,method,args={}) {
      const reply=await rpc.call(channel,method,args)
      if(!reply.ok) throw new Error(reply.error.message)
      return reply.value
    }
    const button=(label,onClick,props={})=>h('button',{type:'button',onClick,...props},label)
    function Settings({rpc}) {
      const [rows,setRows]=React.useState(null)
      const [editing,setEditing]=React.useState('')
      const [token,setToken]=React.useState('')
      const [busy,setBusy]=React.useState(false)
      const [error,setError]=React.useState('')
      const [revision,refresh]=React.useReducer(n=>n+1,0)
      React.useEffect(()=>{
        let active=true
        call(rpc,'repositories').then(value=>{if(active)setRows(value)},err=>{if(active)setError(err.message)})
        return ()=>{active=false}
      },[rpc,revision])
      async function save(method,key) {
        setBusy(true)
        setError('')
        try {
          const value=await call(rpc,method,method==='connect'?{key,token}:{key})
          setRows(value)
          setEditing('')
          setToken('')
        } catch (error) {
          setError(error.message)
        } finally {
          setBusy(false)
        }
      }
      function edit(key) {
        setEditing(key)
        setToken('')
        setError('')
      }
      return h('section',{className:'dsh-github-review-settings','aria-label':'GitHub review status'},
        h('h2',null,'GitHub review status'),
        h('p',null,'Connect a repository to show PR status and required checks in Master Control. Use your existing GitHub Git credentials (works for private collaborator repositories), or enter a fine-grained (github_pat_…) or classic (ghp_…) read token.'),
        h('p',null,h('a',{href:'https://github.com/settings/personal-access-tokens/new',target:'_blank',rel:'noreferrer'},'Create a fine-grained token'),
          ' · ',h('a',{href:'https://github.com/settings/tokens/new',target:'_blank',rel:'noreferrer'},'Create a classic token')),
        error && h('p',{role:'alert'},error),
        rows?.length ? h('ul',null,rows.map(row=>h('li',{key:row.key},
          h('div',{className:'repo'},h('div',{className:'name'},h('strong',null,row.key),
            h('small',null,row.authMode==='git'?'Connected via Git credentials':row.configured?'Connected with token':'Needs a GitHub connection')),
            h('div',{className:'actions'},
              row.authMode!=='git' && button('Use Git credentials',()=>save('connect-git',row.key),{disabled:busy,'aria-label':'Use Git credentials for '+row.key}),
              button(row.authMode==='token'?'Replace token':'Connect token',()=>edit(row.key),{disabled:busy,'aria-label':(row.authMode==='token'?'Replace token for ':'Connect token for ')+row.key}),
              row.configured && button('Disconnect',()=>save('disconnect',row.key),{disabled:busy,'aria-label':'Disconnect '+row.key}))),
          editing===row.key && h('form',{onSubmit:event=>{event.preventDefault();void save('connect',row.key)}},
            h('label',null,'GitHub token',h('input',{type:'password',autoComplete:'off',spellCheck:false,
              required:true,autoFocus:true,maxLength:280,value:token,onChange:event=>setToken(event.target.value)})),
            h('div',{className:'actions'},h('button',{disabled:busy || !token.trim()},busy?'Connecting…':'Save connection'),
              button('Cancel',()=>edit(''),{disabled:busy})))))) :
          h('p',{role:'status'},rows?'Repositories appear here after a lead submits a GitHub PR to Auto Auditor.':error?'':'Loading repositories…'),
        button('Refresh repositories',()=>{setError('');refresh()},{disabled:busy}))
    }
    return {inject:['slots','connection'],apply(ctx){
      ctx.effect(()=>{
        const style=document.createElement('style')
        style.textContent=css
        document.head.append(style)
        return ()=>style.remove()
      },'GitHub review settings styles')
      ctx.slots.inject('settings.section',()=>ctx.slots.register({
        name:'settings.section',id:'github-review-status',order:13,label:()=> 'GitHub review status',
        inject:()=>({rpc:ctx.get('connection').rpc}),
      },Settings))
    }}
  },
})
