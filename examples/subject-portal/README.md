# Subject portal example

Next.js app that embeds `<SubjectPortal />` from `@dsar/react`.

Locally the widget calls `/api/dsar`, a same-origin BFF that runs `dsarInstance` on **in-process SQLite** (same idea as c15t's demo sqlite/turso file). The machine token stays in the route handler.

Hosted, point the provider at inth.com instead:

```tsx
<DsarProvider mode={hosted({ project: "acme" })}>
	<SubjectPortal />
</DsarProvider>
```

That talks to `https://acme.inth.app/dsar`. Webhooks for the same project are under that origin.

```sh
bunx turbo run dev --filter=dsar-subject-portal-example
```

Then open `http://localhost:1356`.
