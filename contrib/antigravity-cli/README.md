# Antigravity CLI

Install Antigravity CLI (`agy`) and add this optional bundle to your Harness profile. In **Settings → Antigravity accounts**, select **Sign in with Google**, open the browser link, and paste the authorization code. Set the provider's `command` configuration to an absolute path if Harness cannot find `agy` on `PATH`.

## Capabilities

- **ACP + Native MCP tool bridge:** Each interactive Harness session runs a persistent `agy acp --stdio` session in an isolated empty temp directory connected to a per-session authenticated loopback MCP server exposing Harness's active tools. Antigravity built-in tools are denied via ACP permission handling, so **all** file edits, commands, and plugin tools execute exclusively through Harness's own tool runner and permission presets (works in Standard, Ask, Plan, Full access, Master Control, PR Fixer, and Auto Auditor).
- **Streaming & reasoning:** Streams live thinking (`reasoning-delta`), visible text (`text-delta`), and token usage (`inputTokens`, `outputTokens`, `cacheReadTokens`, `reasoningTokens`, `totalTokens`) directly into Harness.
- **Model catalog & effort selector:** Groups effort variants from `agy models` (for example `Gemini 4 Neon` with `Low`, `Medium`, `High`, `Extra` thinking levels) while preserving compatibility with legacy suffixed model IDs.
- **Vision & prompt caching:** Sends Harness image attachments natively (including Auto Auditor Before/After captures and image tool results) and keeps live ACP sessions warm across turns for high prompt-cache hit rates and live model/effort switching.
- **Background & auxiliary calls:** Supports Auto Auditor reviews, session title generation, and compaction summaries via clean ephemeral ACP sessions.
