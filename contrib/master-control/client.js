window.__ModuleLoader__.load({
  id:'dsh-master-control',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const id = 'desktop-master-control'
    const channel = '/desktop-master-control'
    // An open conversation may keep the previous preset revision's client
    // loaded through hot replacement. The current panel owns the shared seats.
    const seatPriority = -10
    const appearance = `
      html:root body {
        --dsh-ui-canvas:#fbfcfe;
        --dsh-ui-rail:#f0f3f8;
        --dsh-ui-surface:#f5f7fb;
        --dsh-ui-raised:#fff;
        --dsh-ui-overlay:#e8edf5;
        --dsh-ui-ink:#1d2534;
        --dsh-ui-muted:#4e5b70;
        --dsh-ui-tertiary:#5f6c82;
        --dsh-ui-accent:#435fa8;
        --dsh-ui-button:#3c56a0;
        --dsh-ui-button-hover:#304885;
        --dsh-ui-on-button:#fff;
        --dsh-ui-line:rgb(37 53 81 / 12%);
        --dsh-ui-strong-line:rgb(37 53 81 / 23%);
        --dsh-ui-selection:#e3eaf7;
        --dsh-ui-scroll:#bbc7da;
        --dsh-ui-scroll-hover:#899ab8;

        --dsw-alias-bg-base:var(--dsh-ui-canvas);
        --dsw-alias-bg-document-preview:var(--dsh-ui-canvas);
        --dsw-alias-bg-layer-1:var(--dsh-ui-surface);
        --dsw-alias-bg-layer-2:var(--dsh-ui-raised);
        --dsw-alias-bg-layer-3:var(--dsh-ui-overlay);
        --dsw-alias-bg-module-platform:var(--dsh-ui-overlay);
        --dsw-alias-bg-overlay:var(--dsh-ui-overlay);
        --dsw-alias-card-fill:var(--dsh-ui-surface);
        --dsw-alias-card-fill-hover:var(--dsh-ui-overlay);
        --dsw-alias-label-primary:var(--dsh-ui-ink);
        --dsw-alias-label-primary-bluish:var(--dsh-ui-ink);
        --dsw-alias-label-secondary:var(--dsh-ui-muted);
        --dsw-alias-label-tertiary:var(--dsh-ui-tertiary);
        --dsw-alias-label-caption:var(--dsh-ui-tertiary);
        --dsw-alias-label-on-color:var(--dsh-ui-on-button);
        --dsw-alias-border-l1:color-mix(in srgb,var(--dsh-ui-line) 66%,transparent);
        --dsw-alias-border-l2:var(--dsh-ui-line);
        --dsw-alias-border-l3:var(--dsh-ui-line);
        --dsw-alias-border-l4:var(--dsh-ui-strong-line);
        --dsw-alias-interactive-bg-hover:color-mix(in srgb,var(--dsh-ui-ink) 7%,transparent);
        --dsw-alias-interactive-bg-hover-solid:var(--dsh-ui-overlay);
        --dsw-alias-interactive-bg-active:var(--dsh-ui-selection);
        --dsw-alias-button-info-fill:var(--dsh-ui-button);
        --dsw-alias-button-info-hover:var(--dsh-ui-button-hover);
        --dsw-alias-link:var(--dsh-ui-accent);
        --dsw-focus-ring-color:var(--dsh-ui-accent);
        --dsw-alias-scrollbar-bg-l1:var(--dsh-ui-scroll);
        --dsw-alias-scrollbar-bg-l2:var(--dsh-ui-scroll);
        --dsw-alias-scrollbar-hover-l1:var(--dsh-ui-scroll-hover);
        --dsw-alias-scrollbar-hover-l2:var(--dsh-ui-scroll-hover);
        --dsw-specific-sidebar-fill:var(--dsh-ui-rail);
        --dsw-specific-sidebar-nav-item-active:var(--dsh-ui-selection);
        --dsw-specific-sidebar-nav-item-active-accent:var(--dsh-ui-selection);
        --dsw-specific-sidebar-nav-item-hover:var(--dsw-alias-interactive-bg-hover);
        --dsw-specific-input-major:var(--dsh-ui-raised);
        --dsw-menu-surface-fill:var(--dsh-ui-raised);
        --dsw-alias-hovercard-bg:var(--dsh-ui-raised);
        --dsw-alias-settings-card-fill:var(--dsh-ui-surface);
        --dsw-alias-settings-card-stroke:var(--dsh-ui-line);
        --dsw-radius-sm:6px;
        --dsw-radius-md:9px;
        --dsw-radius-lg:12px;
        --dsw-radius-panel:18px;
      }
      html:root body[data-ds-dark-theme] {
        --dsh-ui-canvas:#15171c;
        --dsh-ui-rail:#1b1e25;
        --dsh-ui-surface:#1d2027;
        --dsh-ui-raised:#232730;
        --dsh-ui-overlay:#2b303b;
        --dsh-ui-ink:#edf0f6;
        --dsh-ui-muted:#b2bbca;
        --dsh-ui-tertiary:#98a5ba;
        --dsh-ui-accent:#acbaff;
        --dsh-ui-button:#5068b5;
        --dsh-ui-button-hover:#5b73c2;
        --dsh-ui-on-button:#fff;
        --dsh-ui-line:rgb(218 228 251 / 12%);
        --dsh-ui-strong-line:rgb(218 228 251 / 24%);
        --dsh-ui-selection:#2a3145;
        --dsh-ui-scroll:#495365;
        --dsh-ui-scroll-hover:#68758e;
      }

      [data-sidebar-scrollport] nav button[aria-current="page"],
      [data-row-key^="session:"][aria-selected="true"],
      [data-shortcut-modal="settings"] nav button[aria-current="true"] {
        color:var(--dsh-ui-ink);
        background-color:var(--dsh-ui-selection);
        box-shadow:inset 2px 0 var(--dsh-ui-accent);
      }
      :dir(rtl) :is([data-sidebar-scrollport] nav button[aria-current="page"],
        [data-row-key^="session:"][aria-selected="true"],
        [data-shortcut-modal="settings"] nav button[aria-current="true"]) {
        box-shadow:inset -2px 0 var(--dsh-ui-accent);
      }
      [data-window-drag]:has(> [data-conversation-header-leading]) {
        border-bottom-color:var(--dsh-ui-line);
        background:var(--dsh-ui-canvas);
      }
      [data-conversation-header-leading] { letter-spacing:-.012em }
      [data-message-bubble] {
        background:color-mix(in srgb,var(--dsh-ui-raised) 93%,var(--dsh-ui-accent));
        border-radius:var(--dsw-radius-lg);
      }
      [data-composer-card]:focus-within {
        --dsw-elevation-stroke-color:color-mix(in srgb,var(--dsh-ui-accent) 42%,transparent);
      }
      [data-composer-dock] { font-variant-numeric:tabular-nums }
      [data-shortcut-modal="settings"] > nav { background:var(--dsh-ui-surface) }
      [data-shortcut-modal="settings"] [data-slot="settings.section"] :is(h1,h2),
      [data-plugin-header-part="title"], [data-testid="task-manager-page"] h1 {
        font-weight:620;
        letter-spacing:-.03em;
      }
      .dsh-accounts .account-row { border-bottom-color:var(--dsh-ui-line) }
      .dsh-accounts button, .dsh-accounts input { border-color:var(--dsh-ui-strong-line) }
      .dsh-accounts button:enabled:hover { background:var(--dsw-alias-interactive-bg-hover) }
      [data-plugin-panel] :is([data-plugin-package],[data-plugin-item]):not([data-plugin-highlight]) {
        background:var(--dsh-ui-surface);
        border-color:var(--dsh-ui-line);
        border-radius:var(--dsw-radius-lg);
      }
      [data-plugin-panel] :is([data-plugin-package],[data-plugin-item]):not([data-plugin-highlight]):hover {
        background:var(--dsh-ui-raised);
        border-color:var(--dsh-ui-strong-line);
      }
      [data-testid="task-manager-page"] ul[aria-busy] > li > button[aria-expanded="true"] {
        background:var(--dsh-ui-selection);
      }
    `
    const css = `
      [data-row-key^="session:desktop-master-control-"] { display:none !important }
      .dsh-control-shell {
        --mc-base:var(--dsw-alias-bg-base,#161619);
        --mc-ink:var(--dsw-alias-label-primary,#f2f2f6);
        --mc-muted:var(--dsw-alias-label-secondary,#aeb0ba);
        --mc-accent:var(--dsh-ui-accent,var(--dsw-alias-label-primary-bluish,#aabaff));
        --mc-line:color-mix(in srgb,var(--mc-ink) 12%,transparent);
        --mc-hover:color-mix(in srgb,var(--mc-ink) 7%,transparent);
        --mc-rail:color-mix(in srgb,var(--mc-base) 97%,var(--mc-accent));
        --mc-card:color-mix(in srgb,var(--mc-rail) 96%,var(--mc-ink));
        flex:1 1 0; min-height:0; min-width:0; display:flex; flex-direction:column; container-type:inline-size;
        color:var(--mc-ink); background:var(--mc-base)
      }
      .dsh-control-bar { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap;
        gap:.6rem; min-height:3.4rem; box-sizing:border-box; padding:.65rem clamp(.8rem,2cqi,1.4rem);
        border-bottom:1px solid var(--mc-line) }
      .dsh-control-brand { display:flex; align-items:center; gap:.7rem }
      .dsh-control-mark { display:inline-grid; place-items:center; width:1.3rem; color:var(--mc-accent) }
      .dsh-control-bar h1 { font-size:1.05rem; line-height:1.3; font-weight:625; letter-spacing:-.025em; margin:0 }
      .dsh-control-grid { flex:1 1 0; min-height:0; display:grid; grid-template-rows:minmax(0,1fr);
        grid-template-columns:minmax(0,1fr) }
      .dsh-control-grid[data-view]:not([data-view="chat"]) { grid-template-columns:minmax(0,1fr) clamp(17rem,35%,26rem) }
      .dsh-control-chat { display:flex; flex-direction:column; min-height:0; min-width:0; overflow:hidden }
      .dsh-control-chat [data-slot="conversation.input.permission"],
      .dsh-control-chat [data-slot="conversation.hero.agentPreset"] { display:none !important }
      .dsh-control-scroll { min-height:0; min-width:0; overflow-y:auto; overscroll-behavior-y:contain;
        border-left:1px solid var(--mc-line); background:var(--mc-rail); scrollbar-gutter:stable; scrollbar-width:thin;
        scrollbar-color:color-mix(in srgb,var(--mc-ink) 29%,var(--mc-rail)) var(--mc-rail) }
      .dsh-control-scroll[hidden] { display:none }
      .dsh-control-nav { display:flex; flex-wrap:wrap; align-items:center; gap:.2rem; padding:.2rem; border:1px solid var(--mc-line);
        border-radius:.6rem; background:var(--mc-card) }
      @container (max-width: 760px) {
        .dsh-control-grid[data-view]:not([data-view="chat"]) { grid-template-columns:minmax(0,1fr) }
        .dsh-control-grid[data-view]:not([data-view="chat"]) .dsh-control-chat { display:none }
        .dsh-control-scroll { border-left:0 }
      }
      .mc-button, .dsh-control-nav button { color:var(--mc-ink); background:transparent; font:inherit;
        font-size:.8rem; font-weight:550; border-radius:.45rem; padding:.32rem .58rem;
        border:1px solid var(--mc-line); cursor:pointer }
      .mc-button:enabled:hover, .dsh-control-nav button:hover { background:var(--mc-hover) }
      .dsh-control-nav button { border-color:transparent; padding:.28rem .54rem; color:var(--mc-muted) }
      .dsh-control-nav button[aria-pressed="true"] { color:var(--mc-ink); background:var(--mc-hover) }
      .mc-button:focus-visible, .dsh-control-nav button:focus-visible, .mc-session-title:focus-visible,
      .mc-model-editor select:focus-visible, .dsh-control-scroll:focus-visible { outline:2px solid var(--mc-accent); outline-offset:-2px }
      .mc-button:disabled { opacity:.5; cursor:default }
      .mc-primary { background:color-mix(in srgb,var(--mc-accent) 15%,var(--mc-card)); color:var(--mc-accent);
        border-color:color-mix(in srgb,var(--mc-accent) 32%,transparent) }
      .mc-primary:enabled:hover { background:color-mix(in srgb,var(--mc-accent) 24%,var(--mc-card)) }
      .mc-start { display:grid; place-content:safe center; flex:1; min-height:0; overflow:auto; padding:1.25rem }
      .mc-start-inner { width:min(100%,26rem); box-sizing:border-box; padding:clamp(1rem,3cqi,1.7rem);
        text-align:start }
      .mc-start-inner p { margin:0 0 .95rem; line-height:1.5; color:var(--mc-muted) }
      .mc-start-inner .mc-failure { margin:.75rem 0 0 }
      .mc-roster { min-height:100%; box-sizing:border-box; --mc-gutter:clamp(1rem,2cqi,1.65rem) }
      .mc-heading { position:sticky; inset-block-start:0; z-index:1; display:flex; align-items:center;
        justify-content:space-between; gap:.75rem; padding:1.45rem var(--mc-gutter) 1.05rem;
        background:var(--mc-rail); border-bottom:1px solid var(--mc-line) }
      .mc-heading h2 { font-size:1.17rem; line-height:1.3; font-weight:625; letter-spacing:-.035em; margin:0 }
      .mc-count { display:block; margin-top:.25rem; color:var(--mc-muted); font-size:.76rem; font-variant-numeric:tabular-nums }
      .mc-refresh.mc-button,.mc-change.mc-button { display:inline-grid; place-items:center; flex:none; width:1.85rem;
        height:1.85rem; padding:0; border:0; color:var(--mc-muted); border-radius:.25rem }
      .mc-refresh.mc-button:hover,.mc-change.mc-button:hover,.mc-change[aria-expanded="true"] { color:var(--mc-ink); background:var(--mc-hover) }
      .mc-sessions { margin:0; padding:0 var(--mc-gutter); list-style:none }
      .mc-session { min-width:0; padding:1rem 0 .85rem; border-bottom:1px solid var(--mc-line) }
      .mc-session-header,.mc-session-settings { display:flex; min-width:0; gap:.55rem; align-items:center; justify-content:space-between }
      .mc-session-title { min-width:0; padding:0; border:0; border-radius:.15rem; background:transparent; color:inherit; font:inherit;
        font-size:.94rem; line-height:1.35; letter-spacing:-.013em; font-weight:615; text-align:left; overflow:hidden;
        text-overflow:ellipsis; white-space:nowrap; cursor:pointer }
      .mc-session-title:hover { color:var(--mc-accent) }
      .mc-status { display:inline-flex; flex:none; align-items:center; gap:.36rem; color:var(--mc-muted);
        font-size:.7rem; line-height:1.5; white-space:nowrap }
      .mc-status::before { content:""; width:.34rem; height:.34rem; border-radius:50%; box-sizing:border-box;
        border:1px solid currentColor }
      .mc-status[data-status="running"]::before { background:var(--dsw-alias-state-business-primary,#7ccca9); border:0 }
      .mc-status[data-status="closed"]::before { border-radius:0; height:1px; border:0; background:currentColor }
      .mc-workspace { display:block; color:var(--mc-muted); font-size:.76rem; line-height:1.4; overflow:hidden;
        text-overflow:ellipsis; white-space:nowrap; margin:.15rem 0 .6rem }
      .mc-session-settings { align-items:flex-start }
      .mc-model-details { min-width:0; flex:1; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:start;
        gap:.55rem; margin:0; padding-top:.13rem }
      .mc-model-details dd { margin:0; font-size:.79rem; line-height:1.45 }
      .mc-model-name,.mc-provider { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }
      .mc-provider { font-size:.7rem; color:var(--mc-muted); margin-top:.1rem }
      .mc-effort dd { font-size:.73rem; color:var(--mc-muted); padding-top:.06rem }
      .mc-next { margin:.55rem 0 0; padding-left:.55rem; border-left:2px solid var(--mc-accent);
        color:var(--mc-muted); font-size:.72rem; line-height:1.45; overflow-wrap:anywhere }
      .mc-next strong { color:var(--mc-ink); font-weight:570 }
      .mc-visually-hidden { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap }
      .mc-roster-note, .mc-pages { margin:1rem var(--mc-gutter); color:var(--mc-muted); font-size:.8rem; overflow-wrap:anywhere }
      .mc-pages { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:.4rem }
      .mc-pages div { display:flex; gap:.3rem }
      .mc-model-editor { display:grid; gap:.5rem; min-width:0; margin:.5rem 0 0; padding:.8rem 0 0;
        border-top:1px solid var(--mc-line) }
      .mc-model-editor label { display:grid; gap:.22rem; font-size:.74rem; color:var(--mc-muted) }
      .mc-model-editor select { color:var(--mc-ink); background:var(--mc-base); font:inherit; font-size:.8rem;
        min-width:0; max-width:100%; padding:.36rem; border:1px solid var(--mc-line); border-radius:.4rem }
      .mc-editor-actions { display:flex; gap:.4rem; align-items:center }
      .mc-failure { color:var(--dsw-alias-state-error-primary,#e98f81); overflow-wrap:anywhere }
    `
    async function request(rpc, method, payload = {}) {
      const result = await rpc.call(channel,method,payload)
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    }
    function useOptions(rpc, method, provider, model, enabled) {
      const [result,setResult] = React.useState({})
      React.useEffect(()=>{
        if (!enabled) return
        let active = true
        setResult({})
        request(rpc,method,{provider,model}).then(
          value=>{if(active)setResult({value})},
          error=>{if(active)setResult({error:error.message})},
        )
        return ()=>{active=false}
      },[rpc,method,provider,model,enabled])
      return result
    }
    function ModelEditor({rpc,row,onClose,onSaved}) {
      const initial = row.selected ?? row.model
      const [provider,setProvider] = React.useState(initial?.providerId ?? '')
      const [model,setModel] = React.useState(initial?.modelId ?? '')
      const [effort,setEffort] = React.useState(initial?.selectedEffort ?? '')
      const [saving,setSaving] = React.useState(false)
      const [failure,setFailure] = React.useState('')
      const providers = useOptions(rpc,'providers',undefined,undefined,true)
      const models = useOptions(rpc,'models',provider,undefined,Boolean(provider))
      const reasoning = useOptions(rpc,'efforts',provider,model,Boolean(provider && model))
      async function save(event) {
        event.preventDefault()
        setSaving(true); setFailure('')
        try {
          await request(rpc,'select-model',{id:row.id,provider,model,...(effort && {effort})})
          onSaved()
        } catch(error) {setFailure(error.message)}
        finally {setSaving(false)}
      }
      const select = (label,value,options,change,disabled,placeholder) => h('label',null,label,
        h('select',{value,disabled:saving || disabled,onChange:event=>change(event.target.value)},
          h('option',{value:''},placeholder),
          ...options.map(item=>h('option',{key:item.id,value:item.id},item.name))))
      const defaultEffort = reasoning.value?.efforts.find(level=>level.id===reasoning.value.defaultEffort)?.name
      const error = failure || providers.error || models.error || reasoning.error
      return h('form',{className:'mc-model-editor','aria-label':'Change model for '+row.title,onSubmit:save},
        select('Provider',provider,providers.value ?? [],next=>{setProvider(next);setModel('');setEffort('')},
          !providers.value,providers.value?'Choose a provider':'Loading providers…'),
        select('Model',model,models.value ?? [],next=>{setModel(next);setEffort('')},
          !models.value,models.value?(models.value.length?'Choose a model':'No models available'):'Choose a provider first'),
        select('Effort',effort,reasoning.value?.efforts ?? [],setEffort,!reasoning.value,
          defaultEffort?'Default ('+defaultEffort+')':reasoning.value===null?'Unavailable for this model':'Model default'),
        error && h('div',{className:'mc-failure',role:'alert'},error),
        h('div',{className:'mc-editor-actions'},
          h('button',{className:'mc-button mc-primary',type:'submit',disabled:saving || !models.value?.some(item=>item.id===model) ||
            reasoning.value===undefined || Boolean(effort && !reasoning.value?.efforts.some(level=>level.id===effort))},
            saving?'Saving…':'Apply'),
          h('button',{className:'mc-button',type:'button',disabled:saving,onClick:onClose},'Cancel')))
    }
    function glyph(path,size) {
      return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',
        'aria-hidden':true,focusable:'false',strokeWidth:1.65,strokeLinecap:'round',strokeLinejoin:'round'},
        h('path',{d:path}))
    }
    function SessionRow({row,rpc,editing,onOpen,onEdit,onClose,onSaved}) {
      const model = row.model
      const status = row.status[0].toUpperCase() + row.status.slice(1)
      const modelContext = model?.source === 'running' ? 'Running model' : model?.source === 'last-request' ? 'Last request model' : 'Model'
      const provider = [model?.provider, model?.source === 'last-request' && 'Last request'].filter(Boolean).join(' · ')
      const next = row.showNext && row.selected
      return h('li',{className:'mc-session'},
        h('div',{className:'mc-session-header'},
          h('button',{className:'mc-session-title',type:'button',title:row.title,onClick:onOpen},row.title),
          h('span',{className:'mc-status','data-status':row.status},status)),
        h('span',{className:'mc-workspace',title:row.workspace},row.workspace),
        h('div',{className:'mc-session-settings'},
          h('dl',{className:'mc-model-details'},
            h('div',null,h('dt',{className:'mc-visually-hidden'},modelContext),
              h('dd',null,h('span',{className:'mc-model-name',title:model?.model},model?.model || 'No model selected'),
                provider && h('span',{className:'mc-provider',title:provider},provider))),
            model?.effortLabel && h('div',{className:'mc-effort'},
              h('dt',{className:'mc-visually-hidden'},'Effort'),
              h('dd',null,model.effortLabel))),
          h('button',{className:'mc-button mc-change',type:'button','aria-label':'Change model for '+row.title,
            'aria-expanded':editing,title:'Change model',onClick:editing ? onClose : onEdit},
            glyph('M4 8h9m4 0h3M4 16h3m4 0h9M13 5v6M8 13v6',16))),
        next && h('p',{className:'mc-next'},h('strong',null,'Next'),' · ',
          [next.model,next.provider,next.effortLabel].filter(Boolean).join(' · ')),
        editing && h(ModelEditor,{rpc,row,onClose,onSaved}))
    }
    function Page({rpc, sessions, uiWorkspace, layout, SessionProvider, renderFactorySlot, renderSlot}) {
      const [state,setState] = React.useState(null)
      const [offset,setOffset] = React.useState(0)
      const [revision,refresh] = React.useReducer(n=>n+1,0)
      const [busy,setBusy] = React.useState(false)
      const [rosterError,setRosterError] = React.useState('')
      const [chatError,setChatError] = React.useState('')
      const [view,setView] = React.useState('chat')
      const [editing,setEditing] = React.useState(null)
      const [sessionId,setSessionId] = React.useState(null)
      const [bound,setBound] = React.useState(null)
      const [bindRevision,retryBinding] = React.useReducer(n=>n+1,0)
      const rosterScroll = React.useRef(null)
      const panelsId = React.useId()
      const showSessions = view === 'sessions'
      const showRepairs = view === 'repairs'
      const showReviews = view === 'reviews'
      const rosterKind = showRepairs ? 'fixer' : showSessions ? 'workspace' : null
      React.useEffect(()=>{
        let active = true
        rpc.call(channel,'current',{}).then(result=>{
          if (active && result.ok && result.value.sessionId) setSessionId(previous=>previous ?? result.value.sessionId)
        }).catch(()=>{}) // The explicit Open action can retry a failed lookup.
        return ()=>{active=false}
      },[rpc])
      React.useEffect(()=>{
        if (!sessionId) return
        let active = true
        let reference
        async function retain() {
          await sessions.refresh()
          if (!active) return
          reference = sessions.retain(sessionId,{source:'desktopMasterControl'})
          setBound({sessionId,reference})
          await reference.ready
        }
        retain().catch(error=>{if(active)setChatError(error.message)})
        return ()=>{active=false; reference?.release()}
      },[sessions,sessionId,bindRevision])
      React.useEffect(()=>{
        if (!rosterKind) return
        let active = true
        let timer
        async function load() {
          try {
            const result = await rpc.call(channel,'list',{offset,kind:rosterKind})
            if (!result.ok) throw new Error(result.error.message)
            if (active) {
              const lastOffset = Math.floor(Math.max(0,result.value.total-1)/36)*36
              if (offset > lastOffset) setOffset(lastOffset)
              else setState({...result.value,offset,kind:rosterKind})
              setRosterError('')
            }
          } catch(error) { if (active) setRosterError(error.message) }
          finally { if (active) timer = setTimeout(load,5000) }
        }
        void load()
        return ()=>{active=false;clearTimeout(timer)}
      },[rpc,offset,revision,rosterKind])
      async function open() {
        setBusy(true); setChatError('')
        try {
          const result = await rpc.call(channel,'open',{})
          if (!result.ok) throw new Error(result.error.message)
          if (sessionId === result.value.sessionId) retryBinding()
          setSessionId(result.value.sessionId)
        } catch(error) {setChatError(error.message)}
        finally {setBusy(false)}
      }
      const rows = state?.kind === rosterKind && state?.offset === offset ? state.rows : undefined
      const total = state?.kind === rosterKind ? state.total : undefined
      function changePage(next) {
        setEditing(null)
        setOffset(next)
        if (rosterScroll.current) rosterScroll.current.scrollTop = 0
      }
      function togglePanel(next) {
        setEditing(null)
        setOffset(0)
        setView(current=>current === next ? 'chat' : next)
      }
      function openRepairSession(id) {
        window.__dshPrFixerPending = id
        window.dispatchEvent(new CustomEvent('dsh-pr-fixer:open',{detail:{sessionId:id}}))
        layout.selectPanel('desktop-pr-fixer')
      }
      const rosterTitle = showRepairs ? 'Repair station' : 'Workspace sessions'
      const rosterCount = total === undefined ? null : showRepairs
        ? (total === 1 ? '1 repair' : total + ' repairs')
        : (total === 1 ? '1 session' : total + ' sessions')
      const rosterEmpty = showRepairs ? 'No repair chats yet.' : 'No workspace sessions yet.'
      return h('div',{className:'dsh-control-shell'},
        h('div',{className:'dsh-control-bar'},
          h('div',{className:'dsh-control-brand'},
            h('span',{className:'dsh-control-mark','aria-hidden':true},glyph('M3 16V9m6 10V5m6 12V8m6 6v-4',20)),
            h('h1',null,'Master Control')),
          h('nav',{className:'dsh-control-nav','aria-label':'Master Control views'},
            h('button',{type:'button','aria-pressed':view==='chat','aria-controls':panelsId+'-chat',onClick:()=>setView('chat')},'Chat'),
            h('button',{type:'button','aria-pressed':showSessions,'aria-controls':panelsId+'-sessions',
              onClick:()=>togglePanel('sessions')},'Workspace sessions'),
            h('button',{type:'button','aria-pressed':showRepairs,'aria-controls':panelsId+'-sessions',
              onClick:()=>togglePanel('repairs')},'Repair station'),
            h('button',{type:'button','aria-pressed':showReviews,'aria-controls':panelsId+'-reviews',
              onClick:()=>togglePanel('reviews')},'Review queue'))),
        h('div',{className:'dsh-control-grid','data-view':view},
          h('section',{id:panelsId+'-chat',className:'dsh-control-chat','aria-label':'Control chat'},
            bound && bound.sessionId===sessionId
              ? h(SessionProvider,{session:bound.reference},
                renderFactorySlot('conversation.content',{variant:'embedded',phase:'active',hero:false}))
              : h('div',{className:'mc-start'},
                h('div',{className:'mc-start-inner'},
                  h('p',null,'Send messages, read replies, and work with files across your workspaces.'),
                  h('button',{className:'mc-button mc-primary',type:'button',disabled:busy || (sessionId && !chatError),onClick:open},
                    busy || (sessionId && !chatError) ? 'Opening…' : 'Open control chat'),
                  chatError && h('p',{className:'mc-failure',role:'alert'},chatError)))),
          h('div',{id:panelsId+'-sessions',className:'dsh-control-scroll',ref:rosterScroll,hidden:!rosterKind,
            tabIndex:0,role:'region','aria-label':'Scrollable '+rosterTitle.toLowerCase()},
            h('section',{className:'mc-roster','aria-label':rosterTitle},
              h('header',{className:'mc-heading'},
                h('div',null,h('h2',null,rosterTitle),
                  rosterCount && h('span',{className:'mc-count'},rosterCount)),
                h('button',{className:'mc-button mc-refresh',type:'button',title:'Refresh '+rosterTitle.toLowerCase(),
                  'aria-label':'Refresh '+rosterTitle.toLowerCase(),onClick:refresh},
                  glyph('M19.5 10a7.5 7.5 0 1 0-.9 6M20 4v6h-6',16))),
              rosterError && h('p',{className:'mc-roster-note mc-failure',role:'alert'},rosterError),
              rows?.length ? h('ul',{className:'mc-sessions'},rows.map(row=>h(SessionRow,{
                key:row.id,row,rpc,editing:editing===row.id,
                onOpen:()=>showRepairs ? openRepairSession(row.id) : uiWorkspace.openSession(row.id),
                onEdit:()=>setEditing(row.id),
                onClose:()=>setEditing(null),onSaved:()=>{setEditing(null);refresh()},
              }))) : !rosterError && h('p',{className:'mc-roster-note',role:'status'},
                rows ? rosterEmpty : 'Loading sessions…'),
              total > 36 && h('div',{className:'mc-pages'},
                h('span',null,(offset+1)+'–'+Math.min(offset+36,total)+' of '+total),
                h('div',null,
                  h('button',{className:'mc-button',type:'button',disabled:offset===0,onClick:()=>changePage(offset-36)},'Previous'),
                  h('button',{className:'mc-button',type:'button',disabled:offset+36>=total,onClick:()=>changePage(offset+36)},'Next'))))),
          h('div',{id:panelsId+'-reviews',className:'dsh-control-scroll',hidden:!showReviews,tabIndex:0,role:'region',
            'aria-label':'Review queue'},
            showReviews && renderSlot('desktop-master-control.review-queue',{},{
              fallback:h('section',{className:'mc-roster'},h('header',{className:'mc-heading'},h('h2',null,'Review queue')),
                h('p',{className:'mc-roster-note'},'Enable the Auto Auditor plugin to see reviews here.')),
            }))))
    }
    const Icon = () => glyph('M3 16V9m6 10V5m6 12V8m6 6v-4',18)
    return {
      inject:['slots','connection','sessions','uiWorkspace','layout'],
      apply(ctx) {
        ctx.effect(()=>{
          const style = document.createElement('style')
          style.dataset.dshAppearance = 'refined'
          style.textContent = appearance + css
          document.head.append(style)
          return ()=>style.remove()
        }, 'Master Control styles')
        ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:id,priority:seatPriority,
          children:{
            'desktop-master-control.private-binding':{kind:'single',scope:'session-maybe'},
            'desktop-master-control.review-queue':{kind:'single',scope:'root'},
          },
          inject:()=>({rpc:ctx.get('connection').rpc,sessions:ctx.get('sessions'),uiWorkspace:ctx.get('uiWorkspace'),layout:ctx.get('layout')})},Page))
        ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id,order:-20,priority:seatPriority,label:()=> 'Master Control'},Icon))
      },
    }
  },
})
