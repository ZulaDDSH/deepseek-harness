import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const workflow = yaml.load(readFileSync(resolve(import.meta.dirname, '../.github/workflows/build-preview-cloudflare.yml'), 'utf8')) as {
  on: unknown
  permissions: unknown
  concurrency: unknown
  env: Record<string, string>
  jobs: Record<'preview', {
    if: string
    'runs-on': string
    steps: Array<{ name?: string; uses?: string; run?: string; with?: Record<string, unknown>; env?: Record<string, string> }>
  }>
}
const preview = workflow.jobs.preview

describe('PR preview workflow', () => {
  it('keeps human-authored PR builds on the selected GitHub-hosted runner', () => {
    expect(Object.keys(workflow.jobs)).toEqual(['preview'])
    expect(preview.if).toBe("github.event.pull_request.user.type != 'Bot'")
    expect(preview['runs-on']).toBe('ubuntu-24.04')
    expect(workflow.on).toEqual({ pull_request: { types: ['opened', 'synchronize', 'reopened'] } })
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(preview.steps.find(step => step.uses === 'actions/checkout@v7')?.with).toEqual({ 'persist-credentials': false })
  })

  it('keeps the immutable full build and restore-only dependency cache', () => {
    expect(workflow.env.PRIMARY_NODE_VERSION).toBe('24')
    expect(workflow.env.DSH_TELEMETRY_DISABLED).toBe('1')
    const commands = preview.steps.map(step => step.run)
    expect(commands).toContain('pnpm install --frozen-lockfile')
    expect(commands).toContain('pnpm run build')
    expect(commands).toContain('pnpm --filter @deepseek-ai/dsh-web-frontend run build:preview')
    expect(commands.indexOf('pnpm run build')).toBeLessThan(commands.indexOf('pnpm --filter @deepseek-ai/dsh-web-frontend run build:preview'))
    expect(preview.steps.filter(step => step.uses?.startsWith('actions/cache'))).toHaveLength(1)
    expect(preview.steps.find(step => step.uses === 'actions/cache/restore@v6')?.with).toMatchObject({
      key: "${{ runner.os }}-node-${{ env.PRIMARY_NODE_VERSION }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}",
    })
  })

  it('validates and retains a per-PR artifact without deployment credentials or comments', () => {
    expect(workflow.concurrency).toEqual({
      group: 'build-preview-cloudflare-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    })
    const prepare = preview.steps.find(step => step.name === 'Prepare preview artifact')!
    expect(prepare.run).toContain("find apps/web/dist -name '*.map' -delete")
    expect(prepare.run).toContain('cp apps/web/dist/preview.html apps/web/dist/index.html')
    expect(prepare.run).toContain('test -s apps/web/dist/index.html')
    expect(prepare.run).toContain('gzip -t apps/web/dist/preview/vfs-image.tar.gz')
    const upload = preview.steps.find(step => step.name === 'Upload preview artifact')!
    expect(upload).toMatchObject({
      uses: 'actions/upload-artifact@v7',
      with: {
        name: 'pr-${{ github.event.pull_request.number }}-preview',
        path: 'apps/web/dist',
        'if-no-files-found': 'error',
        'retention-days': 7,
      },
    })
    expect(preview.steps.indexOf(prepare)).toBeLessThan(preview.steps.indexOf(upload))
    expect(JSON.stringify(workflow)).not.toMatch(/secrets\.|CLOUDFLARE|CF_ACCESS|CF_PROJECT|wrangler|gh pr comment/)
  })
})
