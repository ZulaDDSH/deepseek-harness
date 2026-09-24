import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const runnerPrivatePnpmDestination = /^\$\{\{ runner\.temp \}\}\/setup-pnpm-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/
const nativeWindowsPnpmDestination = '${{ runner.temp }}/setup-pnpm-js-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}'

describe('CI workflow', () => {
  it('requires unit, artifact, and changed-package coverage gates', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const artifacts = workflowJob(workflow, 'node-24-artifacts')
    const coverage = workflowJob(workflow, 'node-24-coverage')
    const consumers = workflowJob(workflow, 'node-24-consumers')
    const scope = workflowJob(workflow, 'change-scope')
    const aggregate = workflowJob(workflow, 'all-checks-passed')
    if (!Array.isArray(aggregate.steps)) throw new TypeError('CI aggregate must define steps')
    expect(aggregate.needs).toEqual(expect.arrayContaining([
      'node-24-artifacts', 'node-24-coverage', 'node-24-consumers',
    ]))
    expect(artifacts.steps).toContainEqual(expect.objectContaining({ run: 'pnpm run check:ci:artifacts' }))
    expect(coverage.steps).toContainEqual(expect.objectContaining({ run: 'pnpm run check:ci:coverage' }))
    expect(coverage['continue-on-error']).not.toBe(true)
    expect(coverage.needs).toContain('change-scope')
    expect(consumers['continue-on-error']).not.toBe(true)
    expect(consumers.if).toContain("needs.change-scope.outputs.run-consumers == 'true'")
    const verdict: unknown = aggregate.steps[0]
    if (!isRecord(verdict) || typeof verdict.if !== 'string' || typeof verdict.run !== 'string') {
      throw new TypeError('CI aggregate verdict step must define string if and run fields')
    }
    expect(verdict.if).toContain("contains(needs.*.result, 'failure')")
    expect(verdict.run).toContain('exit 1')
    expect(JSON.stringify(scope.steps)).toContain("!path.endsWith('/package.json')")
    expect(JSON.stringify(workflow)).not.toMatch(/DSH_ISSUE_APP_PRIVATE_KEY|DEEPSEEK_API_KEY|CLOUDFLARE_API_TOKEN/)
  })

  it('keeps fork pull request checks on hosted runners without upstream credentials', () => {
    for (const file of ['ci.yml', 'release.yml', 'release-vendor.yml', 'expected-filenames.yml', 'node-addon-system.yml']) {
      const workflow = loadWorkflow('.github/workflows/' + file)
      expect(JSON.stringify(workflow)).not.toMatch(/self-hosted|blacksmith|DSH_CI_FAILOVER|dsh-(?:ubuntu|windows)/i)
    }
    const ci = loadWorkflow('.github/workflows/ci.yml')
    expect(JSON.stringify(ci)).not.toMatch(/DEEPSEEK_API_KEY|CLOUDFLARE_API_TOKEN|DSH_ISSUE_APP_PRIVATE_KEY|NPM_TOKEN/)
    for (const file of ['release.yml', 'release-vendor.yml']) {
      const workflow = loadWorkflow('.github/workflows/' + file)
      if (!isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      for (const job of Object.values(workflow.jobs)) {
        if (!isRecord(job)) throw new TypeError(`${file} jobs must be records`)
        expect(job['runs-on']).toBe('ubuntu-latest')
      }
    }
  })

  it('prepares confinement before Node compatibility smokes', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-compat')
    if (!Array.isArray(job.steps)) throw new TypeError('Node compatibility job must define steps')
    const steps = job.steps.filter(isRecord)
    const preparation = steps.findIndex(step => step.run === 'bash scripts/prepare-ci-bubblewrap.sh')
    const smoke = steps.findIndex(step => step.run === 'pnpm run check:node-compat')
    expect(preparation).toBeGreaterThanOrEqual(0)
    expect(smoke).toBeGreaterThan(preparation)
    expect(steps[preparation]).not.toHaveProperty('continue-on-error', true)
  })

  it('prepares confinement before built package smokes', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-24-artifacts')
    if (!Array.isArray(job.steps)) throw new TypeError('Node artifact job must define steps')
    const steps = job.steps.filter(isRecord)
    const preparation = steps.findIndex(step => step.run === 'bash scripts/prepare-ci-bubblewrap.sh')
    const smoke = steps.findIndex(step => step.run === 'pnpm run check:ci:artifacts')
    expect(preparation).toBeGreaterThanOrEqual(0)
    expect(smoke).toBeGreaterThan(preparation)
    expect(steps[preparation]).not.toHaveProperty('continue-on-error', true)
  })

  it.each(['ci.yml', 'ci-master.yml', 'release.yml', 'release-vendor.yml'])(
    '%s cancels superseded validation runs without crossing workflow or ref boundaries', (name) => {
      const workflow = loadWorkflow('.github/workflows/' + name)
      expect(workflow.concurrency).toEqual({
        group: name === 'ci.yml'
          ? '${{ github.workflow }}-${{ github.ref }}-${{ github.event_name }}'
          : '${{ github.workflow }}-${{ github.ref }}',
        'cancel-in-progress': true,
      })
    },
  )

  it('cancels reusable CI builds without cancelling release-owned builds', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(workflow.concurrency).toEqual({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': '${{ !inputs.release }}',
    })
  })

  it('does not cancel protected publication or deployment transactions', () => {
    for (const name of ['release-publish.yml', 'release-vendor-publish.yml']) {
      const publish = workflowJob(loadWorkflow('.github/workflows/' + name), 'publish')
      expect(publish.concurrency).toMatchObject({ 'cancel-in-progress': false })
    }
    for (const name of ['python-release.yml', 'node-addon-system-release.yml', 'docs-pages.yml']) {
      expect(loadWorkflow('.github/workflows/' + name).concurrency).toMatchObject({ 'cancel-in-progress': false })
    }
  })

  it('isolates every pnpm action setup destination per runner', () => {
    const files = ['.github/workflows/ci.yml', '.github/workflows/ci-master.yml']
    const setups: Array<{ jobName: string; step: unknown }> = []
    for (const file of files) {
      const workflow: unknown = yaml.load(readFileSync(resolve(root, file), 'utf8'))
      if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (!isRecord(job) || !Array.isArray(job.steps)) continue
        for (const step of job.steps) {
          if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
          setups.push({ jobName, step })
        }
      }
    }

    expect(setups.length).toBeGreaterThan(0)
    for (const { jobName, step } of setups) {
      const stepDest = (step as { with?: { dest?: unknown } }).with?.dest
      if (jobName.startsWith('windows-')) {
        expect(stepDest, `${jobName} must use the native Windows pnpm destination`).toBe(nativeWindowsPnpmDestination)
        expect(step).not.toMatchObject({ with: { standalone: true } })
      } else {
        expect(typeof stepDest, `${jobName} must use a runner-and-run-private pnpm destination`).toBe('string')
        expect(stepDest as string).toMatch(runnerPrivatePnpmDestination)
      }
    }
  })

  it.each(['node-24', 'node-24-coverage', 'node-24-consumers'])(
    '%s keeps tool and fixture temporary files under runner cleanup',
    (jobName) => {
      const job = workflowJob(loadWorkflow('.github/workflows/ci.yml'), jobName)
      if (!Array.isArray(job.steps)) throw new TypeError(`${jobName} must define steps`)
      expect(job.steps[0]).toEqual({
        name: 'Use runner-owned temporary storage',
        run: [
          'echo "TMPDIR=${{ runner.temp }}" >> "$GITHUB_ENV"',
          ...(jobName === 'node-24-consumers'
            ? ['echo "PLAYWRIGHT_BROWSERS_PATH=${RUNNER_TEMP%/*}/ms-playwright" >> "$GITHUB_ENV"']
            : []),
          '',
        ].join('\n'),
      })
      if (jobName === 'node-24-consumers') {
        const browserCache: unknown = job.steps.find(step => isRecord(step) && isRecord(step.with)
          && step.with.path === '${{ env.PLAYWRIGHT_BROWSERS_PATH }}')
        expect(browserCache).toMatchObject({ uses: 'actions/cache/restore@v4' })
      }
      const store: unknown = job.steps.find(step => isRecord(step) && step.name === 'Configure pnpm store path')
      expect(store).toMatchObject({
        run: [
          'store_root="$HOME/.local/share/pnpm/store"',
          'echo "PNPM_CONFIG_STORE_DIR=$store_root" >> "$GITHUB_ENV"',
          'store_path=$(PNPM_CONFIG_STORE_DIR="$store_root" pnpm store path --silent)',
          'echo "path=$store_path" >> "$GITHUB_OUTPUT"',
          '',
        ].join('\n'),
      })
      for (const step of job.steps) {
        if (isRecord(step) && isRecord(step.env)) {
          expect(step.env.TMPDIR).toBeUndefined()
          expect(step.env.npm_config_cache).toBeUndefined()
        }
      }
    },
  )

  it('isolates the python SDK exe pnpm setup destination per job', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/build-exe-for-python-sdk.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError('build-exe-for-python-sdk.yml must define jobs')
    const setups: Array<{ step: unknown }> = []
    for (const job of Object.values(workflow.jobs)) {
      if (!isRecord(job) || !Array.isArray(job.steps)) continue
      for (const step of job.steps) {
        if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
        setups.push({ step })
      }
    }
    expect(setups.length).toBeGreaterThan(0)
    for (const { step } of setups) {
      expect(step).toMatchObject({
        with: { dest: nativeWindowsPnpmDestination },
      })
    }
  })

  it('keeps hosted Windows validation required and post-merge runtime targets keyless', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const master = loadWorkflow('.github/workflows/ci-master.yml')
    const build = workflowJob(workflow, 'windows-build')
    const native = workflowJob(workflow, 'windows-native-tests')
    const aggregate = workflowJob(workflow, 'all-checks-passed')
    expect(build['runs-on']).toContain('windows-2025')
    expect(native['runs-on']).toContain('windows-2025')
    expect(aggregate.needs).toEqual(expect.arrayContaining(['windows-build', 'windows-native-tests']))
    expect(JSON.stringify([workflow, master])).not.toMatch(/DEEPSEEK_API_KEY|CLOUDFLARE_API_TOKEN|DSH_ISSUE_APP_PRIVATE_KEY/)
    expect(Object.keys(master.on as Record<string, unknown>)).toEqual(['push'])
    expect(Object.keys(master.jobs as Record<string, unknown>)).toEqual(['python-runtime'])
  })
  it('keeps performance measurements manual and outside the PR verdict', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const benchmark = workflowJob(workflow, 'node-24-bench')
    const aggregate = workflowJob(workflow, 'all-checks-passed')
    expect(Object.keys(workflow.on as Record<string, unknown>)).toEqual(['pull_request', 'workflow_dispatch'])
    expect(benchmark.if).toBe("github.event_name == 'workflow_dispatch'")
    expect(benchmark['continue-on-error']).toBe(true)
    expect(aggregate.needs).not.toContain('node-24-bench')
  })
  it('gives the Wine Host TypeScript compile the repository heap budget', () => {
    const wineGates = readFileSync(resolve(root, 'scripts/wine-windows-gates.sh'), 'utf8')

    expect(wineGates).toContain(
      'wine_node "$scratch/logs/host-tsc.log" --max-old-space-size=4096 "$tsc_js" -b tsconfig.host.json --pretty false',
    )
  })

  it('keeps post-merge runtime coverage on hosted GitHub platforms', () => {
    const workflow = loadWorkflow('.github/workflows/ci-master.yml')
    const job = workflowJob(workflow, 'python-runtime')
    expect(workflow.concurrency).toMatchObject({ 'cancel-in-progress': true })
    expect(job.uses).toBe('./.github/workflows/build-exe-for-python-sdk.yml')
    expect(job.with).toEqual({ targets: 'node24-linux-arm64,node24-macos-arm64,node24-macos-x64', ci: true })
    expect(workflow.on).toHaveProperty('push')
    expect(JSON.stringify(workflow)).not.toMatch(/DEEPSEEK_API_KEY|self-hosted|dsh-ubuntu|dsh-windows/)
  })
  it('redirects the Node compile cache to the data-volume runner temp before the first pnpm call', () => {
    const prWorkflow = loadWorkflow('.github/workflows/ci.yml')
    const redirectLanes = [
      [prWorkflow, 'node-24'],
      [prWorkflow, 'node-24-coverage'],
      [prWorkflow, 'node-24-consumers'],
    ] as const
    for (const [workflow, jobKey] of redirectLanes) {
      const job = workflowJob(workflow, jobKey)
      if (!Array.isArray(job.steps)) throw new TypeError(`${jobKey} must define steps`)
      const redirectStepIndex = job.steps.findIndex((step): step is Record<string, unknown> & { run: string } => (
        isRecord(step) && typeof step.run === 'string'
          && step.run.includes('NODE_COMPILE_CACHE=${{ runner.temp }}/node-compile-cache')
          && step.run.includes('"$GITHUB_ENV"')
      ))
      // Removing this injection would send every pnpm call in the lane (setup,
      // store-path probe, install, and the gate) back to the root partition's
      // /tmp; rationale in
      // .agents/notes/implemented/process/2026-08-28-ci-node-compile-cache-data-disk.md.
      expect(redirectStepIndex, `${jobKey} must inject NODE_COMPILE_CACHE into GITHUB_ENV`).toBeGreaterThan(-1)
      const pnpmSetupIndex = job.steps.findIndex((step): step is Record<string, unknown> & { uses: string } => (
        isRecord(step) && typeof step.uses === 'string' && step.uses.includes('pnpm/action-setup')
      ))
      expect(pnpmSetupIndex, `${jobKey} must run pnpm/action-setup`).toBeGreaterThan(-1)
      expect(redirectStepIndex, `${jobKey} must redirect before pnpm/action-setup runs pnpm`).toBeLessThan(pnpmSetupIndex)
    }
  })

  it('keeps supported LSP source under native Windows coverage', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
  })

  it('requires release-shaped Python runtime validation on Linux and Windows x64', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const pythonRuntime = workflowJob(workflow, 'python-runtime')
    const aggregate = workflowJob(workflow, 'all-checks-passed')
    if (!Array.isArray(aggregate.needs)) {
      throw new TypeError('CI aggregate must define required job dependencies')
    }

    expect(pythonRuntime).toMatchObject({
      if: "github.event_name == 'pull_request'",
      name: 'python runtime / release-shaped matrix',
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64,node24-win-x64',
        ci: true,
      },
    })
    expect(aggregate.needs).toContain('python-runtime')
  })

  it('keeps every Vitest project process-isolated on native Windows', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
    expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
  })
})

