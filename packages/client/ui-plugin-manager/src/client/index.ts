/**
 * Plugin manager, browser half: the **Plugins** entry of the sidebar and the
 * management page it opens in the main column. The page installs, enables,
 * disables, and removes the bundles of the Host's profile through the
 * `pluginManager` Remote and switches their rows in the profile's user layer.
 * A plugin that carries its own configuration renders it on this page through
 * the slots the page declares (`slot-contract.ts`).
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: the root `main` keyed slot the page registers into, declared by
// ui-layout with the panel id brand, and the `sidebar.panellist` list the
// entry registers into, declared by ui-sidebar.
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: the ctx.remoteAccess Context merge.
import type {} from '@deepseek-ai/dsh-api-remote-access/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: the forwarded events' own declaration (`$on`'s key face resolves
// through the owning package's client-safe types subpath).
import type {} from '@deepseek-ai/dsh-plugin-manager/types'
import { PluginManagerPage } from './PluginManagerPage.tsx'
import { createPluginHeaderRef } from './header-scroll.ts'
import { McpServersSection, type McpServersSectionInjected } from './McpServersSection.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginRefreshToast, type PluginRefreshToastFace } from './PluginRefreshToast.tsx'
import { PluginsPanelIcon } from './PluginsPanelIcon.tsx'
import { configLedgerSource, type ConfigLedger } from './config-ledger.ts'
import { tabLedgerSource } from './tab-ledger.ts'
import { PluginManagerController } from './manager-store.ts'
import { en, ja, es, fr, de, ru, pt, zh, type PluginManagerLocaleKey } from './locales.ts'
import { createNavigationStore } from './navigation-store.ts'
import type {} from './slot-contract.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only management activity, independent of the visible Plugins page. */
    pluginChanges: {
      /**
       * Observe whether a bundle or one of its rows is being changed.
       * @param packageName Bundle package name.
       * @returns A snapshot source whose subscriptions belong to the caller.
       */
      bundle(packageName: string): HostObservable<boolean>
    }

    /** Cross-plugin navigation to the Plugins panel. */
    pluginNavigation: {
      /**
       * Open a bundle's details without changing the current Session.
       * An absent bundle displays the plugin list after loading.
       * @param packageName - npm package name of the bundle.
       */
      openBundle(packageName: string): void
      /** Open the Plugins main list without opening a dialog or changing the current Session. */
      openList(): void
    }
  }
}

export type { PluginManagerPageProps } from './PluginManagerPage.tsx'
export type { ConfigLedger, OfficialItem } from './config-ledger.ts'
export type { PluginManagerFace } from './manager-store.ts'
export type { PluginManagerLocaleKey } from './locales.ts'
export type {
  ConfigPageForm, PluginActivationOwnerProps, PluginAddActionsProps, PluginTabInstall, PluginTabProps,
  PluginConfigViewProps, PluginDetailProps, PluginPackageRef, PluginRowRef, PluginsSubject,
} from './slot-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugin manager tab copy. */
    'pluginManager': PluginManagerLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'pluginManager'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'plugins' as MainPanelId

/** Services required by the sidebar registration, the Remote methods, and access; the inventory says whether the Host manages a profile. */
export const inject = ['slots', 'locale', 'remote', 'remote.pluginManager', 'remote.pluginInventory', 'remote.pluginRegistryProbe', 'configForms', 'settingsDirectory', 'layout', 'remoteAccess']

