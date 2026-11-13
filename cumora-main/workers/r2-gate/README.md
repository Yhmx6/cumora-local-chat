# cumora-r2-gate

Cloudflare Worker in front of `cdn.cumora.ai`. It is the authorization check
for private objects in the `cumora-attachments` bucket. The server signs
read URLs; this worker checks them before calling the R2 binding.

## Access

| Key prefix | Auth | Cache-Control |
| --- | --- | --- |
| `avatars/` | None. Portraits are public. | `public, max-age=86400, immutable` |
| `attachments/` | `?exp=<unix>&sig=<hex>` | `private, max-age=300` |
| `email-attachments/` | Same signature as `attachments/` | `private, max-age=300` |
| Anything else | Same signature. Missing or bad signatures are 403 and do not read the bucket. | Private, once authorized |

`sig` is HMAC-SHA256 of `<key>:<exp>` with `R2_URL_SIGNING_SECRET`. `exp`
must be within the worker's skew window. GET and HEAD use the same check.
Any other method is 405.

The worker reads with `env.BUCKET.get` / `head`. It does not call `fetch()`
or the Cache API. `Cache-Control` is a hint to caches in front of the
worker; this program does not itself store a CDN hit.

`avatars/` is the only unsigned prefix (`PUBLIC_PREFIXES` in `src/index.ts`).
The server's signed list is `SIGNED_PREFIXES` in `server/src/storage.ts`.
Together they must equal `STORAGE_KEY_PREFIXES` in `server/src/storage-keys.ts`.
`tests/storage-prefix-contract.test.ts` fails when those lists drift.

Rotate `R2_URL_SIGNING_SECRET` on the server and with `wrangler secret put`
together. URLs already handed out stop verifying at rotation. Readers that
still have the object key ask the server for a fresh signature.

## Setup

```bash
cd workers/r2-gate
npm install
npx wrangler login
npx wrangler secret put R2_URL_SIGNING_SECRET
npx wrangler deploy
```

`npm run setup` at the repo root installs this package as well as
`workers/email-gate`. Tests live in `src/index.test.ts` and run under the
root `npm test` glob `workers/**/*.test.ts`.
