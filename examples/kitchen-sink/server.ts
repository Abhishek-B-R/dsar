import "dotenv/config";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { dsarInstance, runtimeReposFromPersistence } from "dsar/backend";
import { makePgPersistenceService } from "dsar/persistence-pg";
import { makeSqlitePersistenceService } from "dsar/persistence-sqlite";

import { demoPeoplePath, demoWebhookPath, openDemoApp } from "./demo-app";
import { corsAllowlist, corsOrigin } from "./local-ui";
import { runtimeConfig } from "./runtime.config";

const isCheckMode = process.argv.includes("--check");
const persistenceFile =
	process.env.DSAR_PERSISTENCE_SQLITE_PATH ?? ".dsar-kitchen-sink.db";
const persistenceDriver =
	process.env.DSAR_PERSISTENCE_DRIVER?.toLowerCase() === "pg" ? "pg" : "sqlite";
const pgUrl = process.env.DSAR_PERSISTENCE_PG_URL;
type PersistenceService = Parameters<typeof runtimeReposFromPersistence>[0];

const toRequestHeaders = (incoming: IncomingMessage): Headers => {
	const headers = new Headers();
	for (const [key, value] of Object.entries(incoming.headers)) {
		if (!value) {
			continue;
		}
		if (Array.isArray(value)) {
			for (const entry of value) {
				headers.append(key, entry);
			}
			continue;
		}
		headers.set(key, value);
	}
	return headers;
};

const readRequestBody = async (incoming: IncomingMessage): Promise<Buffer> => {
	const chunks: Buffer[] = [];
	let streamError: unknown;
	const onError = (error: unknown): void => {
		streamError = error;
	};
	incoming.on("error", onError);
	try {
		for await (const chunk of incoming) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
	} catch (error) {
		throw streamError ?? error;
	} finally {
		incoming.off("error", onError);
	}
	return Buffer.concat(chunks);
};

if (isCheckMode) {
	console.log("Config check passed for kitchen-sink example.");
	process.exit(0);
}

const loadPersistence = (): Promise<PersistenceService> =>
	persistenceDriver === "pg"
		? makePgPersistenceService({
				connectionUrl:
					pgUrl ?? "postgres://postgres:postgres@localhost:5432/dsar",
			})
		: makeSqlitePersistenceService({
				filename: persistenceFile,
			});

const toWebRequest = async (
	incoming: IncomingMessage,
	port: number
): Promise<Request> => {
	const host = incoming.headers.host ?? `localhost:${port}`;
	const url = `http://${host}${incoming.url ?? "/"}`;
	const method = incoming.method ?? "GET";
	const body =
		method === "GET" || method === "HEAD"
			? undefined
			: await readRequestBody(incoming);
	const headers = toRequestHeaders(incoming);
	return new Request(url, {
		body: body ? new Uint8Array(body) : undefined,
		headers,
		method,
	});
};

const writeCorsHeaders = (
	outgoing: ServerResponse,
	origin: string | undefined
): void => {
	const allowed = corsOrigin(origin, corsAllowlist());
	if (!allowed) {
		return;
	}
	outgoing.setHeader("Access-Control-Allow-Origin", allowed);
	outgoing.setHeader("Access-Control-Allow-Credentials", "true");
	outgoing.setHeader(
		"Access-Control-Allow-Headers",
		"content-type, authorization"
	);
	outgoing.setHeader(
		"Access-Control-Allow-Methods",
		"GET,POST,PUT,PATCH,DELETE,OPTIONS"
	);
};

const writeWebResponse = async (
	outgoing: ServerResponse,
	response: Response,
	origin: string | undefined
): Promise<void> => {
	outgoing.statusCode = response.status;
	writeCorsHeaders(outgoing, origin);
	for (const [key, value] of response.headers.entries()) {
		outgoing.setHeader(key, value);
	}
	const responseBuffer = Buffer.from(await response.arrayBuffer());
	outgoing.end(responseBuffer);
};

const basePath = runtimeConfig.basePath ?? "/api/v1";
const port = Number.parseInt(process.env.PORT ?? "3021", 10);

