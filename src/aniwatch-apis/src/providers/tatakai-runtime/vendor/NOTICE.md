The file `host-server.cjs` comes from [Snozxyx/Tatakai](https://github.com/Snozxyx/Tatakai), revision `80bfc190603868effd81a138b6ee07af0b94ec0d`.

Original path: `desktop/runtime/extension-api-host/host-server.cjs`.

It is distributed under the Mozilla Public License, version 2.0, reproduced in `LICENSE`. Local modifications add the attribution header, scope streaming caches by namespace/title/options, retain page request headers for the restricted HPmovies media transport, disable optional browser integration explicitly, constrain exported provider registries before invocation, allow an explicitly bounded manga catalog budget, and expose a validated episode-index resolver hook without modifying the installed extension bundle. The covered source remains available in this repository; modifications to this covered file must remain available under MPL-2.0 when distributed.

The surrounding HPmovies launcher and registry are independent files. No Toko extension bundle, extension marketplace package, scraper, Electron browser engine, or remote executable installer is included.
