
## packages/client/ui-subagent/src/client/sidebar-chat/index.tsx:SidebarChatTab

Finding 182. When the chat resource provider threw, the registry now publishes a `failed` snapshot with `failure` set, but the tab body only checked `resource.value === undefined` and drew an empty pane, so a failed open looked like a tab that never finished loading. The body now draws `failure.message` in a `role="alert"` block when the resource has no value and has failed. A failure that follows a value keeps the last conversation visible, as the resource contract keeps the last value through a failure frame.
