# 客户端代码说明

[English](client-render-notes.md) | 中文

本应作为注释写在受限代码行旁的说明。每条记录都以 `file:symbol` 锚定，陈述代码本身无法表达的事实——渲染器不变量、生命周期顺序，或某种局部形态之所以唯一可行的原因。

这些说明供维护者在阅读所属代码时参考；契约本身仍保留在所属模块的 JSDoc 中。

## 根作用域插槽条目会记忆其 inject 结果

`packages/client/ui-renderer/src/client/scoped-slots.tsx:cachedRootInject`

`settings.section` 声明为 `scope: 'root'`（`packages/client/ui-settings/src/client/contract/slots.ts:SlotMap`），因此它经 `RootEntry` 渲染，而 `RootEntry` 通过 `cachedRootInject` 解析其 props。该函数以注册为键，把 `runInject(entry, …)` 记忆在 `WeakMap<StoredEntry, InjectedProps>` 中，因此 `inject` 工厂只运行一次，其返回的对象在该条目存续期间被反复复用。

对任何注册进根作用域插槽的插件而言，其后果是：该对象中被捕获的值从首次渲染起就是常量。再次调用该工厂——并从中读取新字段——不会自行发生，因为没有任何机制使 `rootInjectCache` 失效。

因此，挂载后可能变化的事实必须以求值源的形式穿越 inject 面，而不能作为普通值。保留的 `hooks` 隔间正是该机制：渲染器会从普通 props 中剥离 `hooks`，把每个条目经 `observableHook` 绑定，并以 `use<Name>` 的形式暴露给组件（`standardHookPropName` 会把键首字母大写）。读取该 hook 会订阅组件，因此变化以普通的重新渲染形式到达。

`packages/client/ui-settings-models/src/client/index.ts:apply` 正是以此方式发布凭据记录修订号——一个由 `credentials/record-updated` 订阅递增的 `createSnapshotStore({ revision })`，由 `ModelsSection` 以 `useCredentialsRevision` 消费。另一个浏览器标签页完成的登录提交的是凭据记录而非设置引用，因此缺少这条通道时，已挂载的卡片会一直渲染它在首次渲染时读到的登录前状态。

## 应用挂载跟随 Session 作用域所有者

`packages/client/web/src/mount.ts:mountClient` 同时依赖 `uiRenderer` 与 `uiSession`。客户端对账期间替换 Session 所有者时，会先释放应用挂载，因此 React 不会在其作用域适配器缺失时渲染 `session-maybe`。替换装好适配器后，挂载会重新创建。

`packages/client/ui-conversation/src/client/apply.ts:apply` 在恢复所选视图前，还会校验每个保留的视图绑定是否仍是活动的 Controller generation。这可防止拆除期间的语言或插槽通知为已退役的 Session 调用 `uiConversation.binding()`。

`packages/extensions/cordis-client-runner/src/client/inspect-registry.ts:ClientCordisInspectRegistry` 会在其所属 Client 条目被替换时丢弃排队中的清单同步，因此已退役的 Remote namespace 无法报告预期内的拆除失败。

## 相关

- [Web 客户端架构](../subsystems/web-client.zh.md) —— 这些说明所依赖的渲染机制、三条实时数据通道与 store 规范。
- [插槽参考](../subsystems/slots.zh.md) —— 声明、作用域与派生的 props 分片。
