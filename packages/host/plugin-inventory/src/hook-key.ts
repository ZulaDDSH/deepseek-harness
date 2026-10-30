/** Command hook identity shared by the hook protocol and the external hook-file inventory. */

/** Identify one command hook across reloads.
 * @param event Hook event name.
 * @param matcher Selecting matcher, when the group has one.
 * @param command Command after substitution.
 * @returns The key stored in a bridge's `enabledHooks` setting.
 */
export function hookKey(event: string, matcher: string | undefined, command: string): string {
  return JSON.stringify([event, matcher ?? null, command])
}
