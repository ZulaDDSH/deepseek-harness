window.__ModuleLoader__.load({
  id:'dsh-auto-auditor-background',
  factory:require=>{
    const React=require('react'),h=React.createElement
    const {useState,useEffect,useReducer}=React
    const id='desktop-auto-auditor',channel='/desktop-auto-auditor'
    const fixerId='desktop-pr-fixer'
    const githubChannel='/desktop-github-review-status'
    const labels={queued:'Queued',reviewing:'In review',ready:'Ready to push',changes_requested:'Changes requested',needs_run:'Run requested',failed:'Review failed'}
    const queueStatuses={
      needs_run:['Needs input','Run requested by Auto Auditor.',0],
      failed:['Needs input','The audit failed. Open the review to see why.',0],
      changes_requested:['Changes requested','Auto Auditor sent findings to the lead.',1],
      ready:['Revision approved','Auto Auditor approved this commit.',2],
      reviewing:['In review','Auto Auditor is reviewing this change.',3],
      queued:['In review','Waiting for Auto Auditor.',3],
    }
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
      .audit,.mc-review-queue{--audit-warn:#9a6510;--audit-ok:#1f7a53;--audit-err:#b83c34}
      body[data-ds-dark-theme] :is(.audit,.mc-review-queue){--audit-warn:#e2b16b;--audit-ok:#72c29d;--audit-err:#e07a72}
      .mc-review-queue .mc-review-filters{display:flex;flex-wrap:wrap;gap:.3rem;padding:.6rem var(--mc-gutter);border-bottom:1px solid var(--mc-line)}
      .mc-review-queue .mc-review-filters button{color:var(--mc-muted);background:transparent;font:inherit;font-size:.72rem;font-weight:500;padding:.2rem .48rem;border-radius:999px;border:1px solid var(--mc-line);cursor:pointer}
      .mc-review-queue .mc-review-filters button:hover{background:var(--mc-hover);color:var(--mc-ink)}
      .mc-review-queue .mc-review-filters button[aria-pressed="true"]{color:var(--mc-ink);background:var(--mc-hover);border-color:var(--mc-accent)}
      .mc-review-queue .mc-review-filters button:focus-visible,.mc-review-queue .mc-review-target:focus-visible{outline:2px solid var(--mc-accent);outline-offset:2px}
      .mc-review-queue .mc-review-card{padding:.68rem 0;cursor:pointer}
      .mc-review-queue .mc-review-top{display:flex;align-items:center;justify-content:space-between;gap:.45rem;min-width:0}
      .mc-review-queue .mc-review-target{font-size:.86rem;font-weight:500;line-height:1.3;color:var(--mc-ink);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mc-review-queue a.mc-review-target:hover{color:var(--mc-accent);text-decoration:underline;text-underline-offset:2px}
      .mc-review-queue a{color:var(--mc-accent)}
      .mc-review-queue .mc-status{font-size:.69rem;font-weight:500;line-height:1.25;padding:.14rem .45rem;border-radius:999px;border:1px solid var(--mc-line);gap:.32rem}
      .mc-review-queue .mc-status:is([data-status="reviewing"],[data-status="queued"]){color:var(--mc-accent);border-color:color-mix(in srgb,var(--mc-accent) 40%,transparent);background:color-mix(in srgb,var(--mc-accent) 12%,transparent)}
      .mc-review-queue .mc-status[data-status="changes_requested"]{color:var(--dsw-alias-state-warning-primary,var(--audit-warn));border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,var(--audit-warn)) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,var(--audit-warn)) 12%,transparent)}
      .mc-review-queue .mc-status[data-status="changes_requested"]::before{background:currentColor;border:0}
      .mc-review-queue .mc-status:is([data-status="ready"],[data-status="review_ready"],[data-status="published"]){color:var(--dsw-alias-state-business-primary,var(--audit-ok));border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--audit-ok)) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--audit-ok)) 12%,transparent)}
      .mc-review-queue .mc-status:is([data-status="ready"],[data-status="review_ready"],[data-status="published"])::before{background:currentColor;border:0}
      .mc-review-queue .mc-status:is([data-status="needs_run"],[data-status="failed"],[data-status="ci_failed"]){color:var(--dsw-alias-state-error-primary,var(--audit-err));border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--audit-err)) 44%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--audit-err)) 12%,transparent)}
      .mc-review-queue .mc-status:is([data-status="needs_run"],[data-status="failed"],[data-status="ci_failed"])::before{border-radius:1px;transform:rotate(45deg);background:currentColor;border:0}
      .mc-review-queue .mc-review-sub{display:block;margin:.22rem 0 0;color:var(--mc-muted);font-size:.73rem;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mc-review-queue .mc-review-title{display:block;width:100%;margin:.24rem 0 0;font-size:.77rem;font-weight:400;line-height:1.38;letter-spacing:0;color:color-mix(in srgb,var(--mc-ink) 78%,var(--mc-muted));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mc-review-queue .mc-review-card:hover .mc-review-title{color:var(--mc-accent)}
      .mc-review-queue .mc-review-reason{margin:.28rem 0 0;color:var(--mc-muted);font-size:.74rem;line-height:1.35;overflow-wrap:anywhere}
      .mc-review-queue .mc-review-ci{display:flex;flex-wrap:wrap;gap:.25rem .5rem;align-items:baseline;margin:.28rem 0 0;font-size:.72rem;color:var(--mc-muted)}
      [data-row-key^="session:desktop-pr-fixer-"] { display:none !important }
      html.dsh-pr-fixer-hide-ungrouped div:has(> [data-row-key="workspace:"]),
      div:has(> [data-row-key="workspace:"][aria-expanded="true"]):not(:has([data-row-key^="session:"]:not([data-row-key^="session:desktop-pr-fixer-"]):not([data-row-key^="session:desktop-master-control-"]))) { display:none !important }
      .audit .fixer-content{display:flex;flex-direction:column;min-height:0;min-width:0}
      .audit .fixer-chat{display:flex;flex:1;flex-direction:column;min-height:0;min-width:0;overflow:hidden}
      .audit .fixer-chat [data-slot="conversation.input.permission"],
      .audit .fixer-chat [data-slot="conversation.hero.agentPreset"]{display:none !important}
      .audit .fixer-controls{padding:.7rem 1rem;border-bottom:1px solid var(--rule)}
      .audit .fixer-controls a,.audit .fixer-work a{color:var(--accent)}
      .audit .fixer-work .fixer-revision{word-break:break-all}
      .audit button[aria-pressed="true"]{background:var(--fill);border-color:var(--accent)}
      .audit .queue-head{display:flex;align-items:center;justify-content:space-between;gap:.4rem;margin:0 .35rem .55rem}
      .audit .queue-head h2{margin:0;font-weight:500}
      .audit .queue-mode{font-size:.73rem;padding:.18rem .46rem;color:var(--soft)}
      .audit .queue-filters{display:flex;flex-wrap:wrap;gap:.3rem;margin:0 .35rem .65rem}
      .audit .queue-filters button{font-size:.73rem;padding:.2rem .48rem;border-radius:999px;color:var(--soft);font-weight:500}
      .audit .queue-filters button[aria-pressed="true"]{color:var(--ink);background:var(--fill);border-color:var(--accent)}
      .audit button.item.audit-row{gap:.22rem;padding:.52rem .6rem;border-radius:.5rem}
      .audit .audit-row-top{display:flex;align-items:center;justify-content:space-between;gap:.45rem;min-width:0}
      .audit .audit-row-title{font-weight:500;font-size:.86rem;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .audit .audit-pill{flex:none;font-size:.7rem;font-weight:500;line-height:1.2;padding:.14rem .44rem;border-radius:999px;border:1px solid var(--rule);color:var(--soft)}
      .audit .audit-pill:is([data-state="queued"],[data-state="reviewing"]){color:var(--accent);border-color:color-mix(in srgb,var(--accent) 42%,transparent);background:color-mix(in srgb,var(--accent) 12%,transparent)}
      .audit .audit-pill:is([data-state="changes_requested"],[data-state="needs_run"]){color:var(--dsw-alias-state-warning-primary,var(--audit-warn));border-color:color-mix(in srgb,var(--dsw-alias-state-warning-primary,var(--audit-warn)) 42%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warning-primary,var(--audit-warn)) 12%,transparent)}
      .audit .audit-pill:is([data-state="failed"],[data-state="round_limit"]){color:var(--dsw-alias-state-error-primary,var(--audit-err));border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--audit-err)) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,var(--audit-err)) 12%,transparent)}
      .audit .audit-pill:is([data-state="ready"],[data-state="published"]){color:var(--dsw-alias-state-business-primary,var(--audit-ok));border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--audit-ok)) 42%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--audit-ok)) 12%,transparent)}
      .audit .audit-row-meta{display:flex;align-items:center;gap:.35rem;font-size:.75rem;color:var(--soft);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .audit .audit-row-goal{font-size:.74rem;color:color-mix(in srgb,var(--soft) 82%,transparent);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .audit .audit-rounds{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem;padding-bottom:.75rem;margin-bottom:.75rem;border-bottom:1px solid var(--rule)}
      .audit .audit-rounds small{font-size:.75rem;margin-inline-end:.2rem}
      .audit .audit-rounds button{font-size:.74rem;padding:.2rem .5rem;font-weight:500}
      .audit .audit-rounds select{width:auto;max-width:16rem;font-size:.74rem;padding:.2rem .45rem}
    `
    async function call(rpc,method,args={},path=channel) {
      const result=await rpc.call(path,method,args)
      if(!result.ok) throw new Error(result.error.message)
      return result.value
    }
    function useData(rpc,method,args,enabled=true,interval=0,revision=0,path=channel) {
      const signature=JSON.stringify([method,args,revision,path])
      const [state,set]=useState({})
      useEffect(()=>{
        if(!enabled) return
        let active=true,timer
        async function load() {
          try {const value=await call(rpc,method,args,path);if(active)set({signature,value})}
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
    function Settings({rpc,model,onDone,fixer=false}) {
      const [provider,setProvider]=useState(model?.provider || ''),[name,setName]=useState(model?.model || '')
      const [effort,setEffort]=useState(model?.reasoningEffort || '')
      const providers=useData(rpc,'providers',{}),models=useData(rpc,'models',{provider},!!provider)
      const reasoning=useData(rpc,'efforts',{provider,model:name},!!provider && !!name)
      const action=useAction()
      return h('form',{onSubmit:e=>{e.preventDefault();action.run(async()=>{
        await call(rpc,fixer?'fixer-model':'settings',provider ? {provider,model:name,reasoningEffort:effort} : {inherit:true});onDone()
      })}},h('h2',null,fixer?'Fixer model':'Reviewer model'),
      field('Provider',h('select',{value:provider,onChange:e=>{setProvider(e.target.value);setName('');setEffort('')}},
        h('option',{value:''},fixer?'Use the audit model and effort':'Use each lead’s model and effort'),options(providers.value || []))),
      provider && field('Model',h('select',{required:true,value:name,onChange:e=>{setName(e.target.value);setEffort('')}},
        h('option',{value:''},'Choose model'),options(models.value || []))),
      name && provider && field('Reasoning effort',h('select',{value:effort,disabled:!reasoning.value,onChange:e=>setEffort(e.target.value)},
        h('option',{value:''},reasoning.value?.defaultEffort ? 'Model default · '+reasoning.value.defaultEffort : 'Model default'),options(reasoning.value?.efforts || []))),
      problem(action.error || providers.error || models.error || reasoning.error),
      h('div',{className:'actions'},h('button',{className:'primary',disabled:action.busy || !!provider && (!name || reasoning.value===undefined)},fixer?'Save fixer model':'Save reviewer'),button('Cancel',onDone)))
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
          h('div',{className:'actions',key:target},h('span',null,({lead:'Originating lead',master:'Master Control',fixer:'PR Fixer',publish:'Auto-publish',origin_lead:'Originating PR lead',origin_published:'Lead sync notice'})[target]+' · '+status),
            row.deliveryErrors?.[target] && h('small',null,row.deliveryErrors[target]),
            ['failed','uncertain'].includes(status) && button('Retry delivery',()=>act('deliver',{id:row.id,target}),{disabled:action.busy}))))),
        problem(action.error || row.error || data.error || current.error),
        row.status==='failed' && h('div',null,button('Retry review',()=>act('retry',{id:row.id}),{disabled:action.busy})))
    }
    const shortStatus={
      queued:'Queued',reviewing:'In review',ready:'Approved',published:'Published',
      changes_requested:'Changes',needs_run:'Run needed',failed:'Failed',round_limit:'Round limit',
    }
    const reviewLink=row=>row.pull || row.repair
    const reviewPrNumber=row=>{
      const link=reviewLink(row)
      return typeof link==='string' ? link.match(/\/pull\/([1-9]\d*)$/)?.[1] : null
    }
    const reviewGroupKey=row=>reviewLink(row) || JSON.stringify([row.leadId,row.branch || row.id])
    const reviewTargetLabel=row=>{
      const num=reviewPrNumber(row)
      return num ? 'PR #'+num : row.branch || 'Commit '+row.head.slice(0,8)
    }
    const rowBadgeState=row=>row.repairPublished?'published':row.fixerState==='round_limit'?'round_limit':row.status
    function matchesReviewFilter(row,mode) {
      const badge=rowBadgeState(row)
      if(mode==='active') return badge==='queued' || badge==='reviewing'
      if(mode==='attention') return ['changes_requested','needs_run','failed','round_limit'].includes(badge)
      if(mode==='approved') return badge==='ready' || badge==='published'
      return true
    }
    function queueState(row, remote) {
      if (remote?.prState==='MERGED') return ['Merged','GitHub merged this PR.',4,'merged']
      if (remote?.prState==='CLOSED') return ['Closed','GitHub closed this PR.',4,'closed']
      if (row.fixerState==='round_limit') return ['Needs input','Repair round limit reached. Owner review needed.',0,'failed']
      if (remote?.ci==='failed') {
        const audit=remote.audit==='changed' ? 'The current revision needs a fresh audit.' :
          row.status==='ready' && remote.audit==='current' ? 'The auditor approved this revision.' : queueStatuses[row.status][1]
        return ['Needs input',audit,0,'ci_failed']
      }
      if (remote?.audit==='changed') return ['In review','The PR revision changed and needs a fresh audit.',3,'reviewing']
      if (row.status==='ready' && remote?.audit==='current') {
        if (remote.ci==='passed') return ['Ready for review','The audit and required checks passed for this revision.',2,'review_ready']
        if (remote.ci==='pending') return ['In review','The auditor approved this revision. Required checks are pending.',3,'reviewing']
      }
      if (row.repairPublished && !row.pull)
        return ['Published','Approved repair pushed to the PR branch.',2,'published']
      if (row.repair && !row.pull && row.status==='ready')
        return ['Repair approved','Master Control can publish this commit to the original PR.',2,'ready']
      return [...queueStatuses[row.status],row.status]
    }
    function CheckStatus({remote,unavailable}) {
      const label=remote?.connection==='unconfigured' ? 'Connect this repository in Settings → GitHub review status.' :
        ({passed:'Required checks satisfied',pending:'Required check pending',failed:'Required check failed',
          unverified:remote?.error || 'Required checks unverified'})[remote?.ci] ??
          (unavailable ? 'GitHub status unavailable' : 'Checking GitHub…')
      return h('p',{className:'mc-review-ci'},
        h('span',null,label),
        remote?.url && h('a',{href:remote.url,target:'_blank',rel:'noreferrer'},remote.check?.name || 'View checks'),
        remote?.audit==='changed' && h('span',null,'Current '+remote.head.slice(0,8)),
        remote?.draft && h('span',null,'Draft'))
    }
    function ReviewQueue({rpc,showReview}) {
      const [revision,refresh]=useReducer(n=>n+1,0)
      const [page,setPage]=useState(0)
      const [filter,setFilter]=useState('all')
      const pageSize=12
      const data=useData(rpc,'list',{},true,5000,revision)
      const rowPriority=row=>row.fixerState==='round_limit'?0:queueStatuses[row.status][2]
      const grouped=new Map()
      for(const row of data.value?.rows ?? []) {
        if(!Object.hasOwn(queueStatuses,row.status)) continue
        const key=reviewGroupKey(row)
        let entry=grouped.get(key)
        if(!entry) {entry={key,row,count:0}; grouped.set(key,entry)}
        entry.count++
      }
      const allGroups=[...grouped.values()].sort((first,second)=>rowPriority(first.row)-rowPriority(second.row))
      const counts={
        all:allGroups.length,
        attention:allGroups.filter(entry=>matchesReviewFilter(entry.row,'attention')).length,
        active:allGroups.filter(entry=>matchesReviewFilter(entry.row,'active')).length,
        approved:allGroups.filter(entry=>matchesReviewFilter(entry.row,'approved')).length,
      }
      const filtered=allGroups.filter(entry=>matchesReviewFilter(entry.row,filter))
      const lastPage=Math.floor(Math.max(0,filtered.length-1)/pageSize)
      const currentPage=Math.min(page,lastPage)
      const visible=filtered.slice(currentPage*pageSize,(currentPage+1)*pageSize)
      const ids=visible.filter(entry=>entry.row.pull).map(entry=>entry.row.id)
      const checks=useData(rpc,'snapshot',{ids},ids.length>0,15000,revision,githubChannel)
      const byId=new Map((checks.error ? [] : checks.value ?? []).map(status=>[status.id,status]))
      const cards=visible.map(entry=>({
        row:entry.row,count:entry.count,remote:byId.get(entry.row.id),status:queueState(entry.row,byId.get(entry.row.id)),
      })).sort((first,second)=>first.status[2]-second.status[2])
      const filterTabs=[
        ['all','All'],
        ['attention','Action'],
        ['active','Active'],
        ['approved','Approved'],
      ]
      return h('section',{className:'mc-roster mc-review-queue'},
        h('header',{className:'mc-heading'},
          h('div',null,h('h2',null,'Review queue'),
            data.value && h('span',{className:'mc-count'},counts.all+(counts.all===1?' review':' reviews'))),
          button('Refresh',refresh,{className:'mc-button','aria-label':'Refresh review queue'})),
        allGroups.length>0 && h('div',{className:'mc-review-filters',role:'group','aria-label':'Filter review queue'},
          filterTabs.map(([key,label])=>button(label+(counts[key]?' · '+counts[key]:''),()=>{setFilter(key);setPage(0)},{
            key,'aria-pressed':filter===key,
          }))),
        data.error && h('p',{className:'mc-roster-note mc-failure',role:'alert'},data.error),
        cards.length ? h('ul',{className:'mc-sessions'},cards.map(({row,count,remote,status})=>{
          const [label,reason,,kind]=status
          const link=reviewLink(row)
          const pull=typeof link==='string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/([1-9]\d*)$/.exec(link)
          const subParts=[row.leadTitle,row.head.slice(0,8),...(count>1?[count+' rounds']:row.repair && !row.pull?['Repair']:[])]
          const showReason=row.fixerState==='round_limit' || kind==='ci_failed' || kind==='failed' ||
            remote?.audit==='changed' || (row.repair && !row.pull && row.status==='ready' && !row.repairPublished)
          return h('li',{key:row.id,className:'mc-session mc-review-card',onClick:e=>{if(!e.target.closest('a,button')) showReview(row.id)}},
            h('div',{className:'mc-review-top'},
              pull ? h('a',{className:'mc-review-target',href:link,target:'_blank',rel:'noreferrer'},'PR #'+pull[1]) :
                h('span',{className:'mc-review-target'},reviewTargetLabel(row)),
              h('span',{className:'mc-status','data-status':kind},label)),
            h('span',{className:'mc-review-sub',title:subParts.join(' · ')},subParts.join(' · ')),
            button(row.goal,()=>showReview(row.id),{className:'mc-session-title mc-review-title',title:row.goal}),
            showReason && h('p',{className:'mc-review-reason'},reason),
            row.pull && pull && (!remote?.prState || remote.prState==='OPEN') && h(CheckStatus,{remote,unavailable:!!checks.error}))
        })) : !data.error && h('p',{className:'mc-roster-note',role:'status'},
          !data.value ? 'Loading reviews…' :
          allGroups.length>0 ? 'No reviews match this filter.' :
          'No reviews yet. Ask a lead to send its PR to Auto Auditor.'),
        lastPage>0 && h('div',{className:'mc-pages'},
          h('span',null,(currentPage*pageSize+1)+'–'+Math.min((currentPage+1)*pageSize,filtered.length)+' of '+filtered.length),
          h('div',null,button('Previous',()=>setPage(currentPage-1),{className:'mc-button',disabled:currentPage===0}),
            button('Next',()=>setPage(currentPage+1),{className:'mc-button',disabled:currentPage===lastPage}))))
    }
    function Panel({rpc,takeReview}) {
      const [revision,refresh]=useReducer(n=>n+1,0),[selected,select]=useState(()=>takeReview?.() ?? null),[view,setView]=useState('queue')
      const [filter,setFilter]=useState('all'),[grouped,setGrouped]=useState(true)
      const data=useData(rpc,'list',{},true,5000,revision)
      const last=React.useRef(null)
      if(data.value) last.current=data.value
      const state=data.value || last.current, rows=state?.rows || []
      const groups=React.useMemo(()=>{
        const map=new Map()
        for(const row of rows) {
          const key=reviewGroupKey(row)
          let group=map.get(key)
          if(!group) {group={key,latest:row,rows:[]}; map.set(key,group)}
          group.rows.push(row)
        }
        return [...map.values()]
      },[rows])
      const sourceEntries=grouped ? groups.map(group=>({row:group.latest,count:group.rows.length,group})) :
        rows.map(row=>({row,count:1,group:groups.find(g=>g.key===reviewGroupKey(row))}))
      const counts={
        all:sourceEntries.length,
        active:sourceEntries.filter(e=>matchesReviewFilter(e.row,'active')).length,
        attention:sourceEntries.filter(e=>matchesReviewFilter(e.row,'attention')).length,
        approved:sourceEntries.filter(e=>matchesReviewFilter(e.row,'approved')).length,
      }
      const visible=sourceEntries.filter(entry=>matchesReviewFilter(entry.row,filter))
      const item=rows.find(r=>r.id===selected) || visible[0]?.row || rows[0]
      const activeGroup=item ? groups.find(g=>g.key===reviewGroupKey(item)) : null
      function openItem(id){select(id);setView('queue')}
      const filterTabs=[
        ['all','All'],
        ['active','Active'],
        ['attention','Action'],
        ['approved','Approved'],
      ]
      return h('div',{className:'audit'},h('header',null,h('div',{className:'actions'},h('h1',null,'Auto Auditor'),
        state && !data.error && h('small',{className:'worker'},state.pending ? state.pending+' in queue' : 'Listening for PRs')),
        button('Reviewer model',()=>setView('settings'),{disabled:!state})),
        h('div',{className:'body'},h('nav',{className:'queue','aria-label':'Reviews'},
          h('div',{className:'queue-head'},
            h('h2',null,(grouped?'Pull requests':'Reviews')+(counts.all?' · '+counts.all:'')),
            rows.length>groups.length && button(grouped?'Show all ('+rows.length+')':'Group by PR',()=>setGrouped(!grouped),{className:'queue-mode'})),
          h('div',{className:'queue-filters',role:'group','aria-label':'Filter reviews'},
            filterTabs.map(([key,label])=>button(label+(counts[key]?' · '+counts[key]:''),()=>setFilter(key),{
              key,'aria-pressed':filter===key,
            }))),
          visible.length ? visible.map(({row,count,group})=>{
            const badge=rowBadgeState(row)
            const isCurrent=view==='queue' && (grouped ? activeGroup?.key===group.key : item?.id===row.id)
            const metaParts=[row.leadTitle,row.head.slice(0,8),...(grouped && count>1 ? [count+' rounds'] : row.repair && !row.pull ? ['Repair'] : [])]
            return button(h(React.Fragment,null,
              h('div',{className:'audit-row-top'},
                h('span',{className:'audit-row-title'},reviewTargetLabel(row)),
                h('span',{className:'audit-pill','data-state':badge},shortStatus[badge] || labels[row.status] || row.status)),
              h('span',{className:'audit-row-meta'},metaParts.join(' · ')),
              h('span',{className:'audit-row-goal',title:row.goal},row.goal)),
              ()=>openItem(row.id),{key:grouped?group.key:row.id,className:'item audit-row','aria-current':isCurrent})
          }) : rows.length>0 && h('p',{className:'empty',style:{padding:'0 .45rem',fontSize:'.8rem'}},'No reviews match this filter.')),
        h('section',{className:'detail','aria-label':'Review details'},problem(data.error),
          view==='settings' ? h(Settings,{rpc,model:state?.model,onDone:()=>{refresh();setView('queue')}}):
          item ? h(React.Fragment,null,
            activeGroup && activeGroup.rows.length>1 && (()=>{
              const recent=activeGroup.rows.slice(0,5)
              const older=activeGroup.rows.slice(5)
              const roundLabel=(round,idx)=>{
                const num=activeGroup.rows.length-idx
                const badge=rowBadgeState(round)
                return (idx===0?'Latest':'#'+num)+' · '+round.head.slice(0,7)+' · '+(shortStatus[badge] || round.status)
              }
              return h('div',{className:'audit-rounds',role:'group','aria-label':'Audit rounds'},
                h('small',null,'Rounds · '+activeGroup.rows.length),
                recent.map((round,idx)=>button(roundLabel(round,idx),()=>openItem(round.id),{key:round.id,'aria-pressed':round.id===item.id})),
                older.length>0 && h('select',{
                  'aria-label':'Earlier audit rounds',
                  value:older.some(r=>r.id===item.id)?item.id:'',
                  onChange:e=>{if(e.target.value) openItem(e.target.value)},
                },h('option',{value:''},older.length+' earlier…'),
                  older.map((round,i)=>h('option',{key:round.id,value:round.id},roundLabel(round,i+5)))))
            })(),
            h(Detail,{key:item.id,rpc,item,revision,refresh,select:openItem})):
          h('div',{className:'stack'},h('h2',null,state?'No reviews yet':'Loading reviews…'),
            state && h('p',{className:'empty'},'In a lead chat, say “Send this PR to Auto Auditor” and include the PR link. Findings and replies appear here and in that chat.')))))
    }
    function Icon({rpc,size=18}) {
      const count=useData(rpc,'count',{},true,12000).value
      return h('span',{className:'audit-icon'},h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.65,'aria-hidden':true},
        h('path',{d:'M6 3.75h10l2.5 2.5v13.5H6zM9 9h6m-6 4 2 2 4-4',strokeLinecap:'round',strokeLinejoin:'round'})),
        count>0 && h('small',{'aria-label':count+' pending reviews'},count))
    }
    const repairLabels={
      available:'Ready to start',preparing:'Preparing worktree',handoff_failed:'Handoff needs attention',sent:'Handoff sent',
      queued:'Repair queued for audit',reviewing:'Repair in audit',ready:'Repair approved',
      changes_requested:'More changes requested',needs_run:'Run requested',failed:'Repair audit failed',
      round_limit:'Needs owner · round limit',published:'Published to PR',superseded:'Newer audit available',
    }
    function FixerChat({sessionId,sessions,SessionProvider,renderFactorySlot}) {
      const [bound,setBound]=useState(null),[error,setError]=useState('')
      useEffect(()=>{
        let active=true,reference
        async function retain() {
          await sessions.refresh()
          if(!active) return
          reference=sessions.retain(sessionId,{source:'desktopPrFixer'})
          await reference.ready
          if(active)setBound(reference)
        }
        retain().catch(err=>{if(active)setError(err.message)})
        return ()=>{active=false;reference?.release()}
      },[sessions,sessionId])
      return h('div',{className:'fixer-chat'},bound ? h(SessionProvider,{session:bound},
        renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false})) :
        problem(error) || h('p',{role:'status',className:'detail'},'Opening the repair chat…'))
    }
    function FixerPage({rpc,sessions,SessionProvider,renderFactorySlot}) {
      const [revision,refresh]=useReducer(n=>n+1,0)
      const [selected,select]=useState(null),[open,setOpen]=useState(null),[settings,setSettings]=useState(false)
      useEffect(()=>{
        function openBySession(sessionId) {
          if (typeof sessionId!=='string' || !sessionId.startsWith('desktop-pr-fixer-')) return
          const id=sessionId.slice('desktop-pr-fixer-'.length)
          select(id)
          setOpen({id,sessionId})
          setSettings(false)
        }
        if (window.__dshPrFixerPending) {
          const pending=window.__dshPrFixerPending
          window.__dshPrFixerPending=undefined
          openBySession(pending)
        }
        const listener=event=>openBySession(event.detail?.sessionId)
        window.addEventListener('dsh-pr-fixer:open',listener)
        return ()=>window.removeEventListener('dsh-pr-fixer:open',listener)
      },[])
      const data=useData(rpc,'fixer-list',{},true,5000,revision)
      const action=useAction()
      const last=React.useRef(null)
      if(data.value) last.current=data.value
      const state=data.value || last.current
      const rows=state?.rows ?? []
      const item=rows.find(row=>row.id===selected) || rows[0]
      function show(row) {select(row.id);setOpen(null);setSettings(false)}
      function toggle() {action.run(async()=>{
        await call(rpc,'fixer-autowake',{enabled:!state.automaticWake})
        refresh()
      })}
      function togglePublish() {action.run(async()=>{
        await call(rpc,'fixer-autopublish',{enabled:!state.autoPublish})
        refresh()
      })}
      function start() {action.run(async()=>{
        const id=item.id
        const job=await call(rpc,'fixer-start',{id})
        select(id)
        setOpen({id,sessionId:job.sessionId})
        refresh()
      })}
      const chat=open && open.id===item?.id && open.sessionId
      const fixerModelLabel=state?.model?.model ?
        'Fixer model · '+state.model.model+(state.model.reasoningEffort?' · '+state.model.reasoningEffort:'') : 'Fixer model'
      return h('div',{className:'audit dsh-pr-fixer'},
        h('header',null,h('h1',null,'PR Fixer'),h('div',{className:'actions'},
          button('Automatic wake',toggle,{disabled:!state || action.busy,'aria-pressed':state?.automaticWake===true,
            title:'Wake PR Fixer when Auto Auditor requests changes'}),
          button('Auto-publish',togglePublish,{disabled:!state || action.busy,'aria-pressed':state?.autoPublish===true,
            title:'Automatically push approved repairs to the original PR branch'}),
          button(fixerModelLabel,()=>setSettings(!settings),
            {disabled:!state,'aria-expanded':settings}))),
        h('div',{className:'body'},
          h('nav',{className:'queue','aria-label':'Repair inbox'},
            h('h2',null,'Repair inbox'+(rows.length?' · '+rows.length:'')),
            rows.map(row=>button(h(React.Fragment,null,h('strong',null,'PR #'+row.number+' · '+row.lead),
              h('small',null,repairLabels[row.status] || row.status)),
              ()=>show(row),{key:row.id,className:'item','aria-current':item?.id===row.id}))),
          h('div',{className:'fixer-content'},
            (data.error || action.error) && h('div',{className:'fixer-controls'},problem(action.error || data.error)),
            settings ? h('div',{className:'detail'},h(Settings,{rpc,model:state.model,fixer:true,
              onDone:()=>{setSettings(false);refresh()}})) :
            chat ? h(React.Fragment,null,
              h('div',{className:'actions fixer-controls'},
                h('a',{href:item.url,target:'_blank',rel:'noreferrer'},'PR #'+item.number),
                button('View findings',()=>setOpen(null))),
              h(FixerChat,{key:chat,sessionId:chat,sessions,SessionProvider,renderFactorySlot})) :
            h('section',{className:'detail fixer-work','aria-label':'Repair work order'},
              item ? h('div',{className:'stack'},
                h('div',{className:'actions'},h('a',{href:item.url,target:'_blank',rel:'noreferrer'},'PR #'+item.number),
                  h('small',{role:'status'},repairLabels[item.status] || item.status),
                  item.rounds>0 && h('small',null,'Round '+item.rounds+'/'+item.maxRounds)),
                h('h2',null,item.goal),
                h('div',null,h('h3',null,'Starting commit'),h('code',{className:'fixer-revision'},item.head)),
                h('div',null,h('h3',null,'Auto Auditor findings'),h('ul',null,item.findings.map((finding,index)=>h('li',{key:index},finding)))),
                item.evidence && h('details',null,h('summary',null,'Evidence from '+item.lead),h('p',{className:'long'},item.evidence)),
                problem(item.error),
                item.sessionId ? h('div',null,button('Open repair chat',()=>setOpen({id:item.id,sessionId:item.sessionId}))) :
                  item.startable && h('div',null,button(action.busy?'Starting…':item.error?'Retry handoff':'Start repair',
                    start,{className:'primary',disabled:action.busy}))) :
                h('p',{className:'empty',role:'status'},state?'PRs with changes requested by Auto Auditor appear here.':'Loading repair inbox…')))))
    }
    function FixerIcon() {
      return h('svg',{width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6,
        strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:'M5 7l4 5-4 5m8 0h6M14 7h5'}))
    }
    return {inject:['slots','connection','layout','sessions'],apply(ctx){
      ctx.effect(()=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);return ()=>style.remove()},'Auto Auditor styles')
      ctx.inject(['workspaces'],scope=>{
        scope.effect(()=>{
          const sessions=scope.get('sessions')
          const workspaces=scope.get('workspaces')
          function syncUngrouped() {
            const list=sessions?.list?.getSnapshot?.()
            if (!list?.ids) return
            const ws=workspaces?.list?.getSnapshot?.()
            const grouped=new Set((ws?.items ?? []).flatMap(item=>item.sessionIds ?? []))
            const archived=new Set(ws?.archivedSessionIds ?? [])
            const hasOrdinaryUngrouped=list.ids.some(sid=>{
              if (sid.startsWith('desktop-pr-fixer-') || sid.startsWith('desktop-master-control-')) return false
              if (grouped.has(sid) || archived.has(sid)) return false
              const row=list.byId?.[sid]
              return Boolean(row && row.origin!=='subagent' && !row.blank)
            })
            document.documentElement.classList.toggle('dsh-pr-fixer-hide-ungrouped',!hasOrdinaryUngrouped)
          }
          syncUngrouped()
          const stopSessions=sessions?.list?.subscribe?.(syncUngrouped)
          const stopWorkspaces=workspaces?.list?.subscribe?.(syncUngrouped)
          return ()=>{
            stopSessions?.()
            stopWorkspaces?.()
            document.documentElement.classList.remove('dsh-pr-fixer-hide-ungrouped')
          }
        },'PR Fixer sidebar filter')
      })
      const inject=()=>({rpc:ctx.get('connection').rpc})
      let requestedReview
      function takeReview() {
        const review=requestedReview
        requestedReview=undefined
        return review
      }
      function showReview(reviewId) {
        requestedReview=reviewId
        ctx.get('layout').selectPanel(id)
      }
      // The running renderer can retain the old client registration until its next launch.
      ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:id,priority:-10,inject:()=>({...inject(),takeReview})},Panel))
      ctx.slots.inject('desktop-master-control.review-queue',()=>ctx.slots.register({
        name:'desktop-master-control.review-queue',inject:()=>({...inject(),showReview}),
      },ReviewQueue))
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id,priority:-10,order:-19,label:()=> 'Auto Auditor',inject},Icon))
      ctx.slots.inject('main',()=>ctx.slots.register({
        name:'main',key:fixerId,priority:-10,children:{'desktop-pr-fixer.private-binding':{kind:'single',scope:'session-maybe'}},
        inject:()=>({...inject(),sessions:ctx.get('sessions')}),
      },FixerPage))
      ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({
        name:'sidebar.panellist',id:fixerId,priority:-10,order:-18,label:()=> 'PR Fixer',
      },FixerIcon))
    }}
  },
})
