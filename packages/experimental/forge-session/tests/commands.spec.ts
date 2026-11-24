import { describe, expect, it } from 'vitest'
import { changeRequestUrls, commandEvidence, commandOf, createdChangeRequestUrls, ownChangeRequestUrls, pushedBranches, sameChangeRequestUrl } from '../src/commands.ts'

describe('commandOf', () => {
  it('reads the string command argument', () => {
    expect(commandOf('{"command":"git push","description":"push"}')).toBe('git push')
  })

  it.each([
    ['malformed JSON', '{"command":'],
    ['a JSON string', '"git push"'],
    ['JSON null', 'null'],
    ['a missing command', '{"cmd":"git push"}'],
    ['a non-string command', '{"command":["git","push"]}'],
  ])('returns undefined for %s', (_label, raw) => {
    expect(commandOf(raw)).toBeUndefined()
  })
})

describe('commandEvidence', () => {
  const url = 'https://github.com/octo/demo/pull/12'
  const created = { urls: 'created', pushes: false, named: [] }
  const pushed = { urls: null, pushes: true, named: [] }

  it.each([
    ['gh pr create --fill', created],
    ['gh pr new -t title -b body', created],
    ['git push', pushed],
    ['git push -u origin HEAD', pushed],
    ['git -C ../checkout push origin feat', pushed],
    ['git -c credential.helper= push', pushed],
    ['git --no-pager push --force-with-lease', pushed],
    ['cd repo && git push && gh pr create --fill', { ...created, pushes: true }],
    ['gh pr view 12 --json url', { urls: 'referenced', pushes: false, named: [] }],
    ['gh pr view 12 --repo octo/demo --json number', { urls: 'referenced', pushes: false, named: [] }],
    [`gh pr view '${url}' --json title`, { urls: 'referenced', pushes: false, named: [url] }],
    [`gh pr edit ${url}/files --add-label bug`, { urls: 'referenced', pushes: false, named: [url] }],
    [`gh pr checkout ${url} && git push`, { urls: 'referenced', pushes: true, named: [url] }],
    [`gh pr view --json url ${url}`, { urls: 'referenced', pushes: false, named: [url] }],
    [`gh pr create --fill && gh pr view ${url}`, { ...created, named: [url] }],
    ['cd repo\ngh pr create --fill', created],
    ['(gh pr create --fill)', created],
    ['FOO=1 env BAR=2 gh pr create --fill', created],
    ['git status; gh pr new', created],
    ["bash -c 'gh pr create --fill'", created],
    ["bash -e -c 'gh pr create --fill'", created],
    ["bash -o pipefail -c 'gh pr create --fill'", created],
    ["bash -O extglob -c 'gh pr create --fill'", created],
    ["bash --rcfile rc -c 'gh pr create --fill'", created],
    ['sh -lc "cd repo && gh pr create"', created],
    ['if git diff --quiet; then gh pr create --fill; fi', created],
    ['{ gh pr create --fill; }', created],
    ['time gh pr create --fill', created],
    ["cat <<'EOF' > body.md\nnotes\nEOF\ngh pr create --body-file body.md", created],
    ["bash <<'EOF'\ngh pr create --fill\nEOF", created],
    ['ssh host <<EOF\ngh pr create\nEOF', created],
    ['sudo python3 - <<EOF\nimport os\nEOF\ngh pr new', created],
    ['cat <<EOF | bash\ngh pr create\nEOF', created],
    ['echo ssh; cat <<EOF\nx\nEOF\ngh pr create', created],
    ["bash -eo pipefail -c 'gh pr create --fill'", created],
    ["bash -c -e 'gh pr create --fill'", created],
    ["bash -co pipefail 'gh pr create --fill'", created],
    ["bash -cB 'gh pr create --fill'", created],
    ["bash -Oc extglob 'gh pr create --fill'", created],
    ["bash --norc --noprofile -c 'gh pr create --fill'", created],
    ["bash -c -- 'gh pr create --fill'", created],
    ["bash +e -c 'gh pr create --fill'", created],
    ["/bin/bash -c 'gh pr create --fill'", created],
    ['bash -c "bash -c \'gh pr create --fill\'"', created],
    ['gh.exe pr create --fill', created],
    ['/usr/bin/gh pr create --fill', created],
    ['"C:\\Program Files\\GitHub CLI\\gh.exe" pr create --fill', created],
    ['gh pr create --title --help', created],
    ['gh pr create -t "--dry-run" --fill', created],
    ['gh pr create --fill --unknown-flag --help-me', created],
    ['echo "$(gh pr create --fill)"', created],
    ['echo `gh pr create --fill`', created],
    ['url=$(gh pr create --fill)', created],
    ['echo "$(echo "$(gh pr create --fill)")"', created],
    ['/usr/bin/git push', pushed],
    ['git --git-dir .git push', pushed],
    ['git --git-dir=.git --work-tree . -C sub -c a=b --no-pager push origin', pushed],
    ['git --namespace ns --config-env x=Y push', pushed],
    ['echo "$(git push)"', pushed],
    ['gh pr view 12 --json url && echo "$(git push)"', { urls: 'referenced', pushes: true, named: [] }],
    ['/usr/bin/gh pr view 12', { urls: 'referenced', pushes: false, named: [] }],
    ['gh.exe pr edit 12 --add-label x', { urls: 'referenced', pushes: false, named: [] }],
    ['env GH_HOST=ghe.example gh pr checkout 12', { urls: 'referenced', pushes: false, named: [] }],
    ['env GH_HOST=x -- gh pr view 1', { urls: 'referenced', pushes: false, named: [] }],
    ['env -i git push', pushed],
    ['env -u HOME -C /tmp git push', pushed],
    ['sudo git push', pushed],
    ['sudo -u deploy -E git push origin main', pushed],
    ['timeout 60 git push', pushed],
    ['timeout -s KILL --kill-after=5 60 git push', pushed],
    ['nice git push', pushed],
    ['nice -n 5 git push', pushed],
    ['nohup git push &', pushed],
    ['echo feat | xargs -I{} git push origin {}', pushed],
    ['echo feat | xargs -n 1 git push origin', pushed],
    ['sudo timeout 5 gh pr create --fill', created],
    ['find . -name x -exec git push {} \\;', pushed],
    ['pwsh -Command "git push"', pushed],
    ['pwsh -NoProfile -c "git push origin feat"', pushed],
    ['powershell.exe -NoLogo -Command "gh pr create --fill"', created],
    ['cmd /c "git push"', pushed],
    ['ssh host "git push"', pushed],
    ['ssh -p 22 -o StrictHostKeyChecking=no host git push origin main', pushed],
    ['ssh host "gh pr create --fill"', created],
    ['eval "git push"', pushed],
    ['sudo bash -c "git push"', pushed],
    ['C:\\Git\\git.exe push', pushed],
    ['C:\\Tools\\gh.exe pr create --fill', created],
    ['gh pr create --title x `\n --body y', created],
    ['git push `\n origin feat', pushed],
    ['git push `\n origin feat `\n --force', pushed],
  ])('classifies %j', (command, evidence) => {
    expect(commandEvidence(command)).toEqual(evidence)
  })

  it.each([
    'git commit -m "push the fix"',
    'git stash push -m wip',
    'gh pr list --head feat',
    'gh pr status',
    'git-push origin',
    'grep -rn "gh pr create" docs',
    'echo gh pr create --fill',
    'printf "%s" "gh pr new"',
    "cat > notes.md <<'EOF'\ngh pr create\nEOF",
    'cat <<EOF\ngh pr new --fill\nEOF',
    'git commit -F - <<EOF\nmessage\ngh pr create\nEOF',
    'cat <<EOF\ngit push\nEOF',
    "bash -c 'echo gh pr create'",
    'bash script.sh gh pr create',
    "bash script.sh -c 'gh pr create'",
    'cat <<A <<B\ngh pr create\nA\ngh pr new\nB',
    'echo bash && cat <<EOF\ngh pr create\nEOF',
    'echo "git push"',
    "echo 'git push origin main'",
    'echo "gh pr view 1"',
    'grep -n "gh pr edit" docs',
    "printf '%s' 'gh pr checkout 1'",
    'gh pr create --help',
    'gh pr create -h',
    'gh pr new --dry-run',
    'gh pr create --dry-run --fill',
    'gh pr create --fill --help',
    "bash -c 'gh pr create --dry-run'",
    "echo '$(gh pr create --fill)'",
    'echo "\\$(gh pr create --fill)"',
    "echo '`gh pr create --fill`'",
    'echo "$(echo gh pr create)"',
    "bash -x script.sh -c 'gh pr create'",
    "bash -cZ 'gh pr create'",
    "bash -c --version 'gh pr create'",
    'bash -c',
    'bash -c -o',
    "bash --unknown -c 'gh pr create'",
    "bash - -c 'gh pr create'",
    'git --git-dir .git status',
    'git --git-dir push',
    'git -C push status',
    'git push-all',
    'sudo git status',
    'timeout 60 git status',
    'env -i echo git push',
    'nice -n 5 echo git push',
    'xargs echo git push',
    'ssh host "git status"',
    'ssh host',
    'pwsh -Command "echo git push"',
    'pwsh -File script.ps1 git push',
    'eval "echo git push"',
    'find . -name push -exec echo git push {} \\;',
    'gh pr create --help `\n --fill',
  ])('ignores %j', (command) => {
    expect(commandEvidence(command)).toBeUndefined()
  })

  it('cannot tell an echoed URL line from the URL gh printed', () => {
    const text = ['https://github.com/octo/demo/pull/9', 'https://github.com/octo/demo/pull/10'].join('\n')
    expect(commandEvidence('gh pr create --fill && echo https://github.com/octo/demo/pull/9')).toEqual(created)
    expect(createdChangeRequestUrls(text)).toEqual(['https://github.com/octo/demo/pull/9', 'https://github.com/octo/demo/pull/10'])
  })

  it('treats a heredoc for an unknown program as data', () => {
    expect(commandEvidence('mytool <<EOF\ngh pr create\nEOF')).toBeUndefined()
    expect(commandEvidence('docker exec -i c sh <<EOF\ngh pr create\nEOF')).toEqual(created)
  })

  it('classifies nested command substitutions in linear time', () => {
    const started = performance.now()
    expect(commandEvidence(`echo "${'$('.repeat(40_000)}gh pr create`)).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('classifies a long run of option letters in linear time', () => {
    const started = performance.now()
    expect(commandEvidence(`bash -${'c'.repeat(80_000)}! gh pr create`)).toBeUndefined()
    expect(performance.now() - started).toBeLessThan(500)
  })
})

describe('ownChangeRequestUrls', () => {
  const pull = (number: number): string => `https://github.com/octo/demo/pull/${number}`

  it('reads the url field and a URL alone on a line before a description, and JSON url members', () => {
    const view = ['title:\tAdd it', 'state:\tOPEN', `url:\t${pull(7)}`, '--', `Stacked on ${pull(8)}`, pull(9)].join('\n')
    expect(ownChangeRequestUrls(view)).toEqual([pull(7)])
    expect(ownChangeRequestUrls(`${pull(5)}\n`)).toEqual([pull(5)])
    const members = JSON.stringify({ number: 6, url: pull(6), body: `see ${pull(8)}`, comments: [{ url: `${pull(6)}#issuecomment-1` }] })
    expect(ownChangeRequestUrls(members)).toEqual([pull(6)])
    expect(ownChangeRequestUrls(`{\n  "url": "${pull(4)}/"\n}`)).toEqual([pull(4)])
  })

  it('reads no URL from a nested url member or from JSON after the description separator', () => {
    expect(ownChangeRequestUrls(JSON.stringify({ number: 6, comments: [{ url: pull(6) }] }))).toEqual([])
    expect(ownChangeRequestUrls(`title:\tAdd it\n--\n{"url": "${pull(8)}"}`)).toEqual([])
  })

  it('finds nothing in output that names no change request of its own', () => {
    expect(ownChangeRequestUrls("Switched to branch 'feat'\n")).toEqual([])
    expect(ownChangeRequestUrls(`see ${pull(3)} for details`)).toEqual([])
  })
})

describe('createdChangeRequestUrls', () => {
  it('reads only the URLs alone on their lines', () => {
    const text = ['Creating pull request for feat into main', 'https://github.com/octo/demo/pull/12', 'see https://github.com/octo/demo/pull/3 and', 'https://github.com/octo/demo/pull/4/files'].join('\n')
    expect(createdChangeRequestUrls(text)).toEqual(['https://github.com/octo/demo/pull/12'])
  })
})

describe('changeRequestUrls', () => {
  it('finds distinct pull request URLs in order', () => {
    const text = [
      'https://github.com/octo/demo/pull/12',
      'see (https://github.com/octo/demo/pull/3/files) and https://github.com/octo/demo/pull/12',
      '[link](http://ghe.corp.example/team/svc/pull/7)',
    ].join('\n')

    expect(changeRequestUrls(text)).toEqual([
      'https://github.com/octo/demo/pull/12',
      'https://github.com/octo/demo/pull/3',
      'http://ghe.corp.example/team/svc/pull/7',
    ])
  })

  it('ignores compare links and malformed numbers', () => {
    expect(changeRequestUrls('https://github.com/octo/demo/pull/new/feat https://github.com/octo/demo/pull/12abc')).toEqual([])
  })
})

describe('pushedBranches', () => {
  it('reads created, updated, forced, and current branches under their remote', () => {
    const text = [
      'To github.com:octo/demo.git',
      ' * [new branch]      feat -> feat',
      '   1a2b3c4..5d6e7f8  main -> main',
      ' + 1a2b3c4...5d6e7f8 topic -> topic (forced update)',
      ' = [up to date]      stable -> stable',
      ' * [new branch]      HEAD -> refs/heads/review',
    ].join('\n')

    expect(pushedBranches(text)).toEqual([
      { remote: 'github.com:octo/demo.git', branch: 'feat' },
      { remote: 'github.com:octo/demo.git', branch: 'main' },
      { remote: 'github.com:octo/demo.git', branch: 'topic' },
      { remote: 'github.com:octo/demo.git', branch: 'stable' },
      { remote: 'github.com:octo/demo.git', branch: 'review' },
    ])
  })

  it('reads porcelain output with the same exclusions', () => {
    const text = [
      'To github.com:octo/demo.git',
      '*\trefs/heads/feat:refs/heads/feat\t[new branch]',
      ' \trefs/heads/main:refs/heads/main\t1a2b3c4..5d6e7f8',
      '+\trefs/heads/topic:refs/heads/topic\t1a2b3c4...5d6e7f8 (forced update)',
      '=\trefs/heads/stable:refs/heads/stable\t[up to date]',
      '!\trefs/heads/old:refs/heads/old\t[rejected] (fetch first)',
      '-\t:refs/heads/gone\t[deleted]',
      '*\trefs/tags/v1:refs/tags/v1\t[new tag]',
      'Done',
    ].join('\n')

    expect(pushedBranches(text)).toEqual([
      { remote: 'github.com:octo/demo.git', branch: 'feat' },
      { remote: 'github.com:octo/demo.git', branch: 'main' },
      { remote: 'github.com:octo/demo.git', branch: 'topic' },
      { remote: 'github.com:octo/demo.git', branch: 'stable' },
    ])
  })

  it('excludes rejected, deleted, tag, and non-branch refs', () => {
    const text = [
      'To https://github.com/octo/demo.git',
      ' ! [rejected]        feat -> feat (fetch first)',
      ' ! [remote rejected] main -> main (protected branch hook declined)',
      ' - [deleted]         old',
      ' * [new tag]         v1.0 -> v1.0',
      ' * [new reference]   HEAD -> refs/for/main',
      'error: failed to push some refs to \'https://github.com/octo/demo.git\'',
    ].join('\n')

    expect(pushedBranches(text)).toEqual([])
  })

  it('assigns each ref line to the nearest preceding remote and ignores ref lines before any remote', () => {
    const text = [
      ' * [new branch]      orphan -> orphan',
      'To fake.test:octo/one.git\r',
      ' * [new branch]      feat -> feat\r',
      'To fake.test:octo/two.git',
      ' * [new branch]      feat -> feat',
      ' * [new branch]      feat -> feat',
    ].join('\n')

    expect(pushedBranches(text)).toEqual([
      { remote: 'fake.test:octo/one.git', branch: 'feat' },
      { remote: 'fake.test:octo/two.git', branch: 'feat' },
    ])
  })
})

describe('sameChangeRequestUrl', () => {
  it('ignores scheme, letter case, query, fragment, and trailing slashes', () => {
    expect(sameChangeRequestUrl('https://github.com/Octo/Demo/pull/1/', 'http://github.com/octo/demo/pull/1?tab=checks#top')).toBe(true)
  })

  it('distinguishes different numbers and repositories', () => {
    expect(sameChangeRequestUrl('https://github.com/octo/demo/pull/1', 'https://github.com/octo/demo/pull/10')).toBe(false)
    expect(sameChangeRequestUrl('https://github.com/octo/demo/pull/1', 'https://github.com/octo/other/pull/1')).toBe(false)
  })
})
