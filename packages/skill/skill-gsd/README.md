---
description: "Bundled GSD (Get Shit Done) phased workflow skills for users and maintainers using or debugging the optional GSD workflow in DeepSeek Harness."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-gsd

## Summary

Agents can load the GSD phased workflow as twenty user-invocable skills, one per `/gsd-*` command. The workflow discusses, plans, executes, verifies and ships one roadmap phase at a time, with state kept in `.planning/`. It is adapted from Get Shit Done (MIT); see [NOTICE-GSD.md](NOTICE-GSD.md). Skills ask the user through `ask_user_question` at gates set by the GSD settings, and they delegate work to `coder`, `reviewer` and `researcher` children through the `subagent` tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The default composition mounts the provider, so every session's skill catalog lists the twenty `gsd-*` skills. The provider has no configuration.

```yaml
- name: '@deepseek-ai/dsh-skill-gsd'
```

### Commands

| Group | Skills |
| --- | --- |
| Core loop | `gsd-discuss-phase`, `gsd-plan-phase`, `gsd-execute-phase`, `gsd-verify-work`, `gsd-ship` |
| Progress and state | `gsd-next`, `gsd-progress`, `gsd-pause-work`, `gsd-resume-work`, `gsd-autonomous` |
| Small jobs and setup | `gsd-quick`, `gsd-fast`, `gsd-new-project`, `gsd-map-codebase` |
| Quality | `gsd-code-review`, `gsd-debug`, `gsd-secure-phase`, `gsd-ui-review`, `gsd-audit-milestone` |
| Help | `gsd-help` |

### Settings

The skills follow the GSD settings in your instructions (set per session in Orchestrator & Subagent Setup, or globally in Settings): `gates`, `planAuthor`, `planning`, `checkRounds` and `parallelWaves`. Without a GSD section, the skills use the defaults in `assets/shared/settings.md`, and they tell the user once that GSD can be configured in Orchestrator & Subagent Setup.

### Gating

Skills are always listed in the catalog. The provider cannot list them only while a Session has GSD on, because a provider's `list()` receives only `cwd` and an abort signal, and no Session identity. Gating therefore lives in the skills: the `gates` setting decides when the orchestrator asks the user. Shipping always asks before it pushes or opens a pull request, and it never merges.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider registers twenty bundled candidates at the bundled skill rank. Each candidate's description is read from the `SKILL.md` frontmatter at activation, and activation fails if a skill's declared `name` differs from its directory. Every candidate exposes the packaged `assets/` directory as its resource base, so bodies can cite `templates/`, `briefs/` and `shared/` files by relative path.

| File | Responsibility |
| --- | --- |
| [`src/index.ts`](src/index.ts) | Provider registration, frontmatter parsing and the fixed skill list |
| — | No runtime invariant companion is published: the provider owns immutable candidates, and the skill registry owns registration lifecycle and precedence. |
| [`assets/gsd-*/SKILL.md`](assets/) | One skill per command: steps, gates and the attribution footer |
| [`assets/shared/`](assets/shared/) | Settings contract and the DSH role, tool and commit conventions |
| [`assets/briefs/`](assets/briefs/) | Prompts the orchestrator fills for executor, planner, plan-checker, verifier and researcher children |
| [`assets/templates/`](assets/templates/) | Compact `.planning/` file templates |
| [`NOTICE-GSD.md`](NOTICE-GSD.md) | MIT notice for the adapted content |

The tests in [`tests/skill-gsd.spec.ts`](tests/skill-gsd.spec.ts) check the registry contract, frontmatter, resource references, unique command names, the upstream-only token scan, the gate rules and the length limit.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Skill registry](../skill/README.md) — discovery and precedence.
- [Skill tool](../tool-skill/README.md) — model-visible catalogs and bodies.
- [Skill subsystem reference](../../../docs/subsystems/skills.md) — the provider contract.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-skill`, which renders the catalog entries and the loaded skill body to the model. Loading a body follows the same `<skill_content>` shape as other skills, with the packaged assets directory as its base.

#### KV Cache effect

Mounting the provider adds twenty catalog entries to every session prefix, because the skills are not gated per Session. Each loaded skill adds its body at the skill tool's insertion point.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Catalog size.** Twenty entries appear in every session, including sessions with GSD off, because gating is not available to providers.
- **Parallel coders share one git index.** Plans in a wave run in parallel without worktrees. Their commits are serialised by git's index lock, and the executor brief tells coders to retry rather than delete the lock.
- **No dry run against a real model yet.** The skill text is tested for structure and vocabulary, not for how a model follows the gates.
- **Upstream drift.** The content is a rewrite of Get Shit Done at the time it was adapted, and it does not track later upstream changes.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
