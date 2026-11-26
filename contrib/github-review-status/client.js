window.__ModuleLoader__.load({
  id:'dsh-github-review-status',
  factory:require=>{
    const React=require('react'),h=React.createElement
    const channel='/desktop-github-review-status'
    const css=`
      .dsh-github-review-settings {color:var(--dsw-alias-label-primary,inherit);max-width:46rem}
      .dsh-github-review-settings h2 {font-size:1.15rem;margin:0 0 .55rem;font-weight:500}
      .dsh-github-review-settings h3 {font-size:.82rem;font-weight:500;color:var(--dsw-alias-label-secondary,inherit);margin:1.1rem 0 .25rem;display:flex;align-items:center;gap:.45rem}
      .dsh-github-review-settings p {line-height:1.45;margin:.55rem 0;color:var(--dsw-alias-label-secondary,inherit)}
      .dsh-github-review-settings .global-card {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.65rem;padding:.75rem .9rem;margin:.8rem 0;border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent)}
      .dsh-github-review-settings .global-card strong {font-weight:500}
      .dsh-github-review-settings .filter-bar {display:flex;align-items:center;gap:.5rem;margin:.7rem 0 .25rem;flex-wrap:wrap}
      .dsh-github-review-settings .filter-bar input {flex:1;min-width:12rem}
      .dsh-github-review-settings ul {list-style:none;margin:0 0 .5rem;padding:0}
      .dsh-github-review-settings li {padding:.62rem 0;border-bottom:1px solid var(--dsw-alias-border-l2,#8886)}
      .dsh-github-review-settings :is(.repo,.actions) {display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem}
      .dsh-github-review-settings .actions {justify-content:flex-start}
      .dsh-github-review-settings .name {display:grid;gap:.2rem;min-width:0;overflow-wrap:anywhere}
      .dsh-github-review-settings .name-line {display:flex;align-items:center;flex-wrap:wrap;gap:.4rem}
      .dsh-github-review-settings .name-line strong {font-weight:500}
      .dsh-github-review-settings .tag {font-size:.7rem;font-weight:500;padding:.08rem .4rem;border-radius:999px;border:1px solid var(--dsw-alias-border-l3,#8886);color:var(--dsw-alias-label-secondary,inherit)}
      .dsh-github-review-settings form {display:grid;gap:.5rem;margin-top:.65rem}
      .dsh-github-review-settings label {display:grid;gap:.28rem}
      .dsh-github-review-settings :is(button,input) {font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,transparent);
        border:1px solid var(--dsw-alias-border-l3,#8887);border-radius:7px;padding:.38rem .62rem}
      .dsh-github-review-settings button.primary {background:var(--dsw-alias-button-info-fill,#445fb1);color:var(--dsw-alias-label-on-color,#fff);border-color:transparent;font-weight:500}
      .dsh-github-review-settings button.primary:enabled:hover {background:var(--dsw-alias-button-info-hover,#38509a)}
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
      const [account,setAccount]=React.useState(null)
      const [query,setQuery]=React.useState('')
      const [editing,setEditing]=React.useState('')
      const [token,setToken]=React.useState('')
      const [busy,setBusy]=React.useState(false)
      const [error,setError]=React.useState('')
      const [revision,refresh]=React.useReducer(n=>n+1,0)
      React.useEffect(()=>{
        let active=true
        const force=revision>0
        Promise.all([
          call(rpc,'repositories',{discover:true,refresh:force}),
          call(rpc,'account',{discover:true,refresh:force}),
        ]).then(([list,acct])=>{
          if(!active) return
          setRows(list)
          setAccount(acct)
        },err=>{if(active)setError(err.message)})
        return ()=>{active=false}
      },[rpc,revision])
      async function save(method,key) {
        setBusy(true)
        setError('')
        try {
          const payload=method==='connect'?{key,token,discover:true}:{key,discover:true}
          const value=await call(rpc,method,payload)
          setRows(value)
          setEditing('')
          setToken('')
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }
      async function toggleAllGit(enable) {
        setBusy(true)
        setError('')
        try {
          const res=await call(rpc,enable?'connect-all-git':'disconnect-all-git',{discover:true})
          setRows(res.repositories)
          setAccount(prev=>({...(prev || {}),allReposGit:res.allReposGit,discoveredCount:res.discoveredCount,discoveryError:''}))
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy(false)
        }
      }
      function edit(key) {
        setEditing(key)
        setToken('')
        setError('')
      }
      const needle=query.trim().toLowerCase()
      const filtered=(rows ?? []).filter(row=>!needle || row.key.includes(needle) || (row.fullName || '').toLowerCase().includes(needle))
      const grouped=React.useMemo(()=>{
        const map=new Map()
        for(const row of filtered) {
          const owner=row.owner || row.key.split('/')[0]
          const k=owner.toLowerCase()
          let group=map.get(k)
          if(!group) {group={owner,items:[]}; map.set(k,group)}
          group.items.push(row)
        }
        return [...map.values()].sort((a,b)=>{
          const aTracked=a.items.some(x=>x.tracked)?0:1, bTracked=b.items.some(x=>x.tracked)?0:1
          if(aTracked!==bTracked) return aTracked-bTracked
          return a.owner.toLowerCase().localeCompare(b.owner.toLowerCase())
        })
      },[filtered])
      const allOn=account?.allReposGit===true
      return h('section',{className:'dsh-github-review-settings','aria-label':'GitHub review status'},
        h('h2',null,'GitHub review status'),
        h('p',null,'Connect your GitHub repositories so Auto Auditor, PR Fixer, and Master Control can read PR status, checks, and branches across your personal and organization repos.'),
        h('div',{className:'global-card'},
          h('div',{className:'name'},
            h('strong',null,'All accessible repositories (Git credentials)'),
            h('small',null,allOn
              ? 'Enabled — agents and Review queue can access all repositories available to your host GitHub credentials'+(account?.discoveredCount?' ('+account.discoveredCount+' discovered).':'.')
              : 'Enable to automatically grant access to all personal, collaborator, and organization repositories.')),
          h('div',{className:'actions'},
            button(allOn?'Disable all-repos access':'Use Git credentials for all repos',()=>toggleAllGit(!allOn),{
              disabled:busy,className:allOn?'':'primary',
            }))),
        h('p',null,h('a',{href:'https://github.com/settings/personal-access-tokens/new',target:'_blank',rel:'noreferrer'},'Create a fine-grained token'),
          ' · ',h('a',{href:'https://github.com/settings/tokens/new',target:'_blank',rel:'noreferrer'},'Create a classic token')),
        error && h('p',{role:'alert'},error),
        !error && account?.discoveryError && h('p',{role:'status'},'Could not list organization repositories via Git credentials: '+account.discoveryError),
        rows && rows.length>5 && h('div',{className:'filter-bar'},
          h('input',{type:'search',placeholder:'Filter repositories or organizations…','aria-label':'Filter repositories',
            value:query,onChange:event=>setQuery(event.target.value)}),
          h('small',null,filtered.length+' of '+rows.length)),
        grouped.length ? grouped.map(group=>h('div',{key:group.owner.toLowerCase()},
          h('h3',null,group.owner,' · ',group.items.length),
          h('ul',null,group.items.map(row=>h('li',{key:row.key},
            h('div',{className:'repo'},h('div',{className:'name'},
              h('div',{className:'name-line'},
                h('strong',null,row.fullName || row.key),
                row.private && h('span',{className:'tag'},'Private'),
                row.archived && h('span',{className:'tag'},'Archived')),
              h('small',null,row.viaAllRepos?'Connected via Git credentials (all repos)':row.authMode==='git'?'Connected via Git credentials':row.configured?'Connected with token':'Not connected')),
              h('div',{className:'actions'},
                row.authMode!=='git' && button('Use Git credentials',()=>save('connect-git',row.key),{disabled:busy,'aria-label':'Use Git credentials for '+row.key}),
                button(row.authMode==='token'?'Replace token':'Connect token',()=>edit(row.key),{disabled:busy,'aria-label':(row.authMode==='token'?'Replace token for ':'Connect token for ')+row.key}),
                row.configured && button('Disconnect',()=>save('disconnect',row.key),{disabled:busy,'aria-label':'Disconnect '+row.key}))),
            editing===row.key && h('form',{onSubmit:event=>{event.preventDefault();void save('connect',row.key)}},
              h('label',null,'GitHub token',h('input',{type:'password',autoComplete:'off',spellCheck:false,
                required:true,autoFocus:true,maxLength:280,value:token,onChange:event=>setToken(event.target.value)})),
              h('div',{className:'actions'},h('button',{disabled:busy || !token.trim()},busy?'Connecting…':'Save connection'),
                button('Cancel',()=>edit(''),{disabled:busy})))))))) :
          h('p',{role:'status'},rows?(needle?'No repositories match this filter.':'No repositories discovered yet. Sign in to GitHub in Git or submit a GitHub PR to Auto Auditor.'):error?'':'Loading repositories…'),
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