describe('Python runtime hosted runners', () => {
  it('keeps every runtime build on the declared GitHub-hosted platform', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(workflowJob(workflow, 'plan')['runs-on']).toBe('ubuntu-latest')
    expect(workflowJob(workflow, 'sdk-wheel')['runs-on']).toBe('ubuntu-latest')
    const build = workflowJob(workflow, 'build')
    expect(build['runs-on']).toBe('${{ matrix.runner }}')
    expect(JSON.stringify(workflow)).not.toMatch(/DSH_CI_FAILOVER|blacksmith|self-hosted/)
  })
})
describe('Python release workflows', () => {
  it('keeps complete wheel validation separate from protected public publication', () => {
    const workflow = loadWorkflow('.github/workflows/python-release.yml')
    const dispatch = workflowEvent(workflow, 'workflow_dispatch')
    const build = workflowJob(workflow, 'build')
    const pythonCompat = workflowJob(workflow, 'python-compat')
    const validate = workflowJob(workflow, 'validate')
    const publishRuntime = workflowJob(workflow, 'publish-runtime')
    const publishSdk = workflowJob(workflow, 'publish-sdk')
    if (!isRecord(dispatch.inputs)
      || !isRecord(dispatch.inputs.publish)
      || !Array.isArray(pythonCompat.steps)
      || !Array.isArray(validate.steps)
      || !Array.isArray(publishRuntime.steps)
      || !Array.isArray(publishSdk.steps)) {
      throw new TypeError('Python release workflow must define publish input and release steps')
    }

    expect(dispatch.inputs.publish).toMatchObject({ type: 'boolean', default: false })
    if (!isRecord(workflow.on)) throw new TypeError('python-release workflow must define on')
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(build).toMatchObject({
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64,node24-linux-arm64,node24-macos-arm64,node24-macos-x64,node24-win-x64',
        release: true,
      },
    })
    expect(pythonCompat.strategy).toMatchObject({ matrix: { python: ['3.10', '3.14'] } })
    const pythonCompatSteps = JSON.stringify(pythonCompat.steps)
    expect(pythonCompatSteps).toContain('dist/deepseek_harness_sdk-$VERSION-py3-none-any.whl')
    expect(pythonCompatSteps).toContain('dist/deepseek_harness_runtime_bin-$VERSION-py3-none-manylinux_2_28_x86_64.whl')
    expect(pythonCompatSteps).not.toContain('--find-links')
    const validateSteps = JSON.stringify(validate.steps)
    const authorize = validate.steps.filter(isRecord).find(step => step.name === 'Authorize publication request')
    if (!isRecord(authorize) || typeof authorize.run !== 'string') {
      throw new TypeError('Python release validation must authorize publication requests')
    }
    expect(validateSteps).toContain('PUBLIC_PYPI_RELEASE_ENABLED')
    expect(authorize).toMatchObject({
      env: {
        PYPI_PUBLISHER_REPOSITORY: '${{ vars.PYPI_PUBLISHER_REPOSITORY }}',
        REPOSITORY: '${{ github.repository }}',
      },
    })
    expect(authorize.run).toContain('[ "$REPOSITORY" = "$PYPI_PUBLISHER_REPOSITORY" ]')
    expect(validateSteps).toContain('100000000')
    expect(publishRuntime).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.publish",
      needs: 'validate',
      environment: 'pypi-runtime',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    expect(publishSdk).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.publish",
      needs: ['validate', 'publish-runtime'],
      environment: 'pypi',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    const runtimeSteps = publishRuntime.steps.filter(isRecord)
    const sdkSteps = publishSdk.steps.filter(isRecord)
    const runtimePublish = runtimeSteps.find(step => step.name === 'Publish runtime wheels')
    const sdkPublish = sdkSteps.find(step => step.name === 'Publish SDK wheel')
    const runtimeHashes = runtimeSteps.find(step => step.name === 'Verify release artifact hashes')
    const sdkHashes = sdkSteps.find(step => step.name === 'Verify release artifact hashes')
    expect([...runtimeSteps, ...sdkSteps].some(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )).toBe(false)
    expect([...runtimeSteps, ...sdkSteps].filter(
      step => step.uses === 'pypa/gh-action-pypi-publish@release/v1',
    )).toHaveLength(2)
    expect(runtimePublish).toMatchObject({
      with: { 'packages-dir': 'dist/runtime/', attestations: false },
    })
    expect(sdkPublish).toMatchObject({
      with: { 'packages-dir': 'dist/sdk/', attestations: false },
    })
    expect(runtimeHashes).toMatchObject({ run: 'cd dist && sha256sum -c SHA256SUMS' })
    expect(sdkHashes).toMatchObject({ run: 'cd dist && sha256sum -c SHA256SUMS' })
  })

  it('exposes the native wheel builder to the release caller with normalized versions', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(Object.keys(workflow.on as Record<string, unknown>).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
    const call = workflowEvent(workflow, 'workflow_call')
    const plan = workflowJob(workflow, 'plan')
    const build = workflowJob(workflow, 'build')
    if (!isRecord(call.inputs) || !Array.isArray(plan.steps) || !Array.isArray(build.steps)) {
      throw new TypeError('Python wheel builder must define workflow_call inputs and plan steps')
    }

    const buildSteps: unknown[] = build.steps
    const manylinuxAddon = buildSteps.find(step => isRecord(step) && step.name === 'Rebuild Linux node-pty against manylinux 2.28')
    const macosCheck = buildSteps.find(step => isRecord(step) && step.name === 'Check macOS payload architecture and deployment target')
    const manylinuxSmoke = buildSteps.find(step => isRecord(step) && step.name === 'Run wheel in a manylinux 2.28 container')
    const cleanVenvPosix = buildSteps.find(step => isRecord(step) && step.name === 'Install local SDK and runtime wheels into a clean venv (POSIX)')
    const cleanVenvWindows = buildSteps.find(step => isRecord(step) && step.name === 'Install local SDK and runtime wheels into a clean venv (Windows)')
    const installedKeylessPosix = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel keyless black-box tests (POSIX)')
    const installedKeylessWindows = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel keyless black-box tests (Windows)')
    if (!isRecord(macosCheck) || typeof macosCheck.run !== 'string'
      || !isRecord(cleanVenvPosix) || !isRecord(cleanVenvWindows)
      || !isRecord(installedKeylessPosix) || !isRecord(installedKeylessWindows)) {
      throw new TypeError('Python wheel builder must define native POSIX and Windows installed-wheel steps')
    }
    expect(call.inputs).toHaveProperty('targets')
    expect(call.inputs).toMatchObject({
      ci: { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
    })
    expect(call.secrets).toBeUndefined()
    expect(workflow.concurrency).toMatchObject({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
    })
    expect(build.defaults).toBeUndefined()
    expect(plan.if).toContain('inputs.ci')
    expect(plan.if).toContain('inputs.release')
    expect(JSON.stringify(plan.steps)).toContain('pep440_version')
    const workflowJson = JSON.stringify(workflow)
    expect(workflowJson).toContain('macosx_14_0_arm64')
    expect(workflowJson).toContain('macosx_14_0_x86_64')
    expect(workflowJson).toContain('node24-macos-x64')
    expect(workflowJson).toContain('macos-15-intel')
    expect(workflowJson).toContain('win_amd64')
    expect(workflowJson).toContain('node24-win-x64')
    expect(workflowJson).toContain('windows-2025')
    expect(workflowJson).toContain('dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).not.toContain('--find-links dist-python')
    expect(workflowJson).not.toContain('--find-links /work/dist-python')
    expect(workflowJson).not.toContain('cygpath')
    expect(manylinuxAddon).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_x86_64')
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_aarch64')
    expect(JSON.stringify(manylinuxAddon)).toContain('npm_config_build_from_source=true pnpm run install')
    expect(JSON.stringify(manylinuxAddon)).toContain('pnpm_setup_root')
    expect(JSON.stringify(manylinuxAddon)).toContain('$pnpm_setup_root:$pnpm_setup_root:ro')
    expect(JSON.stringify(manylinuxAddon)).toContain('node-pty-glibc-versions.txt')
    expect(JSON.stringify(manylinuxAddon)).toContain('le 2.28')
    expect(macosCheck).toMatchObject({ if: "runner.os == 'macOS'" })
    expect(macosCheck.run).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck.run).toContain('lipo "$payload" -verify_arch')
    expect(macosCheck.run).toContain('$EXE-rg')
    expect(macosCheck.run).toContain('$EXE-spawn-helper')
    expect(JSON.stringify(installedKeylessPosix)).toContain('--scenario all')
    expect(JSON.stringify(installedKeylessPosix)).toContain('env -u PYTHONPATH')
    expect(JSON.stringify(installedKeylessWindows)).toContain('--scenario all --installed-wheel')
    expect(installedKeylessWindows).toMatchObject({ if: "runner.os == 'Windows'", shell: 'pwsh' })
    expect(cleanVenvWindows).toMatchObject({ if: "runner.os == 'Windows'", shell: 'pwsh' })
    expect(JSON.stringify(cleanVenvWindows)).toContain('Scripts\\\\python.exe')
    expect(manylinuxSmoke).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxSmoke)).toContain('-e DSH_TELEMETRY_DISABLED')
  })

  it('uses the shared macOS deployment-target check in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const runtimeWheel = workflow['.runtime-wheel']
    if (!isRecord(runtimeWheel) || !Array.isArray(runtimeWheel.script)) {
      throw new TypeError('GitLab CI must define the runtime wheel script')
    }
    const runtimeScript: unknown[] = runtimeWheel.script
    const macosCheck = runtimeScript.find(
      step => typeof step === 'string' && step.includes('${PLATFORM#macos-}'),
    )
    if (typeof macosCheck !== 'string') {
      throw new TypeError('GitLab CI must check the macOS deployment target')
    }

    expect(macosCheck).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck).toContain('lipo "$payload" -verify_arch')
    expect(macosCheck).toContain('"$EXE" "$EXE-rg" "$EXE-spawn-helper"')
  })

  it('builds the macOS x64 wheel on the matching GitLab runner', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const macosX64 = workflow['runtime-macos-x64']
    const publish = workflow['publish-python']
    if (!isRecord(macosX64) || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the macOS x64 runtime and publication jobs')
    }

    expect(macosX64.tags).toEqual(['macos-x64'])
    expect(macosX64.variables).toMatchObject({ PKG_TARGET: 'node24-macos-x64', PLATFORM: 'macos-x64' })
    expect(publish.needs).toContainEqual({ job: 'runtime-macos-x64', artifacts: true })
    expect(JSON.stringify(publish.script)).toContain('macosx_14_0_x86_64.whl')
  })

  it('builds and black-box tests the Windows x64 wheel in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const windows = workflow['runtime-windows-x64']
    const publish = workflow['publish-python']
    if (!isRecord(windows) || !Array.isArray(windows.before_script) || !Array.isArray(windows.script)
      || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the Windows runtime and aggregate publication jobs')
    }

    expect(windows.tags).toEqual(['windows-x64'])
    expect(windows.variables).toMatchObject({ PKG_TARGET: 'node24-win-x64', PLATFORM: 'win-x64' })
    expect(JSON.stringify(windows.before_script)).toContain('.ci-python\\\\Scripts')
    expect(JSON.stringify(windows.before_script)).toContain('[IO.Path]::PathSeparator')
    expect(JSON.stringify(windows.script)).toContain('win_amd64.whl')
    expect(JSON.stringify(windows.script)).toContain('--scenario all --installed-wheel')
    expect(publish.needs).toContainEqual({ job: 'runtime-windows-x64', artifacts: true })
  })
})

