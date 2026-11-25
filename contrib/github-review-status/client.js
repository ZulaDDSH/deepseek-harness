window.__ModuleLoader__.load({
  id:'dsh-github-review-status',
  factory:require=>{
    const React=require('react'),h=React.createElement
    const channel='/desktop-github-review-status'
    const fixerId='desktop-pr-fixer'
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
      [data-row-key^="session:desktop-pr-fixer-"]{display:none !important}
      .dsh-pr-fixer{display:flex;flex:1;flex-direction:column;min-width:0;min-height:0}
      .dsh-pr-fixer header{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.6rem;
        padding:.85rem 1.2rem;border-bottom:1px solid var(--dsw-alias-border-l2,#8886)}
      .dsh-pr-fixer h1{font-size:1.15rem;margin:0}
      .dsh-pr-fixer .fixer-chat{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
      .dsh-pr-fixer .fixer-chat[hidden]{display:none}
      .dsh-pr-fixer .fixer-setup{margin:1rem auto;padding:0 1rem;width:min(100%,36rem);box-sizing:border-box;overflow:auto}
      .dsh-pr-fixer .fixer-setup form{display:flex;align-items:end;flex-wrap:wrap;margin:.8rem 0}
      .dsh-pr-fixer .fixer-setup label{flex:1;min-width:12rem}
      .dsh-pr-fixer select{font:inherit;color:inherit;min-width:0;width:100%;
        background:var(--dsw-alias-bg-layer-1,#303136);border:1px solid var(--dsw-alias-border-l3,#8887);border-radius:7px;padding:.38rem .6rem}
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
        h('p',null,'Connect a repository to show PR status and required checks in Master Control. Use a fine-grained token scoped to that repository with read access to Pull requests, Contents, Checks, and Commit statuses.'),
        h('p',null,h('a',{href:'https://github.com/settings/personal-access-tokens/new',target:'_blank',rel:'noreferrer'},'Create a GitHub token')),
        error && h('p',{role:'alert'},error),
        rows?.length ? h('ul',null,rows.map(row=>h('li',{key:row.key},
          h('div',{className:'repo'},h('div',{className:'name'},h('strong',null,row.key),
            h('small',null,row.configured?'Connected':'Needs a GitHub token')),
            h('div',{className:'actions'},
              button(row.configured?'Replace token':'Connect',()=>edit(row.key),{disabled:busy,'aria-label':(row.configured?'Replace token for ':'Connect ')+row.key}),
              row.configured && button('Disconnect',()=>save('disconnect',row.key),{disabled:busy,'aria-label':'Disconnect '+row.key}))),
          editing===row.key && h('form',{onSubmit:event=>{event.preventDefault();void save('connect',row.key)}},
            h('label',null,'GitHub token',h('input',{type:'password',autoComplete:'off',spellCheck:false,
              required:true,autoFocus:true,maxLength:280,value:token,onChange:event=>setToken(event.target.value)})),
            h('div',{className:'actions'},h('button',{disabled:busy || !token.trim()},busy?'Connecting…':'Save connection'),
              button('Cancel',()=>edit(''),{disabled:busy})))))) :
          h('p',{role:'status'},rows?'Repositories appear here after a lead submits a GitHub PR to Auto Auditor.':error?'':'Loading repositories…'),
        button('Refresh repositories',()=>{setError('');refresh()},{disabled:busy}))
    }
    function FixerIcon() {
      return h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,
        strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},
        h('path',{d:'M5 7l4 5-4 5m8 0h6M14 7h5'}))
    }
    function FixerPage({rpc,sessions,SessionProvider,renderFactorySlot}) {
      const [state,setState]=React.useState(null)
      const [bound,setBound]=React.useState(null)
      const [editing,setEditing]=React.useState(false)
      const [workspace,setWorkspace]=React.useState('')
      const [existing,setExisting]=React.useState('')
      const [error,setError]=React.useState('')
      const [busy,setBusy]=React.useState(false)
      const [revision,retry]=React.useReducer(n=>n+1,0)
      const sessionId=state?.sessionId
      React.useEffect(()=>{
        let active=true
        call(rpc,'fixer-current').then(value=>{if(active)setState(value)},err=>{if(active)setError(err.message)})
        return ()=>{active=false}
      },[rpc,revision])
      React.useEffect(()=>{
        if(!sessionId) return
        let active=true,reference
        async function retain() {
          await sessions.refresh()
          if(!active) return
          reference=sessions.retain(sessionId,{source:'desktopPrFixer'})
          await reference.ready
          if(active)setBound({sessionId,reference})
        }
        retain().catch(err=>{if(active)setError(err.message)})
        return ()=>{active=false;reference?.release()}
      },[sessions,sessionId,revision])
      async function save(event,method,args) {
        event.preventDefault()
        setBusy(true)
        setError('')
        try {
          setState(await call(rpc,method,args))
          setEditing(false)
        } catch (error) {setError(error.message)}
        finally {setBusy(false)}
      }
      const setup=editing || !sessionId
      return h('div',{className:'dsh-pr-fixer'},
        h('header',{className:'dsh-github-review-settings',style:{maxWidth:'none'}},
          h('h1',null,'PR Fixer'),
          sessionId && button(editing?'Cancel':'Change session',()=>{setError('');setEditing(!editing)},{disabled:busy})),
        error && h('div',{className:'fixer-setup dsh-github-review-settings'},
          h('p',{role:'alert'},error),!busy && button('Retry',()=>{setBound(null);setError('');retry()})),
        setup && h('div',{className:'fixer-setup dsh-github-review-settings'},
          state ? h(React.Fragment,null,
            state.sessions.length>0 && h('form',{onSubmit:event=>save(event,'fixer-link',{sessionId:existing})},
              h('label',null,'Existing session',h('select',{value:existing,onChange:event=>setExisting(event.target.value)},
                h('option',{value:''},'Choose a session'),state.sessions.map(item=>h('option',{key:item.id,value:item.id},item.title)))),
              h('button',{disabled:busy || !existing},'Use session')),
            !sessionId && state.workspaces.length>0 && h('form',{onSubmit:event=>save(event,'fixer-create',{workspaceId:workspace})},
              h('label',null,'Workspace for new session',h('select',{value:workspace,onChange:event=>setWorkspace(event.target.value)},
                h('option',{value:''},'Choose a workspace'),state.workspaces.map(item=>h('option',{key:item.id,value:item.id},item.title)))),
              h('button',{disabled:busy || !workspace},'Create PR Fixer')),
            !state.sessions.length && !state.workspaces.length && h('p',null,'Add a workspace to set up PR Fixer.')) :
            !error && h('p',{role:'status'},'Loading PR Fixer…')),
        h('div',{className:'fixer-chat',hidden:setup},
          bound && bound.sessionId===sessionId ? h(SessionProvider,{session:bound.reference},
            renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false})) :
            sessionId && !setup && !error && h('div',{className:'fixer-setup',role:'status'},'Opening PR Fixer…')))
    }
    return {inject:['slots','connection','sessions'],apply(ctx){
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
      ctx.slots.inject('main',()=>ctx.slots.register({
        name:'main',key:fixerId,children:{'desktop-pr-fixer.private-binding':{kind:'single',scope:'session-maybe'}},
        inject:()=>({rpc:ctx.get('connection').rpc,sessions:ctx.get('sessions')}),
      },FixerPage))
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({
        name:'sidebar.panellist',id:fixerId,order:-18,label:()=> 'PR Fixer',
      },FixerIcon))
    }}
  },
})
