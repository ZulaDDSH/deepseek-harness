# Agent Note: Chat Sections 作为浏览器本地的组织层

Status: implemented

[English](2026-09-15-chat-sections-browser-local-grouping.md) | 中文

## 问题

侧边栏只能按 Workspace 对 Session 分组。`ClientWorkspaceModel.sessionIds` 是 Host 持久的归属关系，同时决定 Session 的工作目录；浏览器的 `Group by` 各模式（Workspace、Workspace 树、平铺、活动）都只是对这一归属关系的重新投影。用户想把「Code Review」和「Research」放在一起时无从表达：注册一个 Workspace 会改变 Session 的 `cwd`，而这并不是用户想要的。

对该需求最直接的理解是在 Workspace 旁边再加一个分组实体。这种理解不符合需求，原因在于能力 seam：Workspace 不是分组标签，而是一个环境——它提供指令、文件、agent（智能体）配置和工作目录。任何复用 `WorkspaceView` 的方案都会继承这些语义；任何新增并行持久注册表的方案都必须逐项回答分区是否携带某种能力。需求明确规定分区不携带其中任何一项。

剩下的是一个放置问题：一个纯粹的「标签加归属」层应当放在哪里，它是否需要 Host。

## 决策

**Chat Sections 是浏览器持久化视图状态中的一个字段，而不是 Host 实体。** `stores.ts` 在同一个 `dsh.workspace.view.v5` 值中声明 `chatSections`，该值已保存分组展开状态和手动 Session 排序：`sections`（id 与名称，按显示顺序）、每个分区的 `collapse`、`members`（Session id → 分区 id），以及每个分区的 `sectionOrder`。该层的任何内容都不经过线路传输，`ctx.workspaces` 保持不变。

持久化介质由事实性质决定。分区是用户对已可见 Session 的显示偏好，不是权威业务状态；让它持久化需要 Host 注册表、流、第二种持久格式的迁移策略，以及分区对无界面运行意味着什么的决定。「把这两个 Chat 放在一起」不足以支撑这些成本，而现有视图 store 恰好已经负责这类事实。

**归属引用生成的分区 id，而不是名称。** `newSectionId` 在 Client 上通过 `crypto.randomUUID()` 生成，并与其他 action 回调一起经注入接口到达浏览器。因此重命名分区不会重新绑定任何内容，两个分区可以同名而不成为同一实体。一个 Session 最多属于一个分区：`assignSession` 先把它从之前的分区中移除，再插入目标分区的开头；未分组的情况则直接删除归属记录。

**删除分区只删除分组。** `deleteSection` 删除分区记录、其折叠标志、其保存的排序，以及所有指向它的归属；Session 保留其日志、Workspace 归属和排序记录，并重新出现在未分组列表中。这与 Workspace 删除已声明的保留边界相同，也正是这一点让该破坏性操作无需数据丢失警告即可安全执行。

**Sections 面板堆叠在 Workspace 面板下方；它不是分组模式，也从不取代分组模式。** 浏览区域在上方面板渲染所选的 `Group by` 投影，当 `sectionsActive` 为 true 时，在分隔线下方渲染 Sections 面板。两个面板各自独立滚动。正是这种形态让该功能保持纯增量，它取代了两个被否决的草案。第一个草案让分区投影在存在任何分区时无条件优先，永久隐藏 Workspace、平铺和活动视图。第二个草案把分区作为第五个 `SessionGroupBy` 值放进模式菜单；这恢复了切换能力，但仍把二者呈现为同一位置上互斥的占用者——操作者必须离开 Workspace 列表才能看到分区，而且颜色／图标筛选在分区模式中不得不被屏蔽，因为它针对的是 Workspace 行。

