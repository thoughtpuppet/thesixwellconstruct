# Web Push implementation

`webcrypto-web-push.js` is an ESM bundle of:

- `@block65/webcrypto-web-push@2.0.0` (MIT), https://github.com/block65/webcrypto-web-push
- `uint8array-extras@1.6.0` (MIT), https://github.com/sindresorhus/uint8array-extras

The adjacent license files must accompany this bundle. It uses native Web Crypto
and fetch, with no runtime npm installation. The aes128gcm encoding and VAPID
authorization work with Apple's push service.

To rebuild in a temporary directory, install both exact versions above and `esbuild@0.25.12`,
then bundle `@block65/webcrypto-web-push/dist/lib/main.js` with
`--bundle --format=esm --platform=browser --target=es2022`.
