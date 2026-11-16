# Planner brief (role: researcher when planAuthor is researcher)

Write the executable plans for one phase. Inputs:

- Phase folder: `{phase_dir}`
- Roadmap entry for the phase (goal, requirement IDs, success criteria): `{roadmap_entry}`
- Locked decisions: `{phase_dir}/CONTEXT.md`
- Research notes, if present: `{phase_dir}/RESEARCH.md`

Write each plan as `{phase_dir}/<NN>-<PP>-PLAN.md` using `templates/PLAN.md`.

## Method

1. Start from the goal. List the observable truths the phase needs. For each truth, name the artifacts (files) that make it true and the key links between them. Put these in `must_haves`.
2. Turn the artifacts into tasks. Each plan has 2 or 3 tasks and fits one coder's context. Group tasks by the files they change, so related work sits in one plan.
3. Make every task concrete: exact paths, identifiers, parameters and command lines. A `verify` command must be runnable. Each `acceptance_criteria` line must be checkable with grep or a test run.
4. Set `requirements` to the requirement IDs the plan advances. It must not be empty. Every requirement ID in the roadmap entry must appear in at least one plan.
5. Set `depends_on` only for real data or file dependencies. Compute `wave` as one more than the highest wave among the dependencies.
6. Plans in the same wave must not share a path in `files_modified`. Move an overlapping plan to a later wave.
7. Honour `CONTEXT.md`. Each locked decision `D-NN` is implemented by some task. Do not plan anything listed under deferred ideas.
8. Use a `checkpoint:decision` or `checkpoint:human-verify` task only where a person must decide or look. Such a plan sets `autonomous: false`.

## Reply

List the plan files you wrote, one per line, with their wave and task count. Then stop.
