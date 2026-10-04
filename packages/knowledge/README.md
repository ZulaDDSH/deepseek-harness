---
description: "Shared knowledge policy and Git source packages."
kind: "package-group"
---

# knowledge/ — shared knowledge

## Summary

The knowledge group contributes shared-knowledge policy to the system prompt and reads knowledge records from a configured Git repository. Retrieval supplies records on demand; the policy package does not inject their contents into model requests.

## Packages

| Package | Role |
|---|---|
| [`knowledge-policy`](knowledge-policy/README.md) | Registers the shared-knowledge system-prompt section. |
| [`knowledge-source-git`](knowledge-source-git/README.md) | Reads and searches Git-backed knowledge records. |

## Related documentation

- [System prompt subsystem](../../docs/subsystems/system-prompt.md)

## Dev Note

Each package README owns its configuration and runtime behavior.
