# ui-plugin-market code notes

## packages/client/ui-plugin-market/src/client/DiscoverSection.tsx:MarketIcon

`packages/client/ui-plugin-market/src/client/DiscoverSection.tsx:MarketIcon`: Finding 185. Marketplace entries name icon URLs; rendering them as `<img>` made the browser contact the icon host on every listing view (IP address and which listings were seen). Remote icons are now off by default: `MarketIcon` shows the default artwork until the user turns on the toolbar toggle (`remoteIcons`). The choice is component state of `DiscoverSection` shared through `RemoteIconsContext`, so it covers the list, the entry page and the install dialog, and it resets with the tab; nothing is persisted. The toggle is shown only when the loaded page has an icon. Residual limit: once on, every icon host sees the viewer's address; no proxy or cache exists.
