# Operator dashboard example

Next.js UI that embeds `<OperatorQueue />` against the kitchen-sink self-hosted
backend.

```sh
bunx turbo run dev --filter=dsar-kitchen-sink-example --filter=dsar-dashboard-example
```

- Backend: `http://kitchen-sink.localhost:1355/api/v1`
- Dashboard: `http://localhost:1357`

Development CORS + trusted `Origin` maps this app to an operator identity.
Override with `NEXT_PUBLIC_DSAR_URL`.
