# Antigravity CLI

Install and sign in to Antigravity CLI with `agy`, then add this optional bundle to your Harness profile. The model picker lists the text models returned by `agy models`, including the effort variants available to your account. Set the provider's `command` configuration to an absolute path if the Harness cannot find `agy` on PATH.

Select a model in a Full access chat. The CLI runs its own agent from the session workspace with strict tool permissions. Harness tool calls, images and background review requests are outside this adapter's scope. Each request sends the Harness transcript as text, with a conservative 128,000-token context estimate.
