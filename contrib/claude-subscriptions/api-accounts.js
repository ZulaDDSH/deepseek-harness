import { randomUUID } from 'node:crypto';

const api = 'anthropic-messages';
const baseURL = 'https://api.anthropic.com';
const prefix = 'Claude API key · ';
const routePattern = /^claude-api-[a-f0-9]{32}$/;
const keyRef = route => 'DSH_' + route.toUpperCase().replaceAll('-', '_') + '_API_KEY';

export function displayName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || name.length > 48 || /[\p{Cc}\p{Cf}]/u.test(name))
    throw new Error('Enter a display name of 1–48 characters.');
  return name;
}

export function apiAccounts(ctx) {
  function settings() {
    const settings = ctx.get('settings');
    const credentials = ctx.get('credentials');
    if (!settings || !credentials) return undefined;
    const provider = ctx.llm.listConfigurableProviders().find(row => row.provider === 'anthropic');
    const section = provider && settings?.describe({redactSecrets:true}).find(row => row.ns === provider.settingsNs);
    if (!section || !credentials) return undefined;
    const providers = section.value.providers ?? {};
    const accounts = Object.entries(providers).filter(([route, config]) =>
      routePattern.test(route) && config.api === api && config.baseURL === baseURL && config.apiKeyEnv === keyRef(route));
    return {settings, credentials, section, accounts};
  }

  async function list() {
    const source = settings();
    if (!source) return [];
    return Promise.all(source.accounts.map(async ([id, config]) => ({
      id, kind:'api', name:config.displayName?.startsWith(prefix) ? config.displayName.slice(prefix.length) : config.displayName || id,
      picker:config.displayName || id, signedIn:(await source.credentials.describe(keyRef(id))).configured
    })));
  }

  async function write(method, args, signal) {
    const source = settings();
    if (!source) throw new Error('Anthropic API-key accounts are unavailable in this profile.');
    const {settings:store, credentials, section, accounts} = source;
    const entry = accounts.find(([id]) => id === args?.id);
    if (method !== 'add-api' && !entry) throw new Error('This API-key account is no longer available.');
    if (method === 'rename-api') {
      await store.mutate(section.ns, [{
        op:'set', path:['providers',entry[0],'displayName'], value:prefix + displayName(args?.name)
      }], section.revision);
      return;
    }
    const name = displayName(args?.name);
    const key = typeof args?.key === 'string' ? args.key.trim() : '';
    if (!key || key.length > 2048 || !/^[\x21-\x7e]+$/.test(key))
      throw new Error('Paste a valid Anthropic API key.');
    for (const [id] of accounts) {
      if ((await credentials.resolve(keyRef(id)))?.value === key)
        throw new Error('This API key is already connected.');
    }
    const deadline = AbortSignal.timeout(15_000);
    const probe = signal ? AbortSignal.any([signal,deadline]) : deadline;
    let remoteModels;
    try {
      remoteModels = await ctx.llm.discoverModels(section.ns,{baseURL, api, apiKey:key},probe);
    } catch {
      throw new Error('Could not verify the key with Anthropic. Check the key and try again.');
    }
    if (!remoteModels.length) throw new Error('Anthropic returned no models for this key.');
    const catalog = new Map((await ctx.llm.discoverModels(section.ns,{provider:'anthropic'},probe)).map(model => [model.id,model]));
    const models = remoteModels.map(model => {
      const {id, name, contextWindow, maxTokens, inputModalities} = catalog.get(model.id) ?? model;
      return {id, ...(name && {name}), ...(contextWindow && {contextWindow}), ...(maxTokens && {maxTokens}),
        ...(inputModalities && {input:inputModalities})};
    });
    const id = 'claude-api-' + randomUUID().replaceAll('-','');
    const ref = keyRef(id);
    await credentials.set(ref,key);
    try {
      await store.mutate(section.ns,[{op:'set',path:['providers',id],value:{
        api, baseURL, apiKeyEnv:ref, displayName:prefix+name, models
      }}],section.revision);
    } catch (error) {
      await credentials.unset(ref);
      throw error;
    }
  }
  return {list,write};
}
