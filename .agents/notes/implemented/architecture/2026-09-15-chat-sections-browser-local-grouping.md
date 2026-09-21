# Agent Note: Chat Sections as a browser-local organization layer

Status: implemented

English | [中文](2026-09-15-chat-sections-browser-local-grouping.zh.md)

## Problem

The sidebar could only group Sessions by Workspace. `ClientWorkspaceModel.sessionIds` is Host-durable membership that also selects a Session's working directory, and the browser's `Group by` modes (Workspace, Workspace tree, flat, activity) all re-project that one membership. A user who wanted to keep "Code Review" and "Research" beside each other had no way to say so: registering a Workspace would have changed the Session's `cwd`, which is not what they were asking for.

The obvious reading of the request is a second grouping entity next to Workspaces. That reading is wrong for the requirement, and the reason is the capability seam: a Workspace is not a grouping label but an environment — it supplies instructions, files, agent configuration, and a working directory. Anything that reused `WorkspaceView` would inherit those semantics, and anything that added a parallel durable registry would have to answer, per capability, whether a Section carries it. The requirement states explicitly that Sections carry none of them.

What remained was a placement question: where does a pure label-plus-membership layer live, and does it need the Host at all?

## Decision

**Chat Sections are one field of the browser's persisted view state, not a Host entity.** `stores.ts` declares `chatSections` inside the same `dsh.workspace.view.v5` value that already holds group expansion and manual Session order: `sections` (id plus name, in display order), `collapse` per section, `members` (Session id → section id), and `sectionOrder` per section. Nothing about the layer crosses the wire, and `ctx.workspaces` is untouched.

The persistence medium follows the fact. A Section is a display preference over Sessions the user can already see; it is not authoritative business state, and making it durable would require a Host registry, a stream, migration policy for a second durable format, and a decision about what a Section means to a headless run. None of that is earned by "group these two Chats together," and the existing view store already owns exactly this kind of fact.

**Assignments reference generated section ids, never names.** `newSectionId` mints through `crypto.randomUUID()` on the Client and reaches the browser through the injected face, alongside the other action callbacks. Renaming a Section therefore rebinds nothing, and two Sections may share a name without becoming the same entity. A Session belongs to at most one Section: `assignSession` removes it from its previous section before inserting it at the head of the target, and the ungrouped case deletes the membership outright.

**Deleting a Section deletes only the grouping.** `deleteSection` removes the section record, its collapse flag, its saved order, and every assignment that named it; the Sessions keep their logs, Workspace membership, and order accounts and reappear in the ungrouped list. This is the same retention boundary Workspace deletion already states, and it is what makes the destructive verb safe without a data-loss warning.

**Sections is a fifth `SessionGroupBy` value, not an override.** `SessionGroupBy` gains `'sections'` beside `'workspace'`, `'workspace-tree'`, `'flat'`, and `'activity'`, so `ViewOptionsMenu` carries it and the existing stored preference selects it. This is the shape that keeps the feature additive: an earlier draft had the section projection take unconditional precedence whenever `sectionsActive` was true, which meant creating one section permanently hid the Workspace, flat, and activity views — the operator could no longer switch to or filter by Workspace at all. Making it a mode removes that failure by construction, because no projection can displace another.

`sectionsActive` therefore decides only whether the section projection has anything to render, never whether it wins: an empty Section still counts, because its header is where Chats land, but an empty mode is just an empty list. `New section` selects the mode rather than switching the region behind the operator's back — that gesture is an explicit request to organize Chats — and every other mode stays one menu pick away with the layer untouched.

**Section headers, not only rows, are drop targets.** A Chat dropped on a header or anywhere in that Section's block joins it, which is the pointer path for a collapsed or still-empty Section. Chats dropped on a sibling insert at that position; Chats dropped in the ungrouped area leave their Section; a Section header dropped on another reorders Sections. Drag is an accelerator, never the only route: the Session row menu carries **Move to Section → [name]** and **Remove from section**, both built by the same `sessionMenuItemsFor` the hover menu and the context menu share, so the two cannot diverge. The interaction rules for the provisional New Session row are unchanged — it stays undraggable and ungrouped until its first prompt.

