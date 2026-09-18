# `@dsar/react`

React provider and portal widgets for DSAR. Same split as `@c15t/react`:

- **Hosted** on inth.com: `hosted({ project: "acme" })` talks to `https://acme.inth.app/dsar`
- **Local / self-host**: `hosted({ url: "/api/dsar" })` talks to your BFF, which holds the machine token

Do not pass `DSAR_API_TOKEN` into these components. The browser only sends cookies to inth.app, or same-origin requests to your BFF.

```tsx
import { DsarProvider, SubjectPortal, hosted } from "@dsar/react";

export function App() {
	return (
		<DsarProvider mode={hosted({ project: "acme" })}>
			<SubjectPortal />
		</DsarProvider>
	);
}
```

Webhooks for a hosted project use the same origin: `https://acme.inth.app/dsar/webhooks/...`

See `examples/subject-portal` (in-process SQLite) and `examples/dashboard`.
