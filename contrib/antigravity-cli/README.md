# Antigravity CLI

Install Antigravity CLI and add this optional bundle to your Harness profile. In **Settings → Antigravity accounts**, select **Sign in with Google**, open the browser link and paste the authorization code. The model picker lists the text models returned by `agy models`, including the effort variants available to your account. Set the provider's `command` configuration to an absolute path if the Harness cannot find `agy` on PATH.

Select a model in a Full access chat. When Harness offers tools, the CLI exchanges structured requests and results with the Harness conversation. Tools execute through the usual Harness session checks. The CLI runs outside the workspace with strict native tool permissions. Images and background requests without an eligible chat are outside this adapter's scope. Each request sends the Harness transcript as text, with a conservative 128,000-token context estimate.
