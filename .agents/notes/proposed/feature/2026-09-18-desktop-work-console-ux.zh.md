# Agent Note: Desktop work console UX

Status: proposed

[English](2026-09-18-desktop-work-console-ux.md) | 中文

## Problem

Electron 外壳已经提供安全的本地应用窗口、原生标题栏、更新处理、恢复流程和经过认证的 Host 代理，但主要工作界面仍像一个信息密集的浏览器树。当前 Workspace 浏览器让用户通过很小的状态点推断 agent 状态，许多行操作只有悬浮后才出现，长 Session 标题会在悬浮时横向滚动，Workspace 文件夹图标也会在悬浮时切换成展开箭头。根布局存储不会保留用户选择的侧栏或右侧面板宽度，也没有统一键盘入口用于切换 Session、Workspace 和命令。桌面端同样不会把审批、问题、完成或失败状态提升为原生注意力提示。

这些问题表明桌面端缺少清晰的工作优先级，而不是缺少另一套 Electron 架构。行为修改应先用聚焦测试记录现状，再替换已验证的问题路径。

当前源码证据：

- `packages/client/ui-workspace/src/client/rows/Rows.tsx` 已派生审批、计划审阅、问题、运行中、子 agent、完成和空闲状态，但普通行主要通过 `StateDot` 呈现主要状态。
- `packages/client/ui-workspace/src/client/rows/Rows.module.css` 会隐藏行操作和 Workspace 展开箭头，并在悬浮时替换文件夹图标、滚动标题。
- `packages/client/ui-layout/src/client/stores.ts` 没有 `persist` 键，而 `packages/client/ui-workspace/src/client/stores.ts` 已经持久化浏览器偏好。
- `packages/client/web/src/boot-page.ts` 只显示通用插件加载文案，虽然桌面启动序列有独立的 Host 和应用阶段。
- `apps/desktop/src/main.ts` 已负责更新的原生注意力提示，但尚未将 agent 注意力投影到桌面通知。
- `packages/client/ui-workspace/src/client/rows/WorkspaceBrowser.tsx`、`Rows.tsx` 和 `apps/desktop/src/main.ts` 都承担多个职责，使聚焦的 UX 修改难以审查。

## Proposal

在保留现有 Electron、Host、客户端插件和 slot 架构的前提下，把桌面产品改造成 agent 工作控制台。

1. 在 Workspace 浏览器中直接显示 Session 注意力状态。
2. 保持展开控件和行操作位置稳定，并用稳定截断替代标题跑马灯。
3. 持久化用户明确选择的布局宽度，同时保持响应式让步状态为瞬时状态。
4. 使用现有布局存储提供专注模式。
5. 为 Session、Workspace 和现有命令提供 `Ctrl/Cmd+K` 切换器。
6. 增加按需要处理、运行中和最近完成分组的活动视图。
7. 对审批、问题、计划审阅、完成和失败转换发送桌面通知。
8. 让桌面启动页显示本地运行时、应用加载和插件加载阶段。
9. 仅在功能边界清晰时拆分大型 Workspace 浏览器和 Electron 主进程文件。

该方案复用现有 Session 状态派生、slot 系统、布局存储、命令包、Electron preload 模型和更新注意力机制，不引入第二套 UI 框架或桌面状态模型。

## Staging

该 PR 在一个 Draft 分支中按可审查的小阶段推进：

1. 建立基线测试和行状态清晰度。
2. 处理布局持久化与专注模式。
3. 加入命令切换器和活动视图。
4. 加入桌面通知。
5. 加入启动阶段。
6. 执行完成行为所需的文件拆分。
7. 执行 exact-head 验证和视觉检查。

每一步都必须保留前一步的可追踪行为，且不能顺带改写无关的更新、签名、Host 认证或恢复逻辑。

## Alternatives considered

**围绕桌面专用 UI 重写 Electron 应用。** 放弃，因为现有客户端插件、slot、Session 状态和布局系统已经提供所需状态与行为。第二套 UI 栈会重复路由、可访问性、本地化和状态所有权。

**只保留现有侧栏并做视觉美化。** 放弃，因为主要问题是信息优先级和交互成本，而不是颜色或间距。依赖悬浮和仅颜色状态点的问题仍然存在。

**为活动和通知建立独立桌面状态模型。** 放弃，因为统一 Session 状态投影已经拥有运行、待处理交互和完成信息。桌面功能应消费该投影，而不是维护第二个事实源。

## Acceptance criteria

- 需要审批、回答或计划审阅的 Session 无需悬浮即可识别。
- 运行中的 Session 无需解释纯颜色状态点即可识别。
- Workspace 展开控件保持可见，不再与文件夹图标因悬浮互换。
- 长 Session 名称在悬浮时保持稳定，并可查看完整文本。
- 用户选择的侧栏和右侧面板宽度可跨刷新保留。
- 专注模式进出时不会丢失当前 Session 或保存的面板宽度。
- `Ctrl/Cmd+K` 打开统一的 Session、Workspace 和命令搜索表面。
- 活动视图区分需要处理、运行中和最近完成的工作。
- 桌面通知只在有意义的状态转换时触发。
- 桌面启动显示有意义的阶段，并保留现有失败恢复路径。
- 修改后的源码文件保持职责集中。
- 聚焦测试覆盖每项行为修改，之后运行 GUI、Web replay、相关 Desktop 测试和 exact-head 验证。

## Risks

- 如果持久化布局把响应式瞬时状态一起保存，可能恢复过期几何状态。
- 平台特定标题栏可能让专注模式隐藏唯一退出入口。
- 如果普通刷新被当成状态转换，活动与通知会产生噪音。
- 如果命令切换器通过 composer 实现，可能覆盖未发送草稿或抢走输入焦点。
- 在修改行为的同时拆分大型文件可能掩盖回归。