**分区是 Workspace 列表上的已保存视觉筛选，而不是第二个归属关系。** 每个 Chat 都仍位于上方面板的 Workspace 文件夹中；将其归入分区会把它添加到下方面板，而不会从文件夹中移除任何内容。同一个 Chat 同时出现在两个面板中，这正是操作者所说明的模型，也是该面板不渲染「未分组 Chat」分组的原因：未归入分区的 Chat 并没有丢失，它只是位于自己的 Workspace 中。`deriveSections` 仍会返回未分组的剩余部分；面板不渲染它。

因此 `sectionsActive` 只决定面板是否存在——存在任何分区（空分区也算，因为 Chat 落在其标题上）或任何归属——而从不决定显示哪个 Workspace 投影。

**跨面板归入需要显式的拖放通道。** 两个面板是各自拥有私有拖放状态的独立组件，但归入是一个从 Workspace 行开始、在分区标题上结束的手势；任一面板都无法读取另一面板的 React 状态。本包此前的所有拖放都在面板内部，因此树的放置处理程序以自身的 `workspaceDrag` 为前提，对在别处开始的拖放从不触发。`drag-bus.ts` 只发布进行中的 Session id；分区面板订阅它并负责提交归属，而 Workspace 树仍独占自身的重排序，因此一次跨面板放置不会既归入 Chat 又把树切换为手动排序。

**分区标题（而不只是行）也是放置目标。** 放在标题上或该分区块内任意位置的 Chat 都会加入该分区，这是折叠或仍为空的分区的指针操作路径。放在同级 Chat 上会插入到该位置，把分区标题放到另一个标题上会重排分区。拖放是加速方式，而不是唯一途径：Session 行菜单提供 **Move to Section → [name]** 和 **Remove from section**，二者都由悬停菜单和上下文菜单共享的同一个 `sessionMenuItemsFor` 构建，因此两者不会产生分歧。该操作在 Workspace 面板中同样存在，因此可以在 Chat 实际所在的位置归入它。临时**新会话**行的交互规则保持不变——在首条提示词之前，它不可拖动且不归入分区。

**新增字段通过显式 store 步骤迁移。** 该持久化键在没有 `chatSections` 的情况下已经发布，而引擎以整值替换的方式恢复状态，因此对新字段的每次读取都会得到 `undefined`。`StoreSpec.migrate` 是新的 seam：`attachPersistence` 在实例接受解析值之前对其运行迁移，`ui-workspace` 声明 `migrateViewState`，它用 `emptyChatSections()` 填充该层，并逐字段规范化不完整的层。因此在该功能出现之前写入的负载加载后没有分区，所有既有 Session 均未分组——这是明确的兼容性要求，而不是副作用。

## 考虑过的替代方案

**镜像 Workspace 的 Host 持久分区注册表。** 否决，因为它为该功能并不具备的能力付出代价。它会增加一种持久格式、一个 REST／Remote 接口、一个跟随流、第二个排序权威和一套跨机器一致性方案——只为存储一个按浏览器区分的显示偏好。它还会迫使重新讨论需求已明确解决的 Session 归属问题：分区是「零个或一个」，一个映射即可表达，而注册表意味着 Workspace 那种多对多机制。

**把分区作为禁用了环境能力的 Workspace 子类型。** 否决，因为它把环境当作默认、把缺失当作例外。每个 Workspace 消费方——选择器、Session hero、工作目录解析、已删除 Workspace 的重新分配——都需要分区检查，漏掉任何一处都会让分区获得该功能承诺不具备的能力。两个实体除了标题和有序成员列表之外没有共同字段。

**在 Session 记录上存储分区归属。** 否决，因为 Client 并不拥有 Session 记录。`SessionSummary` 是 Host 会话日志的投影；写入其中的浏览器本地标签要么在下一次列表拉取时丢失，要么迫使该标签进入一种唯一消费方只是某个浏览器侧边栏的持久格式。在浏览器已持久化的视图状态旁保留一个映射，是更小且作用域正确的归宿。

**为分区复用 `groupExpansion` 和 Workspace 排序记录。** 否决，因为二者生命周期不同。`retainAccountKeys` 会依据当前 Workspace 列表修剪这些记录；分区记录必须独立于任何 Workspace 存续，而分区保存的 Session 排序以分区 id 而非 Workspace id 为键。共享这些字段会让 Workspace 删除悄无声息地修剪分区状态。

