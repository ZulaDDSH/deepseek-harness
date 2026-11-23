# script-realm-iframe code notes

## packages/client/script-realm-iframe/src/client/iframe.ts:IFrameScriptRealm::execute

Finding 174. An execution error only failed `execute` when `ErrorEvent.filename` equalled the requested
URL. Cross-origin classic scripts report a sanitized error with an empty filename, and a redirect
reports the final URL, so a throwing script could still resolve on its `load` event. A classic script's
uncaught error is dispatched synchronously while it runs, and the script element's `load` event follows
in the same task. `execute` now also keeps the latest window `error` event whose filename names a
different URL and drops it on the next timer task; if the element's `load` arrives while such an event is
still held, that error was raised by this script's execution (no other script can run in that task) and
`execute` rejects with it. An exact filename match still rejects at once. What stays undetected: an
error thrown later from a timer or event handler the script registered, an error the script catches, and
a script that throws before any other work in a task that also hosts another script's load (not possible
for one window). A real cross-origin or redirected script was not exercised in a browser here; the unit
tests dispatch the events the browser raises.
