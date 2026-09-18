import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Request categories this demo knows how to map. */
export type DemoRequestType = "access" | "delete";

/** Demo user row keyed by the DSAR request id assigned at intake. */
export interface DemoUser {
	readonly email: string;
	readonly id: string;
	readonly requestId: string;
	readonly requestType: DemoRequestType;
}

interface StoreSnapshot {
	readonly processedEventIds: readonly string[];
	readonly users: readonly DemoUser[];
}

/** Signed smoke fixtures use these request ids. */
export const SMOKE_ACCESS_REQUEST_ID = "req_smoke_access";
export const SMOKE_DELETE_REQUEST_ID = "req_smoke_delete";

export class DemoStoreError extends Error {
	override readonly name = "DemoStoreError";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const isRequestType = (value: unknown): value is DemoRequestType =>
	value === "access" || value === "delete";

const storePath = (): string =>
	process.env.DEMO_STORE_PATH?.trim() ||
	resolve(process.cwd(), ".demo-users.json");

const defaultUsers = (): DemoUser[] => [
	{
		email: "alex.subject@example.com",
		id: "user_delete_001",
		requestId: SMOKE_DELETE_REQUEST_ID,
		requestType: "delete",
	},
	{
		email: "sam.access@example.com",
		id: "user_access_001",
		requestId: SMOKE_ACCESS_REQUEST_ID,
		requestType: "access",
	},
];

const readDemoUser = (value: unknown): DemoUser | undefined => {
	if (!isRecord(value)) {
		return undefined;
	}
	const email = readString(value.email);
	const id = readString(value.id);
	const requestId = readString(value.requestId);
	const { requestType } = value;
	if (!(email && id && requestId && isRequestType(requestType))) {
		return undefined;
	}
	return { email, id, requestId, requestType };
};

const emptySnapshot = (): StoreSnapshot => ({
	processedEventIds: [],
	users: defaultUsers(),
});

const decodeSnapshot = (value: unknown): StoreSnapshot => {
	if (!isRecord(value)) {
		throw new DemoStoreError("Demo store JSON must be an object.");
	}
	const users = Array.isArray(value.users)
		? value.users.flatMap((entry) => {
				const user = readDemoUser(entry);
				return user ? [user] : [];
			})
		: [];
	const processedEventIds = Array.isArray(value.processedEventIds)
		? value.processedEventIds.flatMap((entry) => {
				const eventId = readString(entry);
				return eventId ? [eventId] : [];
			})
		: [];
	return { processedEventIds, users };
};

const readStore = (): StoreSnapshot => {
	const path = storePath();
	if (!existsSync(path)) {
		return emptySnapshot();
	}
	try {
		return decodeSnapshot(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		if (error instanceof DemoStoreError) {
			throw error;
		}
		throw new DemoStoreError("Failed to read the demo store.", {
			cause: error,
		});
	}
};

const writeStore = (snapshot: StoreSnapshot): void => {
	const path = storePath();
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(snapshot, null, "\t")}\n`, "utf8");
	} catch (error) {
		throw new DemoStoreError("Failed to write the demo store.", {
			cause: error,
		});
	}
};

/** Replace the demo store with the supplied users. Used by tests. */
export const seedDemoUsers = (users: readonly DemoUser[]): void => {
	writeStore({ processedEventIds: [], users });
};

/** Look up a demo user by the DSAR request id stored at intake. */
export const findUserByRequestId = (requestId: string): DemoUser | undefined =>
	readStore().users.find((user) => user.requestId === requestId);

/**
 * Apply a verified `request_fulfilled` event.
 *
 * Erases the mapped row only when that request was stored as `delete`.
 * Access fulfilments ACK without deleting. Duplicate `eventId`s are no-ops.
 */
export const applyFulfilment = (input: {
	readonly eventId: string;
	readonly requestId: string;
}): { readonly alreadyProcessed: boolean; readonly deleted: boolean } => {
	const snapshot = readStore();
	if (snapshot.processedEventIds.includes(input.eventId)) {
		return { alreadyProcessed: true, deleted: false };
	}

	const user = snapshot.users.find(
		(entry) => entry.requestId === input.requestId
	);
	const deleted = user?.requestType === "delete";
	const users = deleted
		? snapshot.users.filter((entry) => entry.id !== user.id)
		: snapshot.users;

	writeStore({
		processedEventIds: [...snapshot.processedEventIds, input.eventId],
		users,
	});
	return { alreadyProcessed: false, deleted };
};
