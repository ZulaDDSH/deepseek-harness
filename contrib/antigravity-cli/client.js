window.__ModuleLoader__.load({
  id:'dsh-antigravity-cli',
  factory:require=>{
    const {createElement:h,useEffect,useState}=require('react')
    const pending=['starting','authorization','verifying']
    async function call(rpc,method,args={}) {
      const response=await rpc.call('/antigravity-accounts',method,args)
      if(!response.ok) throw new Error(response.error.message)
      return response.value
    }
    function Accounts({rpc}) {
      const [revision,refresh]=useState(0)
      const [catalog,setCatalog]=useState({busy:true})
      const [login,setLogin]=useState({status:'idle'})
      const [code,setCode]=useState('')
      const [error,setError]=useState('')
      const [busy,setBusy]=useState(false)
      useEffect(()=>{
        let active=true
        call(rpc,'list').then(models=>{
          if(active) setCatalog({models})
        }).catch(error=>{
          if(active) setCatalog({error:error.message})
        })
        return ()=>{active=false}
      },[rpc,revision])
      useEffect(()=>{
        let active=true
        let timer
        async function poll() {
          try {
            const next=await call(rpc,'status')
            if(!active) return
            setLogin(next)
            if(next.status==='complete' && pending.includes(login.status)) refresh(value=>value+1)
            if(pending.includes(next.status)) timer=setTimeout(poll,1000)
          } catch(error) {
            if(active) setError(error.message)
          }
        }
        if(!busy) void poll()
        return ()=>{active=false;clearTimeout(timer)}
      },[rpc,login.status,busy])
      async function act(method,args) {
        setBusy(true)
        setError('')
        try {
          const next=await call(rpc,method,args)
          setLogin(next)
          if(next.status==='complete') refresh(value=>value+1)
        } catch(error) {
          setError(error.message)
        } finally {
          setBusy(false)
        }
      }
      const signingIn=pending.includes(login.status)
      return h('section',null,
        h('h2',null,'Antigravity accounts'),
        h('p',null,'Connect your Google account to use your Antigravity subscription models in Harness chats.'),
        h('div',{style:{display:'flex',gap:8,flexWrap:'wrap'}},
          h('button',{type:'button',disabled:busy || signingIn,onClick:()=>act('start')},'Sign in with Google'),
          h('button',{type:'button',disabled:catalog.busy,onClick:()=>{
            setCatalog({busy:true})
            refresh(value=>value+1)
          }},'Refresh models'),
          signingIn && h('button',{type:'button',disabled:busy,onClick:()=>{setCode('');void act('cancel')}},'Cancel sign-in')),
        login.status==='starting' && h('p',{role:'status'},'Starting Google sign-in…'),
        login.status==='verifying' && h('p',{role:'status'},'Verifying authorization code…'),
        login.status==='complete' && h('p',{role:'status'},'Google sign-in complete.'),
        login.status==='authorization' && h('form',{onSubmit:event=>{
          event.preventDefault()
          const authorizationCode=code
          setCode('')
          void act('authorize',{code:authorizationCode})
        }},
        h('p',null,h('a',{href:login.url,target:'_blank',rel:'noreferrer'},'Open Google sign-in'),
          ' and paste the authorization code Google gives you.'),
        h('label',null,'Authorization code ',
          h('input',{type:'password',value:code,autoComplete:'off',maxLength:4096,
            onChange:event=>setCode(event.target.value)})),
        h('button',{type:'submit',disabled:busy || !code.trim()},'Connect account')),
        (error || login.status==='error') && h('p',{role:'alert'},error || login.message),
        catalog.busy && h('p',{role:'status'},'Checking Antigravity CLI…'),
        catalog.error && !signingIn && h('p',{role:'status'},catalog.error),
        catalog.models && h('p',{role:'status'},catalog.models.length
          ? catalog.models.length+' models available under Antigravity CLI in the chat model picker.'
          : 'No models returned. Sign in with Google, then refresh.'),
        catalog.models?.length>0 && h('details',null,h('summary',null,'Available models'),
          h('ul',null,catalog.models.map(model=>h('li',{key:model.id},model.name)))))
    }
    return {
      inject:['slots','connection'],
      apply(ctx) {
        const slot='settings.section'
        ctx.slots.inject(slot,()=>ctx.slots.register({
          name:slot,id:'antigravity-accounts',order:13,label:()=> 'Antigravity accounts',
          inject:()=>({rpc:ctx.get('connection').rpc}),
        },Accounts))
      },
    }
  },
})