**让分区无条件优先于其他投影。** 实际构建后否决：它破坏了现有导航。只要创建一个分区，Workspace、平铺和活动视图就被永久隐藏，操作者无法再切换视图或按 Workspace 筛选——这是对现有能力的回退，需求明确禁止这一点。堆叠面板在不拿走任何其他投影的前提下提供同样的信息。

**让分区成为第五种 `Group by` 模式。** 实际构建后否决。它消除了上述破坏，但仍让二者成为同一位置上的竞争占用者：查看分区意味着离开 Workspace 列表，而且由于该模式取代了 Workspace 投影，颜色／图标筛选必须在其中被屏蔽——一个现有控件在操作者并未要求的模式中消失。堆叠面板能同时显示二者，并让每个 Workspace 控件保持原位。

**为分区提供嵌套子分区。** 刻意未构建。需求只要求一层，而嵌套会为一项无人要求使用的能力引入树结构、递归渲染路径和更深的归属模型。以 id 为键的状态将来无需更改格式即可接纳它。

## 后果

- 分区层不会随 Session 跟到另一个浏览器、机器或 profile。这是将其排除在 Host 之外的刻意代价，并记录在包 README 的限制中，而不是作为缺陷呈现。
- 分区不会改变 Session 的 Workspace、工作目录、日志、归档状态或搜索参与。搜索仍投影可见的 Session 列表；分区只决定这些行在哪里渲染。
- Workspace 面板在任何情况下都保留其模式、排序和筛选控件：任何分区状态都不能从侧边栏移除现有控件。
- Sections 面板最多占区域的 45%，因此较长的分区列表会自行滚动，而不会把 Workspace 列表挤走；空面板或较短的面板会把其余高度留给 Workspace 列表。
- 本包新增了一个小型跨面板拖放通道（`drag-bus.ts`）。今后任何从一个面板开始、在另一个面板结束的手势都应通过它发布，而不是深入同级组件的状态。
- store 引擎在其持久化路径上新增了 `migrate` 步骤。今后向已发布持久化键添加的任何字段都应在这里自行填充，而不是被读取为缺失。
- `reconcileManualOrder` 被原样复用于分区归属，因此新发现的 Chat 会按最近程度加入其分区而不丢弃已保存的位置，悬空归属则退化为未分组列表，而不会丢失该 Chat。

## 验证

`packages/client/ui-workspace/tests/sections.client.spec.ts` 固定了持久化模式、功能出现之前负载的迁移、不完整层的逐字段降级、每个 Chat 只属于一个分区、移除、删除分区不丢失 Chat、按 id 重命名、重排序、修剪已离开的 Session，以及派生结果的排序、折叠、未分组和悬空归属行为。`tests/chat-sections.client.spec.tsx` 驱动组装后的 `WorkspaceBrowser`，覆盖面板创建、两条移动路径、折叠、拖到标题（包括跨面板手势）、跨分区拖放、分区内重排、标题重排、基于真实 `localStorage` 的重新加载持久化、归入后 Chat 仍在其 Workspace 文件夹中可见、存在分区时每种 `Group by` 模式仍可切换，以及标题 action 顺序和筛选控件在两种状态下均保留。`tests/workspace-browser.client.spec.tsx` 保持未改变的投影通过，并新增旧负载用例；`tests/browser-styles.client.spec.ts` 固定分区块的行节奏、标题 action 上限和 token 使用。`packages/client/store/tests/store.client.spec.ts` 固定持久化路径上的 `migrate`，包括未声明迁移时的运行。`apps/web/tests/chat-sections.e2e.ts` 在 Chromium 中驱动真实组装的 GUI——创建、跨面板拖到标题、折叠、文档重新加载和删除——并断言 Workspace 面板及其视图选项和筛选控件始终存在，且没有控制台错误或警告。
