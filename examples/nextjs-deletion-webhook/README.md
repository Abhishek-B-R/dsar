# Next.js deletion webhook

This App Router route verifies a DSAR outbound webhook with `verifyWebhook`
from `@dsar/node-sdk/webhooks` and mock-deletes a demo user only when the
event is `request_fulfilled` for a request stored as `delete`.

DSAR does not emit `data_deleted` or `deletion.requested`. `request_captured`
is intake. Verification, refuse, and appeal can still happen after capture.
The engine emits `request_fulfilled` on the `fulfil` action, with payload
`{ from, to }` and no request type. Store `requestType` next to the request
id when you create the DSAR, then erase only on fulfilment.

## Quickstart

### 1. Install

From the repository root:

```sh
bun install
```

### 2. Set the signing secret

```sh
cd examples/nextjs-deletion-webhook
cp .env.example .env
```

Put the same value in `DSAR_WEBHOOK_SECRET` and on the DSAR outbound webhook
endpoint.

### 3. Map the request id at intake

When `POST /requests` or capture returns an id, persist that id on your user
row plus `requestType: "delete"` for erasure requests. The webhook body does
not include email or request type. This demo keys rows by `requestId`.

The handler is `app/api/webhooks/dsar/route.ts`. It does not delete on
`request_captured`.

### 4. Start Next.js

```sh
bun run dev
```

The route is `POST /api/webhooks/dsar`.

### 5. Run the smoke test

```sh
bun run test
```

The test signs a fixture payload with HMAC-SHA256. It does not need a live
DSAR server. `turbo run test` runs the same Vitest file in CI on bun and node.

## Deploy to Vercel

This package depends on `@dsar/node-sdk` via `workspace:*`, so deploy the
whole `inthhq/dsar` repo.

1. Set Root Directory to `examples/nextjs-deletion-webhook`.
2. If workspace packages do not resolve, set the install command to
   `bun install` at the repository root.
3. Set `DSAR_WEBHOOK_SECRET` to the DSAR outbound signing secret.
4. Set `DEMO_STORE_PATH` to `/tmp/dsar-demo-users.json`. That file is
   ephemeral on Vercel and is only for trying the route. Replace
   `lib/store.ts` with your database before production.
5. Point the DSAR webhook URL at
   `https://your-domain.vercel.app/api/webhooks/dsar`.
