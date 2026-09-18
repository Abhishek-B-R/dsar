# Subject portal example

Next.js UI that embeds `<SubjectPortal />`. It talks to a **self-hosted** DSAR
backend (kitchen-sink), not an in-process handler.

```sh
bunx turbo run dev --filter=dsar-kitchen-sink-example --filter=dsar-subject-portal-example
```

- Backend: `http://kitchen-sink.localhost:1355/api/v1`
- Portal: `http://localhost:1356`

Kitchen-sink allows that origin over CORS and projects a demo subject identity
from the `Origin` header (development only). The browser still does not hold
`DSAR_API_TOKEN`.

Hosted inth.com instead:

```tsx
<DsarProvider mode={hosted({ project: "acme" })}>
	<SubjectPortal />
</DsarProvider>
```

Override the local backend with `NEXT_PUBLIC_DSAR_URL`.
