# Agent Note: Durable workspace change records

Status: implemented

[English](2026-09-21-durable-workspace-change-records.md) | 中文

## Problem

[改动文件卡片](../feature/2026-09-11-turn-changed-files-card.zh.md)从内存和 Session 释放时删除的临时目录提供每一轮的摘要与对比。因此 Host 重启后重新打开的对话，先前轮次既没有卡片也没有对比，尽管指出它们的仅写日志的 `workspace/changes` 宣告仍留在 Session 日志中。聊天客户端会经常重新打开对话，所以该宣告所指的内容恰恰是唯一不持久的部分。

## Decision

`root` 配置下每个 Session 一个持久目录，保存对比所需的一切：`records/<seq>.json`（所服务的摘要加上每个所列文件两侧的内容来源）、`captures/<sha1>`（文件工具编辑前后保存的整文件副本），以及 `objects/`（快照树落入的私有 git 对象库）。`root` 默认是 `$DSH_HOME/workspace-changes`，正式提供的 Web bundle 用 `dshHomePath('workspace-changes')` 显式设置它。

`TurnRecorder` 在摘要可被提供之前先把记录写入磁盘，因此重启不会丢失客户端已被告知的卡片。`dispose()` 中止排队的工作、忘记内存中的记录，并保留该目录。

`WorkspaceChanges.summary` 返回 Promise。存活记录器未命中时从该 Session 的目录读取记录，`diff` 从记录的 `cwd` 重新定位仓库，并从该 Session 自己的对象库读取快照两侧，因此没有记录过该 Session 的 Host 进程与记录过它的进程按同样的方式提供它。

保留策略用 `retentionSessions`（200）、`retentionBytes`（512 MiB）和 `retentionDays`（30）限制 `root`。清理在插件加载时以及每个轮次结束后运行：先删除超过时限的目录，再从最旧的剩余目录开始删除，直到满足数量与字节上限。Session 目录的年龄来自它自己的 `stat()`，因此还没有文件的目录不会被当作已过期。

## Alternatives considered

**让卡片及其内容继续随 Session 的生命周期存在** 是本决策之前已发布的行为，理由是 Host 已打不开内容的卡片不应出现。它之所以落败，是因为宣告事件比它所指的内容更长寿：重启后日志仍记录着某一轮改过文件，而卡片悄然消失，客户端与日志因此互相矛盾。用保留策略限制记录，既能让卡片与其内容的生命周期保持一致，又不必把两者绑在进程上。

**把摘要及其行数记进 `workspace/changes` 事件**，让日志承载卡片，此前已被否决，现在仍然否决：日志会为每一轮增加只有客户端读取的文件路径和行数，而且它仍然无法承载卡片打开的对比内容，那需要副本和快照对象。

**在 Harness home 下按仓库共用一个快照对象库** 是先前的放置方式，被否决是因为当另一个 Session 丢弃该库时本 Session 的快照会失败，而它的字节上限也无法归属。持久目录按 Session 划分，因此清理一个 Session 永远不会碰到另一个的对象，`root` 级别的字节上限按最旧的 Session 优先执行。

**只用固定大小的环形结构保留最近若干 Session 的记录** 被否决，改用保留策略的三个界限：数量、字节与时限是运维人员能直接从 `cordis.yml` 推理的三个量，而 Web bundle 已经显式设置了三者。

## Consequences

Host 重启后重新打开的对话仍保有自己的卡片与对比。记录是有界的而非永久的：超过 `retentionSessions`、`retentionBytes` 或 `retentionDays` 后，最旧的 Session 目录会被删除，其轮次既没有卡片也没有对比。

对比现在从运维人员未必预期会持久留在磁盘上的内容提供。`root` 下的捕获副本与快照对象包含被忽略的文件、仓库之外的文件和工作区外的文件，因此必须把这类内容留在 Host 之外的部署应把本插件组合出去。仓库自己的 index、对象、工作树与 ref 保持不变。

`root` 是随部署而变的配置，默认位于 `$DSH_HOME` 下；启动该插件的测试传入显式的 `root`，因此永远不会写进运维人员真实的 Harness home。增长由保留策略界定，而不是由曾经记录过的 Session 数量决定。

`packages/deliverables/workspace-changes/tests/plugin.spec.ts` 钉住该目标：它记录一轮、释放上下文、在同一个 `root` 上启动第二个上下文，并同时提供摘要和文件对比。`tests/store.spec.ts` 覆盖记录校验、Session 目录名净化，以及按时限、数量和字节的清理。
