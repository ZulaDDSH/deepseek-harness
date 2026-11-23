# ui-sidebar-browser code notes

## packages/client/ui-sidebar-browser/src/client/view/BrowserBody.tsx:BrowserBody

Finding 201. The Web iframe cannot read the final URL of a cross-origin frame, so after its first load
the toolbar address is still only the requested URL; a redirect to another origin (or to the DSH
application origin) is invisible, and only a second load flips the state to `unknown`. The frame state
already separates `requested` from `observed` (`IframeImpl::snapshot` reports `requested` once loaded,
the Electron carrier reports `observed`). The body now shows an `address.requested` chip ("Requested
URL") whenever the address is `requested` and not loading, so the address is no longer presented as a
verified location; the Desktop carrier, which observes the URL, never shows it. The application-origin
refusal in `url.ts:parseBrowserAddress` stays an input check only; the README says it does not apply
to redirects or later in-frame navigation on Web. A carrier that observes every navigation (the Desktop
guest) is the only enforcement; no iframe change can provide it.
