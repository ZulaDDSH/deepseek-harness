# quota-controller code notes

`packages/api/quota-controller/src/types.ts:QuotaWindowId`: `daily` is an allowance that resets once a day and is quoted in provider-formatted hours (`QuotaWindow.valueLabel`), not as a rolling window. The first user is the Freebuff quota source in `packages/llm/llm-freebuff/src/quota.ts:quotaWindows`. It sits between `5h` and `weekly` in the drawing order. `credits` stays for unbounded balances with no percentage.
