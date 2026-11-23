# speech-to-text-sensevoice code notes

## packages/experimental/speech-to-text-sensevoice/src/recognizer.ts:SenseVoiceWorker::enqueue (issue 164)

A queued job used to be `tail.then(check abort, run)`, so its abort signal was read only once every earlier job had settled: cancelling a waiting recording neither settled its promise nor freed its `pending` slot, and `maxPending` cancelled jobs behind a slow active job made new recordings fail as queue-full while their audio stayed referenced. `enqueue` now rejects a waiting job and frees its slot as soon as its signal aborts. Serialization is kept by chaining each job's `done` promise onto `tail` after the previous tail, so a later job still starts only after every earlier active job finished; a cancelled waiter resolves its `done` at once and adds no wait. An abort that arrives after the job started is left to `run`, which owns worker cleanup. The idle timer is armed from the same slot-release path.
