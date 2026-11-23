# headless code notes

## packages/bundle/headless/src/index.ts:run (issue 47)

Background jobs are owned by the run's Agent scope; the jobs registry cancels and awaits them in an owner-scope effect (`jobs.ownerCleanup()`), which appends `job/settled` to the Session. The runner used to request process exit and leave that disposal to application teardown, which can remove Session routing or close the writer first, so the final settlement was lost.

Fix: `run` keeps the `AgentHandle` and disposes it explicitly (memoized `retire`) after the outcome is summarized and before output and exit, on both the success and the failure path, so the owned jobs settle and their records are drained with the Agent's writer. The same `retire` is registered as a plugin teardown effect, so a signal shutdown that disposes the tree while the run is still waiting retires the Agent before the services below it close. The handle comes from `resolveAgent` for resumed Sessions. A failing disposal is reported on stderr and never changes the exit code derived from the task outcome.
