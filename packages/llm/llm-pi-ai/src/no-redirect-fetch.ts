export const noRedirectFetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, { ...init, redirect: 'error' })
