# heic-to 1.5.2

This directory contains the CSP-compatible browser build of
[`heic-to`](https://github.com/hoppergee/heic-to), pinned at version `1.5.2`.

- npm package: `heic-to@1.5.2`
- bundled file: `dist/csp/heic-to.min.js`
- npm integrity: `sha512-8Fns+lZHAWmz5U5IUxDeXKwIf3foBoKNPLxxFY4B0MkLjNuomEIHCoDbDE+x/llFK3NCEO1cu4+n3iUKY+Svmw==`
- purpose: authenticated Studio-only HEIC/HEIF decoding for private edit proxies
- license: LGPL-3.0; see `LICENSE`

The archival HEIC/HEIF upload remains unchanged. This dependency is loaded
only when Studio needs a browser-readable edit proxy and is never loaded by a
public Archive page.
