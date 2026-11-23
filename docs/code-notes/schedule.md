# schedule code notes

## packages/schedule/schedule/src/runtime.ts:ScheduleRuntime::drive (issue 32)

A task whose target restore, enqueue, Session flush or receipt commit failed stays due, but `drive` excluded it from the next-timer computation, so nothing re-armed the scheduler once the transient fault cleared; only an unrelated change or a Host restart retried it.

Fix: `deliverDue` already returns the still-due failed ids. `drive` now arms a retry timer for them with bounded exponential backoff (`RETRY_BASE_MS` doubling to `RETRY_MAX_MS`), tracked in `failureStreak` and reset by the first drive that has no failures. Every failed attempt is logged by `deliverDue` (`schedule: reminders [...] were not acknowledged`), which is the persistent signal operators see while the streak grows.

At-least-once: a failure after the message was enqueued (flush or commit) leaves that message in the target inbox with no saved receipt, so the retry enqueues the occurrence again. This is the same duplicate the documented crash-before-receipt window produces; the occurrence time is unchanged on retry because it is derived from the task record, not the attempt.

## packages/schedule/schedule/README.md and src/runtime.ts:ScheduleRuntime::deliverDue (issue 63)

Receipt semantics are unchanged: `deliverDue` enqueues, flushes, then commits the receipt, so two boundaries remain. A crash or failed write between flush and receipt re-delivers the occurrence (the issue 32 retry shares this duplicate). Graceful disposal of the target Agent cancels its unclaimed inbox after the receipt, so the task reads as delivered although the message never ran. Closing the second boundary needs a durable occurrence identity plus separate admission, cancellation and execution tracking across Session logs, which is a storage redesign rather than a bounded fix; the limitation is stated precisely in the package README and left in place.