/**
 * Contribute the Plugins entry to the sidebar with the management page it
 * opens, and keep it current on the Host's change events, while the current
 * Peer may list the installed bundles.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-plugin-manager: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.inject(['commandUi'], (scope) => {
    const commands = scope.get('commandUi') as {
      register(entry: { name: string; label(): string; available(): boolean; ui: { kind: 'action'; run(): void } }): () => void
    }
    scope.effect(() => commands.register({
      name: 'plugins', label: () => t('panel'), available: () => true,
      ui: { kind: 'action', run: () => { ctx.layout.selectPanel(PANEL_ID) } },
    }), 'ui-plugin-manager: composer navigation')
  })
  const controller = new PluginManagerController(ctx)
  ctx.effect(() => () => { controller.dispose() }, 'ui-plugin-manager: controller')
  ctx.provide('pluginChanges', { bundle: packageName => controller.observeChanges(packageName) })
  // The page is a global panel: it belongs to the profile, not to a Session,
  // and the sidebar's entry selects it. What is installed and switched on is
  // the page's own; a plugin's configuration arrives through the slots the
  // page declares here, so the page never names a configurable plugin.
  const configLedger = configLedgerSource(ctx)
  const face = controller.inject(configLedger, tabLedgerSource(ctx), text => ctx.locale.resolveText(text))
  ctx.remoteAccess.whenAccess('pluginManager/listBundles', function* () {
    // The Host says when what is installed, enabled, or composed changed — from
    // this page, the CLI, or another browser — and streams install output.
    // A page never rendered holds no snapshot to refresh.
    const refresh = (): void => {
      // A profile change can replace a bundle's files, and a restarted Host is read afresh.
      controller.details.reset()
      if (controller.getSnapshot().status !== 'idle') void controller.load()
    }
    // Host changes made while access was withdrawn reached no subscription below.
    refresh()
    yield ctx.remote.$on('plugin-manager/changed', refresh)
    yield ctx.remote.$on('plugin-manager/install-log', (chunk) => { controller.appendLog(chunk) })
    yield ctx.remote.$on('plugin-manager/install-state', (progress) => { controller.installProgress(progress) })
    yield ctx.remote.$on('plugin-manager/update-state', (progress) => { controller.updateProgress(progress) })
    yield ctx.on('connection/reset', refresh)
    yield ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'plugin-manager.refresh-toast', locale: NS,
      inject: (): PluginRefreshToastFace => ({
        hooks: { pluginManager: face.hooks.pluginManager },
        dismissNotice: face.dismissNotice,
      }),
    }, PluginRefreshToast))
    yield ctx.slots.inject('main', function* () {
      const handle = createNavigationStore(), instance = handle.create()
      const store: typeof handle = { ...handle, create: () => instance }
      yield ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        store,
        inject: () => ({ ...face, createHeaderRef: createPluginHeaderRef }),
        children: {
          'plugins.add.actions': { kind: 'list', scope: 'root' },
          'plugins.tab': { kind: 'list', scope: 'root' },
          'plugins.item': { kind: 'list', scope: 'root' },
          'plugins.bundle.activation': { kind: 'keyed', scope: 'root' },
          'plugins.bundle.config': { kind: 'keyed', scope: 'root' },
          'plugins.row.config': { kind: 'keyed', scope: 'root' },
          'plugins.detail.actions': { kind: 'list', scope: 'root' },
          'plugins.detail.badge': { kind: 'list', scope: 'root' },
          'plugins.detail.section': { kind: 'list', scope: 'root' },
        },
      }, PluginManagerPage)
      yield ctx.layout.panelInfo.subscribe(() => {
        if (ctx.layout.panelInfo.getSnapshot().activePanelId !== PANEL_ID) instance.actions.setView({ kind: 'list' })
      })
      const disposeNavigation = ctx.reflect.provide('pluginNavigation', {
        openList: () => {
          ctx.layout.selectPanel(PANEL_ID)
          instance.actions.setTab('installed')
          instance.actions.setView({ kind: 'list' })
        },
        openBundle: (packageName: string) => {
          ctx.layout.selectPanel(PANEL_ID)
          instance.actions.setTab('installed')
          instance.actions.setView({ kind: 'package', name: packageName })
        },
      })
      yield () => { void disposeNavigation() }
      let published: ConfigLedger | undefined
      let withdraw = (): void => {}
      const publishSearch = (): void => {
        const ledger = configLedger.getSnapshot()
        if (ledger === published) return
        published = ledger
        withdraw()
        withdraw = ctx.settingsDirectory.register([
          {
            id: 'plugins.page', label: () => t('panel'), description: () => t('searchPageDescription'), keywords: () => t('searchPageKeywords'),
            link: { place: () => t('panel'), open: () => { ctx.layout.selectPanel(PANEL_ID); instance.actions.setView({ kind: 'list' }) } },
          },
          ...ledger.items.map(item => ({
            id: `plugins.item.${item.id}`, label: item.label, description: () => t('searchItemDescription'), keywords: () => t('searchItemKeywords'),
            link: { place: () => t('panel'), open: () => { ctx.layout.selectPanel(PANEL_ID); instance.actions.setView({ kind: 'item', id: item.id }) } },
          })),
        ])
      }
      publishSearch()
      const stopSearch = configLedger.subscribe(publishSearch)
      yield () => { stopSearch(); withdraw() }
    })
    yield ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 0,
      label: () => t('panel'),
      locale: NS,
    }, PluginsPanelIcon))
  })
  type ChangeAnswer = { ok: boolean; value?: { application: string; error?: { code: string } }; error?: { message: string } }
  const changed = async (call: Promise<ChangeAnswer>): Promise<void> => {
    const result = await call
    if (!result.ok) throw new Error(result.error?.message ?? 'request failed')
    if (result.value?.application === 'failed') throw new Error(result.value.error?.code ?? 'failed')
  }
  const mcp: McpServersSectionInjected = {
    listMcpServers: async () => {
      const result = await ctx.remote.pluginManager.listMcpServers()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    discoverMcpServers: async () => {
      const result = await ctx.remote.pluginManager.discoverMcpServers()
      if (!result.ok) throw new Error(result.error.message)
      return result.value
    },
    addMcpServer: config => changed(ctx.remote.pluginManager.addMcpServer(config)),
    removeMcpServer: entryId => changed(ctx.remote.pluginManager.removeMcpServer(entryId as never)),
    setMcpServerEnabled: (entryId, enabled) => changed(ctx.remote.pluginManager.setPluginEnabled(entryId as never, enabled)),
    signInMcpServer: async (authKey, onNotice, signal) => {
      const authorization = ctx.get('remote.authorization') as NonNullable<ClientContext['remote']['authorization']> | undefined
      if (authorization === undefined) throw new Error('sign-in is not available on this host')
      try {
        for await (const item of authorization.begin(authKey, undefined, signal)) {
          if (item.type === 'notice') onNotice({ message: item.message, ...item.url === undefined ? {} : { url: item.url } })
        }
      } catch (error: unknown) {
        if (!signal.aborted) throw error
      }
    },
  }
  ctx.effect(() => ctx.settingsDirectory.register([
    { id: 'mcp.servers', section: 'mcp', label: () => t('mcpYourServers'), description: () => t('mcpHelp'), keywords: 'model context protocol tools connectors enable disable' },
    { id: 'mcp.import', section: 'mcp', label: () => t('mcpImportTitle'), description: () => t('mcpImportFind'), keywords: 'mcp claude desktop claude code codex copy existing' },
    { id: 'mcp.add', section: 'mcp', label: () => t('mcpAddTitle'), keywords: 'mcp stdio http command url headers environment new connect' },
  ]), 'ui-plugin-manager: MCP search entries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'mcp', order: 60, label: () => t('mcpNav'), locale: NS,
    inject: () => mcp,
  }, McpServersSection))
}
