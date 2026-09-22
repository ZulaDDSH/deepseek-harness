---
description: "用 git 工作树快照和文件工具编辑前后的整文件捕获汇总每个顶层轮次改动的文件，以 workspace/changes Session 事件宣告，并从比 Session 更长寿的记录提供摘要和逐文件对比；配置、保留策略、仓库要求与覆盖规则。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-changes

[English](README.md) | 中文

## 概述

本插件列出改动文件，提供有上限的内容对比，并为已注册 Workspace 提供实时 Git 状态和对比。轮次摘要使用 Git 快照，并为 Git 覆盖不到的文件工具编辑保存整文件内容。Host 持久记录每一轮，并追加一条 `workspace/changes` 事件。没有 Git 时只列文件工具编辑；Web 改动文件卡片渲染摘要。

Host 还会为已注册的 Workspace 提供实时状态和当前对比。状态使用 Git porcelain 记录与相对 HEAD 的行数；未知 Workspace 或不在 Git 仓库内的目录不会返回状态或对比。这些读取不会追加 Session 事件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

正式提供的 Web bundle 挂载本插件。任何具备 `subprocess` 能力且 Host 上有 git 可执行文件的组合都可以挂载它：

```yaml
- name: '@deepseek-ai/dsh-workspace-changes'
  config:
    maxFiles: 500
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `30000` | 单条 git 命令允许运行的毫秒数，超时则放弃本轮记录 |
| `outputMaxBytes` | `8388608` | 每条命令保留的 git 输出字节数，diff 列表更大时放弃本轮记录 |
| `maxFiles` | `500` | 单份摘要携带的最大文件数；`total` 仍报告完整数量 |
| `maxFileBytes` | `2097152` | 文件在文件工具编辑前后被捕获、或从快照读出做对比所允许的最大字节数；更大的文件不提供对比，其中在文件工具编辑前后被捕获的也不带行数 |
| `diffTimeoutMs` | `100` | 逐行对比允许运行的毫秒数，超时后退化为整文件替换 |
| `root` | `$DSH_HOME/workspace-changes` | 保存各 Session 记录、捕获副本与快照对象的目录；后续 Host 进程从它提供先前轮次 |
| `retentionSessions` | `200` | `root` 下保留的 Session 目录数，最新的在前；更旧的会被清理 |
| `retentionBytes` | `536870912` | `root` 下保留的字节数；超出后从最旧的目录开始清理 |
| `retentionDays` | `30` | Session 目录保留的天数；更旧的会被清理，`0` 会在下一次清理时让每个目录过期 |

有工作目录且不是子代理来源的 Session 都会被记录；子代理 Session 不记录。快照通过私有 index 写入 Session 自己拥有的持久对象目录，仓库自己的对象库以只读 alternate 的方式挂接；仓库的 index、对象、工作树和 ref 保持不变，用户此前未提交的改动也不会进入摘要。`root` 下的一个目录保存该 Session 的记录、捕获副本与快照对象；释放会保留它，由保留策略删除——在插件加载时以及每个轮次结束后：超过 `retentionDays` 的目录先被删除，然后从最旧的剩余目录开始删除，直到满足 `retentionSessions` 与 `retentionBytes`。工作目录内的嵌套仓库和 submodule 记录为 gitlink，其内部改动不会出现。不在任何 git 仓库内的工作目录不做快照。没有 git 时——或者 macOS 上只有 `/usr/bin/git` 的开发者工具桩程序时——同样定位不到仓库，插件记录一次日志。两种情况下摘要都只列下文所述的文件工具编辑，并以工作目录作为工作区；shell 的改动不会出现。

在 `write`、`edit` 或有修改作用的 `str_replace_editor` 调用运行之前，记录器把该路径上的文件复制到 Session 的持久目录，每轮每个路径只复制第一次，轮次结束时再复制一次；副本按其字节的 SHA-1 命名，相同内容只存一份。这一步不需要 git。快照覆盖到的路径保留 git 的行数；其余路径由副本提供，也就是匹配忽略模式的文件、仓库之外的文件，以及没有快照时的每一次文件工具编辑，行数来自两份副本的逐行对比，因此同一文件的重复编辑只计一次，文件工具编辑之后的 shell 改动也包含在内。轮次结束时内容没有变化的路径不会列出。超过 `maxFileBytes` 的副本不会保存：该文件列出时带 `oversized`，没有行数；两侧都这么大的路径同样列出，因为没读过的内容永远不能认定为没有改动。只差一个末尾换行的路径对比为两侧相同，而 git 仍会把那一行计入行数。`/tmp` 与平台临时目录下的文件被排除，除非它们位于仓库内。快照覆盖范围之外只通过 shell 命令做出的改动不会被记录。

每个文件携带持久的 `path`——位于工作目录内时为相对路径，否则为绝对路径——以及用于排序和标签的 `display` 路径：相对路径，仓库内位于工作目录之上的文件为 `../` 路径，家目录下的文件为 `~` 路径，其余为绝对路径。文件按 `display` 的码元顺序排序，因此上级路径和绝对路径排在工作目录自身文件之前。`workspace/changes` 事件只携带轮号；`ctx.workspaceChanges.summary(sessionId, seq)` 承诺给出该序号的事件宣告的摘要，没有记录持有它或保留策略已清理它时解析为 undefined。`ctx.workspaceChanges.diff(sessionId, seq, index, signal)` 对比该下标所列的文件：从两棵快照树或两份副本得出带三行上下文的 hunk；git 报告为二进制或某一侧含 NUL 字节时返回 `binary`；某一侧超过 `maxFileBytes` 时返回 `oversized`。逐行对比运行超过 `diffTimeoutMs` 时退化为一个替换全部行的 hunk，并标记 `coarse`。本 Host 进程没有记录过的 Session 从其持久目录提供，因此 Host 重启后重新打开的对话，只要其记录仍在、快照两侧来源的仓库仍可定位，就仍保有自己的卡片和对比。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

每个 Session 一个 `TurnRecorder`，串行化其 git 工作。`turn/start` 排入基线：`rev-parse` 每个 Session 只定位一次仓库并创建 Session 的持久对象目录，然后以仓库 index 为种子在临时 index 上执行 `add --all --ignore-errors` 与 `write-tree` 得到 tree id；不可读的文件被跳过并以 git 的退出码 1 报告，快照接受这个退出码。每轮持有自己的状态对象，因此被中断的轮次仍在运行的记录会在下一轮开始后保留自己那一轮的文件。每条命令都带 `GIT_OBJECT_DIRECTORY` 指向 Session 的持久对象目录、`GIT_ALTERNATE_OBJECT_DIRECTORIES` 指向仓库的 objects，因此已提交内容从仓库读取，新对象不会落进仓库。每次 `tools/pre-execute` 都等待该队列，因此没有修改能先于其基线发生；同一步骤还排入对 `write`、`edit` 或有修改作用的 `str_replace_editor` 调用所指路径的整文件捕获，因此副本先于编辑，`tool/result` 事件只标记本轮有结果需要记录。`agent/turn-stopping` 在轮内记录：第二次快照、两棵树之间的 `diff-tree -r -M --numstat`、对工作树内已捕获路径的 `check-ignore`、对每个未覆盖路径的第二次复制与逐行对比、追加事件，以及把该事件序号下的记录写入 Session 的持久目录（先于摘要被提供），其中保存每个所列文件两侧的内容来源，即快照树中的路径或一份副本。对比在被请求时计算：`ls-tree -l` 定位快照一侧并取其大小，`cat-file blob` 在 `maxFileBytes` 之内读出，副本从磁盘读取，两侧随后走同一个带超时的逐行对比。`turn/end` 仅在最后一次记录尝试之后仍有工具结果结束时再次记录，这覆盖了中止、失败和被转向的轮次，且不会重复一次失败的尝试；早先记录之后的空列表会取代它。仓库的 index 只读取。

git 通过 `subprocess` 能力运行，使用净化后的环境、`GIT_CONFIG_COUNT=0`（凭据清理会移除索引配置的键，因此不继承这些环境配置）、`GIT_TERMINAL_PROMPT=0`、`GIT_OPTIONAL_LOCKS=0`、配置的超时与有界输出。任何步骤失败都会放弃本轮记录并给出警告；下一轮重新开始。Session 释放与插件释放会中止排队的工作并忘记内存中的摘要；目录会保留，后续 Host 进程从它提供同样的轮次，其删除由保留策略负责。

**运行时不变式：** 不发布伴生入口。事件监听归 effect 所有，Session 的持久目录是其记录、快照树与捕获副本的唯一归属；存活的记录器提供的内容与它写入该目录的内容相同，因此没有独立观察会与它分歧。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web 产出物](../../client/ui-deliverables/README.zh.md)——读取所提供摘要并打开其文件的改动文件卡片。
- [子进程能力](../../subprocess/README.zh.md)——git 运行所经过的接缝。
- [本轮改动文件卡片决策](../../../.agents/notes/implemented/feature/2026-09-11-turn-changed-files-card.zh.md)——快照设计、覆盖规则、暂缓的影子仓库与被否决的备选方案。
- [持久记录决策](../../../.agents/notes/implemented/architecture/2026-09-21-durable-workspace-change-records.zh.md)——为什么记录、捕获副本与快照对象比其 Session 更长寿，以及保留策略如何限制它们。

<a id="model-experience"></a>
## 模型体验

无，因为记录器只追加一条仅写日志、只有客户端读取的 `workspace/changes` 事件，不注册任何面向模型的内容。

#### KV Cache 影响

这里的内容不会进入模型请求，因此不影响提供方缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 记录、捕获副本与快照树比其 Session 更长寿，但受保留策略限制：超过 `retentionSessions`、`retentionBytes` 或 `retentionDays` 后，最旧的 Session 目录会被删除，其轮次既没有卡片也没有对比。
- 某一侧来自快照路径的对比，需要该记录的工作目录仍能定位到当初记录的仓库且 git 仍可用；两者任一不再满足时不提供快照侧的对比，而副本侧的对比仍然提供。
- 有两个 git 功能在快照期间仍会写入仓库自己的 git 目录：`core.splitIndex` 会写 `sharedindex.*` 文件，git-lfs 会对改动文件运行 clean 过滤器并把对象存到 `.git/lfs` 下。
- 需要 git 2.13 或更高版本以支持 `rev-parse --absolute-git-dir`；不支持的仓库格式或其他 git 失败会带着警告放弃本轮，而不是被当成普通目录。
- Session 的首次快照会把工作树里所有未跟踪且未被忽略的文件写进 Session 的持久目录；没有 `.gitignore` 却带着大体积构建产物的仓库，会在保留策略删除前一直占用 `root` 下同等的空间。
- 用户在轮次进行中自己做的编辑会被算到该轮。
- 不在任何 git 仓库内的工作目录只列文件工具的编辑，卡片里因此没有 shell 改动；Harness home 下的影子仓库暂缓，直到其排除规则能可靠地代替缺失的 `.gitignore`。
- 快照覆盖范围之外只捕获文件工具点名的路径：那里只被 shell 命令改动的文件不会出现，在首次文件工具调用之前被两者都改过的文件从该调用起开始对比。
- 每次文件工具编辑都会把整个文件复制一次，每轮每个路径一次，上限 `maxFileBytes`，即使快照也覆盖该路径；副本存放在 Session 的持久目录中，直到保留策略删除它。
- 对比会把所列文件的完整文本送到客户端，包括被忽略的文件、工作目录之上的仓库文件和工作区外的文件；摘要路由只送路径和行数。必须把这类内容留在 Host 上的部署应把本插件组合出去。
- 退化为整文件替换的对比携带两侧的全部行，最多两倍 `maxFileBytes`。
- Windows 路径在 `path` 中保留原生分隔符；`display` 始终用斜杠分隔。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