describe('Weighted approval workflow', () => {
  it('publishes from the trusted default branch after pull request and review updates', () => {
    const publisher = loadWorkflow('.github/workflows/weighted-approval.yml')
    const reviewEvent = loadWorkflow('.github/workflows/weighted-approval-review-event.yml')
    const pullRequest = workflowEvent(publisher, 'pull_request_target')
    const workflowRun = workflowEvent(publisher, 'workflow_run')
    const review = workflowEvent(reviewEvent, 'pull_request_review')
    const job = workflowJob(publisher, 'publish-status')
    const recordJob = workflowJob(reviewEvent, 'record-review-event')
    if (!isRecord(publisher.on)) throw new TypeError('weighted-approval workflow must define events')
    if (!isRecord(reviewEvent.on)) throw new TypeError('weighted-approval review event workflow must define events')
    if (!Array.isArray(job.steps)) throw new TypeError('weighted-approval job must define steps')
    if (!Array.isArray(recordJob.steps)) throw new TypeError('weighted-approval review event job must define steps')
    const steps = job.steps.filter(isRecord)
    const checkout = steps.find(step => step.name === 'Check out trusted approval policy')
    const publish = steps.find(step => step.name === 'Publish weighted approval status')
    const recordSteps = recordJob.steps.filter(isRecord)
    const record = recordSteps.find(step => step.name === 'Record review event')

    expect(publisher.name).toBe('weighted-approval')
    expect(Object.keys(publisher.on)).toEqual(['pull_request_target', 'issue_comment', 'workflow_run'])
    expect(workflowEvent(publisher, 'issue_comment').types).toEqual(['created', 'edited', 'deleted'])
    expect(pullRequest.types).toEqual(['opened', 'synchronize', 'reopened', 'ready_for_review', 'converted_to_draft', 'edited'])
    expect(workflowRun).toEqual({ workflows: ['weighted-approval-review-event'], types: ['completed'] })
    expect(reviewEvent.name).toBe('weighted-approval-review-event')
    expect(reviewEvent['run-name']).toBe('weighted-approval-review-event:${{ github.event.pull_request.number }}')
    expect(Object.keys(reviewEvent.on)).toEqual(['pull_request_review'])
    expect(review.types).toEqual(['submitted', 'edited', 'dismissed'])
    expect(reviewEvent.permissions).toEqual({})
    expect(publisher.permissions).toEqual({
      contents: 'read',
      'pull-requests': 'write',
      statuses: 'write',
    })
    expect(publisher.concurrency).toEqual({
      group: "weighted-approval-${{ (github.event.pull_request.number || github.event.issue.number) && format('weighted-approval-review-event:{0}', github.event.pull_request.number || github.event.issue.number) || github.event.workflow_run.display_title }}",
      'cancel-in-progress': false,
    })
    expect(job).toMatchObject({
      if: "(github.event_name != 'pull_request_target' || github.event.pull_request.state == 'open') && "
        + "(github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success') && "
        + "(github.event_name != 'issue_comment' || (github.event.issue.pull_request && github.event.issue.state == 'open' &&\n"
        + "  (contains(github.event.comment.body, '/delegate') || contains(github.event.changes.body.from, '/delegate'))))",
      name: 'weighted approval publisher',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 5,
    })
    expect(checkout).toMatchObject({
      uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      with: {
        ref: '${{ github.event.repository.default_branch }}',
        'persist-credentials': false,
      },
    })
    const setupIndex = steps.findIndex(step => typeof step.uses === 'string' && step.uses.startsWith('actions/setup-python@'))
    expect(steps[setupIndex]?.if).toBe("steps.revoke.outputs.active == 'true'")
    expect(steps[setupIndex]?.uses).toBe('actions/setup-python@ece7cb06caefa5fff74198d8649806c4678c61a1')
    const revokeIndex = steps.findIndex(step => step.id === 'revoke')
    expect(revokeIndex).toBeGreaterThan(steps.indexOf(checkout!))
    expect(revokeIndex).toBeLessThan(setupIndex)
    expect(steps[revokeIndex]?.run).toBe('node .github/review-ownership/check-approval.mjs pending')
    expect(steps.at(-1)).toMatchObject({
      if: "failure() && steps.revoke.outputs.active == 'true'",
      run: 'node .github/review-ownership/check-approval.mjs error',
    })
    const pythonJob = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'python-sdk')
    expect(pythonJob.steps).toContainEqual({
      name: 'Test production blame scoring',
      run: "uv run --python 3.10 --with-requirements .github/review-ownership/requirements.txt python -m unittest discover -s .github/review-ownership -p 'test_*.py'",
    })
    expect(steps.find(step => step.name === 'Install production lexer')).toMatchObject({
      if: "steps.revoke.outputs.active == 'true'",
      run: 'python3 -m pip install -r .github/review-ownership/requirements.txt',
    })
    expect(publish).toMatchObject({
      if: "steps.revoke.outputs.active == 'true'",
      env: {
        GITHUB_TOKEN: '${{ github.token }}',
        GITHUB_RUN_URL: '${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}',
      },
      run: 'node .github/review-ownership/check-approval.mjs',
    })
    expect(recordJob).toMatchObject({
      if: "github.event.pull_request.state == 'open'",
      name: 'record weighted approval review event',
      'runs-on': 'ubuntu-latest',
      'timeout-minutes': 2,
    })
    expect(record).toBeDefined()
    expect(record?.run).toBe("echo 'Recorded a weighted approval review event.'")
    expect(recordSteps).toHaveLength(1)
    expect(JSON.stringify(publisher)).not.toContain('github.event.pull_request.head')
    expect(JSON.stringify(publisher)).not.toContain('secrets.')
    expect(JSON.stringify(reviewEvent)).not.toContain('github.token')
    expect(JSON.stringify(reviewEvent)).not.toContain('secrets.')
  })
})

