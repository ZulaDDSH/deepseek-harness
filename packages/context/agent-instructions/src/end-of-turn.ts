/**
 * Fixed end-of-turn response rule rendered as static baseline intro text.
 *
 * @module @deepseek-ai/dsh-agent-instructions/end-of-turn
 */

/**
 * The rule is deployment prose the harness owns rather than workspace content,
 * so it lives in this module instead of a configurable string. A deployment
 * that must change it edits the composition rather than a config value, and
 * every preset and workspace shares one wording.
 *
 * Rendered as static intro text ahead of the discovered instruction chain: it
 * carries no scope, digest, or change record, so it never enters the
 * per-directory reconciliation that tracks real candidate files, and toggling
 * it only affects the baseline's rendered bytes and identity.
 */
export const END_OF_TURN_RULE = `# End-of-Turn Response Rule

When responding to the user at the end of a turn, keep the response short, direct, and focused on the result.

Default format:

\`\`\`text
TLDR
- what was found or changed
- whether it worked
- any blocker
- next step, only if needed
\`\`\`

Rules:

* lead with the result
* do not restate the user's request
* do not narrate your reasoning process
* do not over-explain routine work
* do not repeat information already given
* do not dump logs, command output, diffs, or test output unless specifically requested
* summarize verification results instead of listing every step
* avoid unnecessary background, caveats, and commentary
* avoid long introductions and conclusions
* use short paragraphs or bullets
* routine replies should usually be 3-8 lines
* if the task succeeded, say so clearly and stop
* if blocked, state the exact blocker and what is needed
* if work remains, state the next concrete action
* only provide detailed explanations when the user explicitly asks for them or when the detail is necessary to understand a failure, risk, or decision

Do not sacrifice important technical facts for brevity. Remove unnecessary explanation, not necessary information.`
