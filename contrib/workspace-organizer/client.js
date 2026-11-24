window.__ModuleLoader__.load({
  id:'dsh-workspace-organizer',
  factory:require=>{
    const React=require('react')
    const h=React.createElement
    const {useEffect,useRef,useState,useSyncExternalStore}=React
    const channel='/desktop-workspace-organizer'
    const css=`
      [data-dsh-partition-group] {display:flex;flex-direction:column;reading-flow:flex-visual}
      [data-dsh-partition-group] > [data-dsh-partition-order] {order:var(--dsh-partition-order)}
      [data-dsh-partition-hidden] {display:none !important}
      .dsh-partition-heading {display:flex;align-items:center;gap:.45rem;min-height:30px;max-width:100%;box-sizing:border-box;cursor:pointer;background:transparent;border:0;border-radius:6px;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:.84rem;padding:3px 10px 3px calc(17px + var(--dsh-workspace-indent,0px));text-align:start}
      .dsh-partition-heading:hover {background:var(--dsw-alias-interactive-bg-hover,#8882)}
      .dsh-partition-heading:focus-visible,.dsh-organizer :is(button,input):focus-visible {outline:2px solid var(--dsw-focus-ring-color,#8aaffc);outline-offset:-2px}
      .dsh-partition-heading .caption {min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .dsh-partition-heading .chevron {width:6px;height:6px;border:solid currentColor;border-width:0 1px 1px 0;transform:rotate(-45deg)}
      .dsh-partition-heading[aria-expanded=true] .chevron {transform:rotate(45deg)}
      .dsh-partition-heading .count {margin-inline-start:auto;color:var(--dsw-alias-label-tertiary,inherit);font-size:.76rem}
      .dsh-organizer {color:var(--dsw-alias-label-primary,inherit);font:inherit}
      .dsh-organizer h2 {margin:0 0 .7rem;font-size:1.13rem;font-weight:550}
      .dsh-organizer p {margin:.6rem 0;line-height:1.45}.dsh-organizer small {color:var(--dsw-alias-label-secondary,inherit)}
      .dsh-organizer :is(button,input) {font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l3,#8887);border-radius:7px;padding:.44rem .65rem}
      .dsh-organizer button:enabled {cursor:pointer}.dsh-organizer button:enabled:hover {background:var(--dsw-alias-interactive-bg-hover-solid,#8883)}.dsh-organizer button:disabled {opacity:.5}
      .dsh-organizer .actions,.dsh-organizer .account {display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
      .dsh-organizer .account {padding:.65rem 0;border-bottom:1px solid var(--dsw-alias-border-l2,#8885);justify-content:space-between}
      .dsh-organizer .name {display:grid;gap:.2rem;overflow-wrap:anywhere}
      .dsh-organizer form {display:grid;gap:.7rem;margin:.75rem 0}.dsh-organizer label {display:grid;gap:.3rem}
      .dsh-organizer input {width:100%;min-width:0;box-sizing:border-box}
      dialog.dsh-organizer {background:var(--dsw-alias-bg-layer-2,#24262b);border:1px solid var(--dsw-alias-border-l3,#8887);border-radius:12px;padding:1.1rem;width:min(29rem,calc(100vw - 2rem));box-sizing:border-box;max-height:80vh}
      dialog.dsh-organizer::backdrop {background:#0008}
      .dsh-organizer .error {color:var(--color-danger,#cf786c)}
    `
    const button=(text,onClick,props={})=>h('button',{type:'button',onClick,...props},text)
    const errorText=text=>text && h('p',{role:'alert',className:'error'},text)
    function store(initial) {
      let current=initial
      const listeners=new Set()
      return {getSnapshot:()=>current,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn)},
        set(value){current=value;for(const fn of listeners) fn()}}
    }
    async function call(rpc,method,args={}) {
      const reply=await rpc.call(channel,method,args)
      if(!reply.ok) throw new Error(reply.error.message)
      return reply.value
    }
    function row(node) {
      return node.matches('[data-row-key]') ? node : node.querySelector('[data-row-key]')
    }
    function place(node,order,hidden=false) {
      node.dataset.dshPartitionOrder=''
      node.style.setProperty('--dsh-partition-order',String(order))
      node.toggleAttribute('data-dsh-partition-hidden',hidden)
    }
    function restore(node) {
      node.removeAttribute('data-dsh-partition-order')
      node.removeAttribute('data-dsh-partition-hidden')
      node.style.removeProperty('--dsh-partition-order')
    }

    // Keep the native session row nodes and handlers. The partition markers
    // are sibling controls, and visual ordering is confined to a workspace group.
    function renderGroups(state,registry,edit,showError) {
      const sidebar=document.querySelector('[data-sidebar-scrollport]')
      if(!sidebar) return
      const snapshot=registry.getSnapshot()
      for(const header of sidebar.querySelectorAll('[data-row-key^="workspace:"][role="treeitem"]')) {
        const workspaceId=header.dataset.rowKey.slice('workspace:'.length)
        const workspace=snapshot.items.find(item=>item.workspaceId===workspaceId)
        if(!workspace) continue
        // The native hover card wraps the header and each session separately.
        const parent=header.closest('[style*="--dsh-workspace-indent"]')
        if(!parent) continue
        const native=[...parent.children].filter(node=>!node.classList.contains('dsh-partition-heading'))
        const direct=native.filter(node=>row(node)?.dataset.rowKey.startsWith('session:'))
        const partitions=header.getAttribute('aria-expanded')==='true' ?
          state?.workspaces.find(item=>item.id===workspaceId)?.partitions ?? [] : []
        const headers=new Map([...parent.children].filter(node=>node.classList.contains('dsh-partition-heading'))
          .map(node=>[node.dataset.partitionId,node]))
        const oldGrouping=parent.hasAttribute('data-dsh-partition-group')
        if(!partitions.length && !oldGrouping) continue
        parent.toggleAttribute('data-dsh-partition-group',!!partitions.length)
        if(!partitions.length) {
          for(const node of native) restore(node)
          for(const node of headers.values()) node.remove()
          continue
        }
        const members=new Set(workspace.sessionIds)
        const assignments=new Map()
        for(const [index,partition] of partitions.entries()) {
          const order=index*2+1
          for(const id of partition.sessions) if(members.has(id)) assignments.set(id,{partition,order})
          let marker=headers.get(partition.id)
          if(!marker) {
            marker=document.createElement('button')
            marker.type='button'
            marker.className='dsh-partition-heading'
            marker.dataset.partitionId=partition.id
            for(const part of ['chevron','caption','count']) {
              const span=document.createElement('span')
              span.className=part
              if(part!=='caption') span.setAttribute('aria-hidden','true')
              marker.append(span)
            }
            parent.append(marker)
          }
          headers.delete(partition.id)
          const count=String(partition.sessions.filter(id=>members.has(id) && !snapshot.archivedSessionIds.includes(id)).length)
          if(marker.children[1].textContent!==partition.name) marker.children[1].textContent=partition.name
          if(marker.children[2].textContent!==count) marker.children[2].textContent=count
          marker.setAttribute('aria-expanded',String(!partition.collapsed))
          marker.onclick=()=>{void edit('collapse',{workspaceId,partitionId:partition.id,collapsed:!partition.collapsed}).catch(showError)}
          place(marker,order)
        }
        for(const stale of headers.values()) stale.remove()
        const unassigned=partitions.length*2+1
        for(const node of direct) {
          const id=row(node).dataset.rowKey.slice('session:'.length)
          const entry=assignments.get(id)
          place(node,entry?entry.order+1:unassigned,!!entry?.partition.collapsed)
        }
        for(const node of native.filter(node=>node.dataset.rowKey?.startsWith('overflow:'))) place(node,unassigned+1)
      }
    }
    function Dialog({request,close,edit}) {
      const dialog=useRef(null)
      const [name,setName]=useState(request.name ?? '')
      const [error,setError]=useState(request.error ?? '')
      const [busy,setBusy]=useState(false)
      useEffect(()=>{
        dialog.current?.showModal()
        return ()=>{if(dialog.current?.open) dialog.current.close()}
      },[])
      async function save(event) {
        event.preventDefault()
        setBusy(true);setError('')
        try {await edit(request.action,{...request.args,name});close()}
        catch(err){setError(err.message);setBusy(false)}
      }
      const deletion=request.action==='delete'
      return h('dialog',{ref:dialog,className:'dsh-organizer',onCancel:e=>{e.preventDefault();if(!busy)close()},'aria-label':request.title},
        h('h2',null,request.title),request.action ? h('form',{onSubmit:save},
          deletion ? h('p',null,'Chats in this partition will return to the workspace list.') :
            h('label',null,'Partition name',h('input',{autoFocus:true,required:true,maxLength:48,value:name,onChange:e=>setName(e.target.value)})),
          errorText(error),h('div',{className:'actions'},h('button',{disabled:busy || (!deletion && !name.trim())},
            busy?'Saving…':deletion?'Remove partition':'Save'),button('Cancel',close,{disabled:busy}))) :
          h(React.Fragment,null,errorText(error),button('Close',close)))
    }

    function GoAccounts({rpc}) {
      const [rows,setRows]=useState(null),[form,setForm]=useState(null)
      const [name,setName]=useState(''),[key,setKey]=useState('')
      const [busy,setBusy]=useState(false),[error,setError]=useState('')
      useEffect(()=>{
        let active=true
        call(rpc,'go-list').then(value=>{if(active)setRows(value)},err=>{if(active)setError(err.message)})
        return ()=>{active=false}
      },[rpc])
      function begin(account) {setForm(account || {});setName(account?.name || '');setKey('');setError('')}
      function cancel(){setForm(null);setKey('');setError('')}
      async function save(event) {
        event.preventDefault()
        if(busy)return
        setBusy(true);setError('')
        try {
          setRows(await call(rpc,form.id?'go-rename':'go-add',form.id?{id:form.id,name}:{name,key}))
          cancel()
        }catch(err){setError(err.message)}
        finally{setBusy(false)}
      }
      return h('section',{className:'dsh-organizer','aria-label':'OpenCode Go accounts'},
        h('h2',null,'OpenCode Go accounts'),
        h('p',null,'Add a key for each account, then pick a model under that account’s name in chat.'),
        rows?.map(account=>h('div',{className:'account',key:account.id},
          h('div',{className:'name'},h('strong',null,account.name),h('small',null,account.configured?account.models+' models':'API key unavailable')),
          button('Rename',()=>begin(account),{'aria-label':'Rename '+account.name,disabled:busy}))),
        !rows && !error && h('p',{role:'status'},'Loading accounts…'),
        form ? h('form',{onSubmit:save},
          h('label',null,'Account name',h('input',{autoFocus:true,maxLength:48,required:true,value:name,onChange:e=>setName(e.target.value)})),
          !form.id && h('label',null,'OpenCode Go API key',h('input',{type:'password',autoComplete:'off',spellCheck:false,
            maxLength:2048,required:true,value:key,onChange:e=>setKey(e.target.value)})),
          h('div',{className:'actions'},h('button',{disabled:busy || !name.trim() || (!form.id && !key.trim())},
            busy?'Saving…':form.id?'Save name':'Connect account'),button('Cancel',cancel,{disabled:busy}))) :
          button('Add OpenCode Go account',()=>begin(null),{disabled:!rows}),
        errorText(error))
    }
    return {inject:['slots','connection','contextMenus','workspaces'],apply(ctx){
      const rpc=ctx.get('connection').rpc
      const registry=ctx.get('workspaces').list
      const folders=store(null),dialog=store(null)
      let disposed=false
      function update(state) {
        if(disposed || state.revision<(folders.getSnapshot()?.revision ?? -1)) return
        if(state.revision!==folders.getSnapshot()?.revision) folders.set(state)
      }
      async function edit(action,args) {update(await call(rpc,action,args))}
      const showError=err=>dialog.set({title:'Workspace partition',error:err.message})
      const open=(action,title,args,name)=>dialog.set({action,title,args,name})
      const group=id=>folders.getSnapshot()?.workspaces.find(workspace=>workspace.id===id)?.partitions ?? []
      const toolbar=ctx.get('contextMenus')
      ctx.effect(()=>toolbar.register({
        id:'workspace.partitions',target:'workspace',order:315,
        observe:()=>[folders],
        resolve({workspaceId}){
          if(!folders.getSnapshot()) return []
          const items=group(workspaceId)
          return [
            {id:'create',label:'New partition…',run:()=>open('create','New partition',{workspaceId})},
            ...(items.length?[{id:'manage',label:'Manage partitions',children:items.map(item=>({
              id:item.id,label:item.name,children:[
                {id:'rename-'+item.id,label:'Rename…',run:()=>open('rename','Rename partition',{workspaceId,partitionId:item.id},item.name)},
                {id:'delete-'+item.id,label:'Remove…',run:()=>open('delete','Remove '+item.name,{workspaceId,partitionId:item.id})},
              ],
            }))}]:[]),
          ]
        },
      }),'Workspace partition actions')
      ctx.effect(()=>toolbar.register({
        id:'session.partitions',target:'session',order:365,
        observe:()=>[folders,registry],
        resolve({sessionId}){
          if(!folders.getSnapshot()) return []
          const state=registry.getSnapshot()
          if(state.archivedSessionIds.includes(sessionId)) return []
          const workspace=state.items.find(item=>item.sessionIds.includes(sessionId))
          if(!workspace) return []
          const workspaceId=workspace.workspaceId
          const items=group(workspaceId)
          const current=items.find(item=>item.sessions.includes(sessionId))
          const move=partitionId=>edit('move',{workspaceId,sessionId,partitionId})
          return [{id:'move',label:'Move to partition',children:[
            ...items.map(item=>({id:item.id,label:item.name,disabled:current===item,run:()=>move(item.id)})),
            ...(current?[{id:'unassign',label:'Outside partitions',run:()=>move(null)}]:[]),
            {id:'create',label:'New partition…',run:()=>open('create','New partition',{workspaceId,sessionId})},
          ]}]
        },
      }),'Session partition actions')
      ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'workspace-partition-dialog'},function PartitionOverlay(){
        const request=useSyncExternalStore(dialog.subscribe,dialog.getSnapshot)
        return request ? h(Dialog,{request,close:()=>dialog.set(null),edit,key:request.action+(request.args?.partitionId ?? '')}) : null
      }))
      ctx.slots.inject('settings.section',()=>ctx.slots.register({
        name:'settings.section',id:'opencode-go-accounts',order:12,label:()=> 'OpenCode Go accounts',inject:()=>({rpc}),
      },GoAccounts))
      ctx.effect(()=>{
        const style=document.createElement('style')
        style.textContent=css
        document.head.append(style)
        let frame=0
        const repaint=()=>{
          if(!frame) frame=requestAnimationFrame(()=>{
            frame=0
            renderGroups(folders.getSnapshot(),registry,edit,showError)
          })
        }
        const observer=new MutationObserver(mutations=>{
          if(mutations.some(({target,addedNodes})=>target instanceof Element &&
              !target.closest('.dsh-partition-heading') &&
              (target.closest('[data-sidebar-scrollport]') ||
               [...addedNodes].some(node=>node instanceof Element &&
                 (node.matches('[data-sidebar-scrollport]') || node.querySelector('[data-sidebar-scrollport]')))))) repaint()
        })
        observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-expanded','data-row-key']})
        const unsubscribe=[folders.subscribe(repaint),registry.subscribe(repaint)]
        let timer
        async function refresh() {
          try {update(await call(rpc,'partitions'))}catch{}
          if(!disposed) timer=setTimeout(refresh,8000)
        }
        void refresh()
        return ()=>{
          disposed=true
          clearTimeout(timer)
          cancelAnimationFrame(frame)
          observer.disconnect()
          for(const dispose of unsubscribe) dispose()
          for(const node of document.querySelectorAll('[data-dsh-partition-order]')) restore(node)
          for(const node of document.querySelectorAll('[data-dsh-partition-group]')) node.removeAttribute('data-dsh-partition-group')
          for(const node of document.querySelectorAll('.dsh-partition-heading')) node.remove()
          style.remove()
        }
      },'Workspace partition presentation')
    }}
  },
})