describe('npm release workflows', () => {
  it('keeps publication dispatch-only and pack in the PR workflow', () => {
    // pack stays in the PR/master release workflows so a PR proves the set packs.
    for (const file of ['release.yml', 'release-vendor.yml']) {
      const workflow = loadWorkflow(`.github/workflows/${file}`)
      if (!isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      expect(Object.keys(workflow.jobs).sort()).toEqual(file === 'release.yml' ? ['dependencies', 'pack'] : ['pack'])
    }

    // publication is workflow_dispatch-only (never a PR check) and keeps the
    // npm-publish environment plus the shared dist-tag group.
    for (const file of ['release-publish.yml', 'release-vendor-publish.yml']) {
      const workflow = loadWorkflow(`.github/workflows/${file}`)
      if (!isRecord(workflow.on) || !isRecord(workflow.jobs)) throw new TypeError(`${file} must define on and jobs`)
      expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
      const publish = workflow.jobs.publish
      if (!isRecord(publish)) throw new TypeError(`${file} must define a publish job`)
      expect(publish.environment).toBe('npm-publish')
      expect(publish.concurrency).toMatchObject({ group: 'Release-publish' })
    }
  })

  it('runs dependency policy and npm layout checks in the DSH release workflow', () => {
    const workflow = loadWorkflow('.github/workflows/release.yml')
    const dependencies = workflowJob(workflow, 'dependencies')
    if (!isRecord(workflow.on) || !Array.isArray(dependencies.steps)) {
      throw new TypeError('DSH release workflow must define triggers and dependency steps')
    }
    const commands = dependencies.steps.flatMap(step =>
      isRecord(step) && typeof step.run === 'string' ? [step.run] : [])

    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch'])
    expect(commands).toContain('pnpm run verify-package-dependencies')
    expect(commands).toContain('pnpm run verify-npm-install-layout')
  })
})

describe('Documentation site publication', () => {
  it('keeps Pages deployment dispatch-only from a dsh-v* tag', () => {
    const workflow = loadWorkflow('.github/workflows/docs-pages.yml')
    const build = workflowJob(workflow, 'build')
    const deploy = workflowJob(workflow, 'deploy')
    if (!isRecord(workflow.on) || !isRecord(workflow.env) || !Array.isArray(build.steps)) {
      throw new TypeError('Documentation deployment must define on, env, and build steps')
    }

    // The site presents a released snapshot: a merge must never publish it, and
    // publication must never appear as a PR check.
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])

    // RELEASE_PUBLISH makes release:verify reject every ref that is not a dsh-v*
    // tag naming this tree's version, so the site and the npm sequence share one
    // definition of a released version.
    const steps = build.steps.filter(isRecord)
    const verify = steps.find(step => step.name === 'Verify release version')
    const checkout = steps.find(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )
    expect(verify).toMatchObject({
      env: { RELEASE_PUBLISH: 'true' },
      run: 'pnpm run release:verify --family dsh',
    })
    // Complete history: the release scripts read tags.
    expect(checkout).toMatchObject({ with: { 'fetch-depth': 0 } })

    // Projected source links stay on the public repository's master. That
    // repository advances only to each release commit, so its master never
    // carries unreleased work, while it retains only the most recent tags:
    // following the dispatched tag would leave every source link on a deploy
    // from an older tag unresolvable.
    expect(workflow.env.DOCS_REPOSITORY_REF).toBe('master')

    // The environment owns the deployment tag policy and the required reviewers.
    expect(deploy.environment).toMatchObject({ name: 'github-pages' })
  })
})

describe('Git hooks', () => {
  it('leaves frozen Agent Note sidecars to the archive verifier', () => {
    const lefthook = loadWorkflow('lefthook.yml')

    for (const hookName of ['pre-commit', 'pre-merge-commit']) {
      const hook = lefthook[hookName]
      if (!isRecord(hook) || !Array.isArray(hook.jobs)) {
        throw new TypeError(`lefthook must define ${hookName} jobs`)
      }
      const pairing: unknown = hook.jobs.find(
        (job: unknown) => isRecord(job) && job.name === 'translation pairing (staged records)',
      )

      expect(pairing).toMatchObject({ exclude: ['.agents/notes/archived/**'] })
    }
  })
})

function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on) || !isRecord(workflow.on[event])) {
    throw new TypeError(`workflow must define the ${event} event`)
  }
  return workflow.on[event]
}

function workflowJob(workflow: Record<string, unknown>, job: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[job])) {
    throw new TypeError(`workflow must define the ${job} job`)
  }
  return workflow.jobs[job]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