const requestorEmail = (payload: unknown): string | undefined => {
	if (payload === null || typeof payload !== "object") {
		return undefined;
	}
	if (!("requestor" in payload)) {
		return undefined;
	}
	const { requestor } = payload;
	if (requestor === null || typeof requestor !== "object") {
		return undefined;
	}
	if (!("email" in requestor) || typeof requestor.email !== "string") {
		return undefined;
	}
	return requestor.email;
};

const start = async (): Promise<void> => {
	const persistence = await loadPersistence();
	const runtime = dsarInstance({
		...runtimeConfig,
		repos: runtimeReposFromPersistence(persistence),
	});
	const demoApp = openDemoApp(
		process.env.DSAR_DEMO_APP_SQLITE_PATH ?? ".dsar-acme.db"
	);
	const adminOrigin = "http://localhost:1357";

	const lookupRequestEmail = async (
		requestId: string
	): Promise<string | undefined> => {
		const response = await runtime.handler(
			new Request(`http://127.0.0.1${basePath}/requests/${requestId}`, {
				headers: {
					accept: "application/json",
					origin: adminOrigin,
				},
				method: "GET",
			})
		);
		const payload: unknown = await response.json().catch(() => null);
		if (
			payload === null ||
			typeof payload !== "object" ||
			!("ok" in payload) ||
			payload.ok !== true ||
			!("data" in payload)
		) {
			return undefined;
		}
		return requestorEmail(payload.data);
	};

	const handleDemo = async (request: Request): Promise<Response | null> => {
		const url = new URL(request.url);
		if (url.pathname === demoPeoplePath && request.method === "GET") {
			const email = url.searchParams.get("email") ?? "";
			return Response.json(demoApp.lookupByEmail(email));
		}
		if (url.pathname === demoWebhookPath && request.method === "POST") {
			const body: unknown = await request.json().catch(() => null);
			if (
				body === null ||
				typeof body !== "object" ||
				!("eventType" in body) ||
				body.eventType !== "request_fulfilled" ||
				!("requestId" in body) ||
				typeof body.requestId !== "string"
			) {
				return Response.json({ ignored: true });
			}
			const email = await lookupRequestEmail(body.requestId);
			if (email === undefined) {
				return Response.json(
					{ deleted: 0, reason: "no_email" },
					{ status: 200 }
				);
			}
			const erased = demoApp.eraseByEmail(email);
			return Response.json({ deleted: erased.deleted, email });
		}
		return null;
	};

	const server = createServer(async (incoming, outgoing) => {
		const origin = Array.isArray(incoming.headers.origin)
			? incoming.headers.origin[0]
			: incoming.headers.origin;
		try {
			if (incoming.method === "OPTIONS") {
				writeCorsHeaders(outgoing, origin);
				outgoing.statusCode = 204;
				outgoing.end();
				return;
			}
			const request = await toWebRequest(incoming, port);
			const demoResponse = await handleDemo(request);
			if (demoResponse) {
				await writeWebResponse(outgoing, demoResponse, origin);
				return;
			}
			const response = await runtime.handler(request);
			await writeWebResponse(outgoing, response, origin);
		} catch (error) {
			console.error("Request handling failed:", error);
			writeCorsHeaders(outgoing, origin);
			outgoing.statusCode = 500;
			outgoing.end("Internal Server Error");
		}
	});

	server.listen(port, () => {
		const rootUrl = `http://localhost:${port}`;
		const baseUrl = basePath === "/" ? rootUrl : `${rootUrl}${basePath}`;
		console.log(`DSAR runtime: ${rootUrl}`);
		console.log(`Status: ${baseUrl}/status`);
		console.log(`OpenAPI: ${baseUrl}/spec.json`);
		console.log(`Docs: ${baseUrl}/docs`);
		if (persistenceDriver === "pg") {
			console.log(`Persistence: pg (${pgUrl ?? "default local connection"})`);
		} else {
			console.log(`Persistence: sqlite (${persistenceFile})`);
		}
		console.log(
			`Acme app: sqlite (${process.env.DSAR_DEMO_APP_SQLITE_PATH ?? ".dsar-acme.db"})`
		);
		console.log(`Acme lookup: ${rootUrl}${demoPeoplePath}?email=`);
	});
};

await start();
