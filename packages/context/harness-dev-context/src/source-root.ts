import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function isSourceCheckout(root: string): boolean {
  return existsSync(join(root, 'pnpm-workspace.yaml'))
    && existsSync(join(root, 'packages', 'context', 'harness-dev-context', 'package.json'))
}

export function sourceRootContext(root: string): string {
  return isSourceCheckout(root)
    ? `Current DeepSeek Harness implementation checkout: ${JSON.stringify(root)}.`
    : `Current DeepSeek Harness installed distribution (not an editable source checkout): ${JSON.stringify(root)}.`
}
