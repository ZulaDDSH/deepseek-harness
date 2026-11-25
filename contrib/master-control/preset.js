export const name = 'desktop-master-control-preset'
export const inject = ['agentPresets','loader']

export async function apply(ctx, config) {
  // Use the profile's composed entries so custom tools and platform conditions
  // are carried over with the same configuration as the built-in modes.
  const groups = new Map()
  for (const {options} of ctx.loader.entries()) {
    if (Array.isArray(options.config?.plugins)) groups.set(options.id,options.config.plugins)
  }
  const standard = groups.get('preset-standard') ?? []
  const creator = groups.get('preset-cordis') ?? []
  const plugins = new Map()
  for (const entry of [...standard,...creator,...config.plugins]) plugins.set(entry.id,entry)
  const compaction = plugins.get('compaction')
  if (compaction) {
    plugins.set('compaction', {
      ...compaction,
      config: compaction.config.map(entry => entry.id === 'compaction-basic' ? {
        ...entry,
        // The backend's 80% threshold turns a 625k context cap into a
        // 500k trigger, subject to model capacity and output headroom.
        config: {...entry.config,maxContextWindow:625_000,thresholdRatio:0.8},
      } : entry),
    })
  }
  const unregister = await ctx.agentPresets.register({...config,plugins:[...plugins.values()]})
  ctx.effect(()=>unregister,'Master Control preset')
}
