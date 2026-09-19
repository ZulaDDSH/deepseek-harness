# Agent Note: 精选的 pi-ai 目录补充

Status: implemented

[English](2026-09-18-pi-ai-catalog-supplement.md) | 中文

## 问题

pi-ai 从 [models.dev](https://models.dev) 生成各提供方的目录，并把这些目录随版本化的包一起发布，因此某个提供方在两次 pi-ai 发布之间新增的模型，要等到依赖升级后才会出现在 harness 中。OpenCode Go 在 `@earendil-works/pi-ai@0.85.1`（npm `latest`）发布之后新增了 DeepSeek V4.1 Flash，因此该模型在所有选择器中都缺失，也无法被请求。现有配置无法补上这个缺口：profile 的 `models` 列表会替换整条路由的目录，而路由级 `api` 覆盖会作用于该路由的每个模型，因此要向 opencode-go 的混合目录（`anthropic-messages`、`openai-completions` 与 `openai-responses`）中添加一个 chat-completions 模型，就不得不丢掉它的其他模型。opencode 本身（以及包装它的 OpenChamber）实时读取 models.dev，因此无需更新客户端即可列出该模型；而 harness 离线、可复现地构建，不会在请求时抓取目录。

## 决策

`dsh-llm-pi-ai` 随包附带一份签入代码库的补充（`src/catalog-supplement.ts`），收录固定版本 pi-ai 目录未描述的模型，内容转录自 models.dev，即 pi-ai 生成目录所依据的同一个上游来源。每个条目都是完整的 pi-ai `Model`，包含协议、端点、容量、模态、成本，以及原始 models.dev 行不会写明的提供方特有细节（思考格式、思考内容回放）。`catalogModels()` 把补充合并到已安装条目之后，相同 id 的已安装条目始终优先，因此当 pi-ai 升级自带该模型时，对应的补充条目就成了一条可直接删除的空操作。第一个条目是 opencode-go 的 `deepseek-v4.1-flash`。

已安装目录已经描述的模型若存在字段错误，应通过 `modelOverrides` 修改，而不是加入补充：补充只为数据缺口而存在，不用于纠错。

## 验证

- 目录 spec 断言：被补充的 id 会出现在其路由上，按该路由的协议与端点构造，且不会挤掉已安装的 id。
- 没有无密钥录制会话快照发生变化：补充改变的是所提供的目录，而非请求、transcript（文本记录）或持久化内容。

## 考虑过的替代方案

| 已否决 | 原因 |
|---|---|
| 在启动或请求时抓取 models.dev 或提供方的 `/models` 端点 | harness 离线、可复现地构建，其测试在无网络下回放；实时目录会给每次启动引入网络依赖、缓存与故障模式，其内容还会随网络而变 |
| 在设置中配置路由的 `models` 列表 | `models` 列表会替换整个目录，而路由级 `api` 会作用于每个模型，因此向 opencode-go 的混合目录添加一个 chat-completions 模型，会丢掉它的 anthropic 与 responses 模型 |
| 扩展 `modelOverrides`，用逐模型协议字段引入目录未描述的 id | 这会把该字段已文档化的含义（重塑已安装模型）改造成第二套目录机制，并需要一个逐模型协议字段，而混合路由场景随后就要用到该字段；补充机制无需逐用户配置即可负责数据缺口 |
| 升级 pi-ai 或对其 fork | 没有任何已发布的 pi-ai 版本包含该模型；为一条生成的目录条目而 fork 一个依赖，会重复 harness 自身的 seam |
| 修改已安装或 vendored 的 pi-ai 目录数据 | pi-ai 并未 vendor 到本仓库；编辑 `node_modules` 不可复现，任何一次安装都会覆盖它 |

## 后果

- 目录路由无需任何配置项，也无需升级依赖，即可提供某提供方的最新模型；模型数据现在存在于第二个位置，但被控制得很小，并会随 pi-ai 升级而退役。
- 被补充模型的元数据，其更新程度只到添加它的那次变更为止。
- 补充只作用于它列明的提供方 id；手工声明的路由或另一提供方不受影响。
