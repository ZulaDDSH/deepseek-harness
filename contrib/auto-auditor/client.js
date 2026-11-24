window.__ModuleLoader__.load({
  id:'dsh-auto-auditor-background',
  factory:require=>{
    const React=require('react'),h=React.createElement
    const {useState,useEffect,useReducer}=React
    const id='desktop-auto-auditor',channel='/desktop-auto-auditor'
    const labels={queued:'Queued',reviewing:'In review',ready:'Ready to push',changes_requested:'Changes requested',needs_run:'Run requested',failed:'Review failed'}
    const css=`
      .audit{--ink:var(--dsw-alias-label-primary,#eaecf1);--soft:var(--dsw-alias-label-secondary,#a5acb9);--fill:var(--dsw-alias-bg-layer-1,#22252a);--rule:color-mix(in srgb,var(--ink) 16%,transparent);--accent:var(--dsw-alias-link,#96aff7);color:var(--ink);background:var(--dsw-alias-bg-base,#17191d);display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;container-type:inline-size;font-size:.9rem}
      .audit *{box-sizing:border-box}.audit :is(h1,h2,h3,p,dl,dd){margin:0}.audit h1{font-size:1.22rem;letter-spacing:-.035em}.audit h2{font-size:1.15rem;letter-spacing:-.02em}.audit h3{font-size:.9rem}.audit p,.audit li{line-height:1.55;overflow-wrap:anywhere}
      .audit header,.audit .actions{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}.audit header{justify-content:space-between;padding:.9rem 1.15rem;border-bottom:1px solid var(--rule)}
      .audit .body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(12rem,29%) minmax(0,1fr)}.audit .queue,.audit .detail{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.audit .queue{border-inline-end:1px solid var(--rule);padding:1rem .65rem}.audit .queue h2{font-size:.84rem;margin:0 .45rem .8rem;color:var(--soft)}.audit .detail{padding:clamp(1rem,3cqi,2.2rem)}.audit .stack{display:grid;gap:1rem;max-width:64rem}.audit .empty{max-width:32rem;color:var(--soft)}
      .audit :is(button,input,textarea,select){font:inherit;color:inherit}.audit button{cursor:pointer;border:1px solid var(--rule);background:transparent;border-radius:.48rem;padding:.36rem .64rem}.audit button:enabled:hover{background:var(--fill)}.audit button:disabled{opacity:.5;cursor:default}.audit button.primary{background:var(--dsw-alias-button-info-fill,#445fb1);color:var(--dsw-alias-label-on-color,white);border-color:transparent}.audit button.item{display:grid;width:100%;text-align:start;border-color:transparent;gap:.32rem;padding:.6rem;margin-bottom:.18rem}.audit button.item[aria-current=true]{background:var(--fill);box-shadow:inset 2px 0 var(--accent)}.audit .item strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .audit small,.audit dt{color:var(--soft)}.audit .status{font-size:.76rem;font-weight:600}.audit [data-state=ready]{color:var(--dsw-alias-state-business-primary,var(--accent))}.audit .notice{border-inline-start:2px solid var(--accent);padding:.42rem .7rem}.audit .section,.audit details{border-top:1px solid var(--rule);padding-top:.85rem}.audit .section h3{margin-bottom:.4rem}.audit ul{padding-inline-start:1.25rem;margin:.3rem 0}.audit dl{display:flex;flex-wrap:wrap;gap:.7rem 1.3rem}.audit dt{font-size:.76rem}.audit dd{overflow-wrap:anywhere}
      .audit code,.audit pre{font-family:ui-monospace,Consolas,monospace}.audit pre{overflow:auto;max-height:55vh;padding:.85rem;background:var(--fill);border-radius:.45rem;font-size:.78rem;line-height:1.5}.audit details summary{cursor:pointer;font-weight:600}.audit form,.audit .fields{display:grid;gap:.8rem;max-width:38rem}.audit label{display:grid;gap:.3rem;font-size:.85rem}.audit input,.audit textarea,.audit select{border:1px solid var(--rule);background:var(--fill);border-radius:.4rem;padding:.45rem .6rem;width:100%;min-width:0}.audit textarea{resize:vertical;min-height:4.6rem}.audit :focus-visible{outline:2px solid var(--accent);outline-offset:2px}.audit .long{white-space:pre-wrap}.audit .detail h2{overflow-wrap:anywhere}
      @container(max-width:690px){.audit .body{display:flex;flex-direction:column}.audit .queue{max-height:28%;flex-shrink:0;border-inline-end:0;border-bottom:1px solid var(--rule)}.audit .detail{flex:1}}
      .audit-icon{position:relative;display:inline-flex;align-items:center}.audit-icon small{position:absolute;inset-inline-start:62%;top:-.4em;background:var(--dsw-alias-button-info-fill,#465da0);color:var(--dsw-alias-label-on-color,white);border-radius:1em;padding:0 .23em;font:600 9px/1.2 system-ui}
    `
    async function call(rpc,method,args={}) {
      const result=await rpc.call(channel,method,args)
      if(!result.ok) throw new Error(result.error.message)
      return result.value
    }
    function useData(rpc,method,args,enabled=true,interval=0,revision=0) {
      const signature=JSON.stringify([method,args,revision])
      const [state,set]=useState({})
      useEffect(()=>{
        if(!enabled) return
        let active=true,timer
        async function load() {
          try {const value=await call(rpc,method,args);if(active)set({signature,value})}
          catch(error){if(active)set(prior=>({...(prior.signature===signature && prior),signature,error:error.message}))}
          finally {if(active && interval) timer=setTimeout(load,interval)}
        }
        void load()
        return ()=>{active=false;clearTimeout(timer)}
      },[rpc,enabled,signature,interval])
      return enabled && state.signature===signature ? state : {}
    }
    const button=(label,click,extra={})=>h('button',{type:'button',onClick:click,...extra},label)
    const problem=message=>message && h('p',{className:'notice',role:'alert'},message)
    const field=(label,input)=>h('label',null,label,input)
    const options=rows=>rows.map(row=>h('option',{key:row.id,value:row.id},row.name || row.id))
    function useAction() {
      const [busy,setBusy]=useState(false), [error,setError]=useState('')
      const lock=React.useRef(false)
      return {busy,error,run:async job=>{
        if(lock.current) return
        lock.current=true;setBusy(true);setError('')
        try {await job()} catch(e) {setError(e.message)} finally {lock.current=false;setBusy(false)}
      }}
    }
    function Settings({rpc,model,onDone}) {
      const [provider,setProvider]=useState(model?.provider || ''),[name,setName]=useState(model?.model || '')
      const [effort,setEffort]=useState(model?.reasoningEffort || '')
      const providers=useData(rpc,'providers',{}),models=useData(rpc,'models',{provider},!!provider)
      const reasoning=useData(rpc,'efforts',{provider,model:name},!!provider && !!name)
      const action=useAction()
      return h('form',{onSubmit:e=>{e.preventDefault();action.run(async()=>{
        await call(rpc,'settings',provider ? {provider,model:name,reasoningEffort:effort} : {inherit:true});onDone()
      })}},h('h2',null,'Reviewer model'),
      field('Provider',h('select',{value:provider,onChange:e=>{setProvider(e.target.value);setName('');setEffort('')}},
        h('option',{value:''},'Use each lead’s model and effort'),options(providers.value || []))),
      provider && field('Model',h('select',{required:true,value:name,onChange:e=>{setName(e.target.value);setEffort('')}},
        h('option',{value:''},'Choose model'),options(models.value || []))),
      name && provider && field('Reasoning effort',h('select',{value:effort,disabled:!reasoning.value,onChange:e=>setEffort(e.target.value)},
        h('option',{value:''},reasoning.value?.defaultEffort ? 'Model default · '+reasoning.value.defaultEffort : 'Model default'),options(reasoning.value?.efforts || []))),
      problem(action.error || providers.error || models.error || reasoning.error),
      h('div',{className:'actions'},h('button',{className:'primary',disabled:action.busy || !!provider && (!name || reasoning.value===undefined)},'Save reviewer'),button('Cancel',onDone)))
    }
    function Capture({rpc,id,capture}) {
      const [show,setShow]=useState(false)
      const data=useData(rpc,'capture',{id,side:capture.side},show)
      return h('div',null,button((show?'Hide ':'View ')+capture.side.toLowerCase()+' capture',()=>setShow(!show),{'aria-expanded':show}),
        show && (problem(data.error) || (data.value ? h('img',{src:data.value,alt:capture.side+' · '+capture.ref.name,
          style:{display:'block',maxWidth:'100%',maxHeight:'50vh',marginTop:8}}) : h('small',null,' Loading…'))))
    }
    function Detail({rpc,item,revision,refresh,select}) {
      const data=useData(rpc,'detail',{id:item.id},true,0,[item.status,item.revision,revision])
      const current=useData(rpc,'tip',{id:item.id},item.status==='ready',item.pull?60000:10000,revision)
      const action=useAction()
      if(!data.value) return problem(data.error) || h('p',{role:'status'},'Loading review…')
      const {row,patch,previous}=data.value, branch=current.error ? {kind:'unavailable'} : current.value || data.value.branch
      const changed=branch.kind!=='current'
      const msg=branch.kind==='advanced'?branch.added+' new commit'+(branch.added===1?'':'s')+' since submission.':
        {diverged:'Branch history has changed since submission.','pull-changed':'The PR has a new head commit.',
          'pull-base-changed':'The PR base changed since review.',unavailable:'The current PR or branch could not be verified.'}[branch.kind]
      const act=(method,args)=>action.run(async()=>{await call(rpc,method,args);refresh()})
      const section=(title,body)=>h('section',{className:'section'},h('h3',null,title),body)
      const list=items=>h('ul',null,items.map((s,i)=>h('li',{key:i},s)))
      const meta=(label,value)=>h('div',null,h('dt',null,label),h('dd',null,value))
      return h('article',{className:'stack'},h('div',null,h('small',{className:'status','data-state':row.status},
        changed && row.status==='ready'?'Earlier commit approved':labels[row.status]),h('h2',null,row.goal)),
        h('dl',null,meta('Lead',row.leadTitle),
          row.pull ? meta('Pull request',h('a',{href:row.pull.url,target:'_blank',rel:'noreferrer'},'PR #'+row.pull.number)) : meta('Branch',row.branch || 'Detached HEAD'),
          meta('Commit',h('code',{title:row.head},row.head.slice(0,12))),meta('Review ID',h('code',{title:row.id},row.id))),
        changed && h('p',{className:'notice'},msg,' The verdict applies to ',h('code',null,row.head.slice(0,10)),'.'),
        row.result && section('Verdict',h('p',null,row.result.summary)),
        row.result?.findings.length>0 && section('Findings',list(row.result.findings)),
        row.result?.checks.length>0 && section('Checks considered',list(row.result.checks)),
        row.result?.runRequest && section('Requested run',h('p',null,row.result.runRequest)),
        row.messages?.length>0 && section('Review conversation',h('div',{className:'stack'},
          row.messages.map(message=>h('div',{className:'stack',key:message.id},
            h('div',null,h('small',null,message.role),h('p',{className:'long'},message.body)),
            message.answer ? h('div',null,h('small',null,'Auto Auditor'),h('p',{className:'long'},message.answer),
              message.delivery==='failed' && h('small',null,message.deliveryError)) :
              h('small',null,message.error || (message.status==='answering'?'Writing a reply…':'Reply queued')))))),
        row.evidence && section('Submitted evidence',h('p',{className:'long'},row.evidence)),
        row.captures?.length>0 && section('Captures',h('div',{className:'stack'},row.captures.map(capture=>h(Capture,{rpc,id:row.id,capture,key:capture.side})))),
        previous && button('Earlier review · '+previous.head.slice(0,10),()=>select(previous.id)),
        h('details',null,h('summary',null,'Reviewed diff'),h('pre',{tabIndex:0},patch)),
        row.delivery && section('Delivery',h('div',{className:'stack'},Object.entries(row.delivery).map(([target,status])=>
          h('div',{className:'actions',key:target},h('span',null,(target==='lead'?'Originating lead':'Master Control')+' · '+status),
            row.deliveryErrors?.[target] && h('small',null,row.deliveryErrors[target]),
            ['failed','uncertain'].includes(status) && button('Retry delivery',()=>act('deliver',{id:row.id,target}),{disabled:action.busy}))))),
        problem(action.error || row.error || data.error || current.error),
        row.status==='failed' && h('div',null,button('Retry review',()=>act('retry',{id:row.id}),{disabled:action.busy})))
    }
    function Panel({rpc}) {
      const [revision,refresh]=useReducer(n=>n+1,0),[selected,select]=useState(null),[view,setView]=useState('queue')
      const data=useData(rpc,'list',{},true,5000,revision)
      const last=React.useRef(null)
      if(data.value) last.current=data.value
      const state=data.value || last.current, rows=state?.rows || []
      const item=rows.find(r=>r.id===selected) || rows[0]
      function openItem(id){select(id);setView('queue')}
      return h('div',{className:'audit'},h('header',null,h('div',{className:'actions'},h('h1',null,'Auto Auditor'),
        state && !data.error && h('small',{className:'worker'},state.pending ? state.pending+' in queue' : 'Listening for PRs')),
        button('Reviewer model',()=>setView('settings'),{disabled:!state})),
        h('div',{className:'body'},h('nav',{className:'queue','aria-label':'Reviews'},h('h2',null,'Reviews'+(rows.length?' · '+rows.length:'')),
          rows.map(row=>button(h(React.Fragment,null,h('strong',null,row.goal),
            h('small',null,row.leadTitle),h('small',{className:'status','data-state':row.status},(row.status==='ready'?'Approved':labels[row.status])+' · '+row.head.slice(0,8))),
            ()=>openItem(row.id),{key:row.id,className:'item','aria-current':view==='queue' && item?.id===row.id}))),
        h('section',{className:'detail','aria-label':'Review details'},problem(data.error),
          view==='settings' ? h(Settings,{rpc,model:state?.model,onDone:()=>{refresh();setView('queue')}}):
          item ? h(Detail,{key:item.id,rpc,item,revision,refresh,select:openItem}):
          h('div',{className:'stack'},h('h2',null,state?'No reviews yet':'Loading reviews…'),
            state && h('p',{className:'empty'},'In a lead chat, say “Send this PR to Auto Auditor” and include the PR link. Findings and replies appear here and in that chat.')))))
    }
    function Icon({rpc,size=18}) {
      const count=useData(rpc,'count',{},true,12000).value
      return h('span',{className:'audit-icon'},h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.65,'aria-hidden':true},
        h('path',{d:'M6 3.75h10l2.5 2.5v13.5H6zM9 9h6m-6 4 2 2 4-4',strokeLinecap:'round',strokeLinejoin:'round'})),
        count>0 && h('small',{'aria-label':count+' pending reviews'},count))
    }
    return {inject:['slots','connection'],apply(ctx){
      ctx.effect(()=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);return ()=>style.remove()},'Auto Auditor styles')
      const inject=()=>({rpc:ctx.get('connection').rpc})
      // The running renderer can retain the old client registration until its next launch.
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:id,priority:-10,inject},Panel))
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id,priority:-10,order:-19,label:()=> 'Auto Auditor',inject},Icon))
    }}
  },
})
