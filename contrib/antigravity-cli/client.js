window.__ModuleLoader__.load({
  id:'dsh-antigravity-cli',
  factory:require=>{
    const {createElement:h,useEffect,useState}=require('react')
    function Accounts({rpc}) {
      const [revision,refresh]=useState(0)
      const [state,setState]=useState({busy:true})
      useEffect(()=>{
        let active=true
        rpc.call('/antigravity-accounts','list',{}).then(response=>{
          if(active) setState(response.ok ? {models:response.value} : {error:response.error.message})
        }).catch(error=>{
          if(active) setState({error:error.message})
        })
        return ()=>{active=false}
      },[rpc,revision])
      return h('section',null,
        h('h2',null,'Antigravity accounts'),
        h('p',null,'Harness uses the current Antigravity CLI sign-in. To connect or switch accounts, open ',
          h('code',null,'agy'),' in a terminal and complete Google sign-in.'),
        h('button',{type:'button',disabled:state.busy,onClick:()=>{
          setState({busy:true})
          refresh(value=>value+1)
        }},'Refresh models'),
        state.busy && h('p',{role:'status'},'Checking Antigravity CLI…'),
        state.error && h('p',{role:'alert'},state.error),
        state.models && h('p',{role:'status'},state.models.length
          ? state.models.length+' models available in the chat model picker under Antigravity CLI.'
          : 'No models returned. Check your sign-in in Antigravity CLI.'),
        state.models?.length>0 && h('details',null,h('summary',null,'Available models'),
          h('ul',null,state.models.map(model=>h('li',{key:model.id},model.name)))))
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