**The added field migrates through an explicit store step.** The persist key had already shipped without `chatSections`, and the engine rehydrates by whole-value replacement, so every read of the new field would have seen `undefined`. `StoreSpec.migrate` is the new seam: `attachPersistence` runs it on the parsed value before the instance accepts it, and `ui-workspace` declares `migrateViewState`, which fills the layer from `emptyChatSections()` and normalizes a partial layer field by field. A payload written before the feature existed therefore loads with zero Sections and every pre-existing Session ungrouped, which is the stated compatibility requirement rather than a side effect.

## Alternatives considered

**A Host-durable Section registry mirroring Workspaces.** Rejected because it pays for capability the feature does not have. It would add a durable format, a REST/Remote surface, a follow stream, a second ordering authority, and a cross-machine consistency story — to store what is a per-browser display preference. It would also force the Session-membership question the requirement explicitly settles: a Section is "zero or one," stateable in one map, whereas a registry implies the Workspace-shaped many-to-many machinery.

**Sections as a Workspace subtype with the environment capabilities disabled.** Rejected because it makes the environment the default and absence the exception. Every Workspace consumer — the picker, the Session hero, the working-directory resolution, the deleted-Workspace reassignment — would need a Section check, and any missed one would give a Section a capability the feature promises it does not have. The two entities share no field besides a title and an ordered member list.

**Store Section membership on the Session record.** Rejected because the Client does not own Session records. A `SessionSummary` is a projection of the Host's session log; a browser-local label written onto it would either be lost on the next list pull or force the label into a durable format whose only consumer is one browser's sidebar. Keeping one map beside the view state the browser already persists is the smaller, correctly-scoped home.

**Reuse `groupExpansion` and the Workspace order accounts for Sections.** Rejected because the lifetimes differ. `retainAccountKeys` prunes those records against the live Workspace list; Section records must survive independently of any Workspace, and a Section's saved Session order is keyed by section id, not by Workspace id. Sharing the fields would have made Workspace deletion silently prune Section state.

**Give Sections unconditional precedence over the other projections.** Rejected after building it: it made the feature destructive of existing navigation. Creating a single Section hid the Workspace, flat, and activity views for good, so the operator could no longer switch views or filter by Workspace — a regression in an existing capability, which the requirement explicitly forbids. A mode makes the same information available without taking any other projection away, and the operator's own gesture (which mode they last picked) decides what they see.

**Give Sections nested sub-sections.** Deliberately not built. The requirement asks for one level, and nesting would put a tree structure, a recursive render path, and a deeper membership model behind a capability nothing has asked to use. The id-keyed state would accept it later without a format change.

## Consequences

- The section layer does not follow a Session to another browser, machine, or profile. That is the deliberate cost of keeping it out of the Host, and it is recorded in the package README's limitations rather than presented as a defect.
- A Section changes nothing about a Session's Workspace, working directory, log, archived state, or search participation. Search still projects the visible Session list; Sections only decide where those rows render.
- Every existing projection stays selectable while sections exist, so `Group by` remains the single control over what the sidebar shows and no feature can take another view away from the operator.
- The store engine gained a `migrate` step on its persistence path. Any future field added to an already-shipped persist key is now expected to fill itself here rather than read as absent.
- `reconcileManualOrder` is reused verbatim for Section membership, so a newly discovered Chat joins its Section by recency without discarding saved positions, and a dangling assignment degrades to the ungrouped list rather than dropping the Chat.

## Verification

`packages/client/ui-workspace/tests/sections.client.spec.ts` pins the persisted schema, the pre-feature payload migration, field-by-field degradation of a partial layer, one-section-per-Chat, removal, deletion without Chat loss, rename by id, reordering, pruning of departed Sessions, and the derivation's ordering, collapse, ungrouped, and dangling-assignment behavior. `tests/chat-sections.client.spec.tsx` drives the assembled `WorkspaceBrowser` through creation, both move paths, collapse, drag-to-header, cross-section drag, in-section reorder, drag-to-ungrouped, header reorder, reload persistence against real `localStorage`, and a regression case that picks all four other `Group by` modes while sections exist and returns to Sections. `tests/workspace-browser.client.spec.tsx` keeps the unchanged projections green and adds the legacy-payload case; `tests/browser-styles.client.spec.ts` pins the section block's row rhythm and token use. `packages/client/store/tests/store.client.spec.ts` pins `migrate` on the persistence path, including running with none declared. `apps/web/tests/chat-sections.e2e.ts` drives the real assembled GUI in Chromium — create, switch to WorkSpace and back while sections exist, real HTML5 drag onto a header, collapse, document reload, menu-based remove and move, rename, and delete — and asserts no console errors or warnings.
