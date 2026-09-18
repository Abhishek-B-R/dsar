import { describe, expect, it } from "@effect/vitest";

import { webhooksCommands } from "#src/commands/webhooks";
import type {
	ApiRequest,
	CommandExecutionContext,
	GlobalCliConfig,
} from "#src/types";

const makeContext = (input: {
	readonly flags: Readonly<Record<string, string>>;
	readonly invoke: (request: ApiRequest) => Promise<unknown>;
	readonly params?: Readonly<Record<string, string>>;
}): CommandExecutionContext => ({
	api: { invoke: input.invoke },
	input: {
		commandTokens: ["webhooks", "dlq"],
		flags: input.flags,
		global: {
			apiUrl: "https://example.test",
			fetch,
			output: "json",
		} satisfies GlobalCliConfig,
	},
	params: input.params ?? {},
	writeLine: () => {
		// no-op
	},
});

const commandById = (id: string) => {
	const command = webhooksCommands.find((entry) => entry.id === id);
	if (!command) {
		throw new Error(`Missing webhook command '${id}'.`);
	}
	return command;
};

describe("webhook DLQ commands", () => {
	it("pins status=dead on dlq list", async () => {
		const calls: ApiRequest[] = [];
		await commandById("webhooks_dlq_list").execute(
			makeContext({
				flags: { limit: "25" },
				invoke: (request) => {
					calls.push(request);
					return Promise.resolve({
						data: { items: [], limit: 25, offset: 0, total: 0 },
					});
				},
			})
		);
		expect(calls).toStrictEqual([
			expect.objectContaining({
				method: "GET",
				path: "/webhooks/dispatches",
				query: expect.objectContaining({
					limit: "25",
					status: "dead",
				}),
			}),
		]);
	});

	it("pins status=dead on dlq replay-all", async () => {
		const calls: ApiRequest[] = [];
		await commandById("webhooks_dlq_replay_bulk").execute(
			makeContext({
				flags: {
					"endpoint-id": "default",
					"idempotency-key": "replay-dead-all-1",
					limit: "10",
				},
				invoke: (request) => {
					calls.push(request);
					return Promise.resolve({
						data: {
							alreadyReplayed: 0,
							replayed: 0,
							results: [],
							total: 0,
						},
					});
				},
			})
		);
		expect(calls).toStrictEqual([
			expect.objectContaining({
				body: expect.objectContaining({
					endpoint_id: "default",
					limit: 10,
					status: "dead",
				}),
				headers: expect.objectContaining({
					"x-idempotency-key": "replay-dead-all-1",
				}),
				method: "POST",
				path: "/webhooks/dispatches/replay",
			}),
		]);
	});
});
