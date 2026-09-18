import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	findUserByRequestId,
	seedDemoUsers,
	SMOKE_ACCESS_REQUEST_ID,
	SMOKE_DELETE_REQUEST_ID,
} from "../lib/store";

const signingSecret = "smoke-test-signing-secret";

const demoUsers = [
	{
		email: "alex.subject@example.com",
		id: "user_delete_001",
		requestId: SMOKE_DELETE_REQUEST_ID,
		requestType: "delete" as const,
	},
	{
		email: "sam.access@example.com",
		id: "user_access_001",
		requestId: SMOKE_ACCESS_REQUEST_ID,
		requestType: "access" as const,
	},
];

const signBody = (body: string): string =>
	createHmac("sha256", signingSecret).update(body).digest("hex");

const webhookEvent = (input: {
	readonly eventId: string;
	readonly eventType: string;
	readonly payload: Record<string, unknown>;
	readonly requestId: string;
}): string =>
	JSON.stringify({
		correlationId: "corr_smoke_123",
		eventId: input.eventId,
		eventType: input.eventType,
		idempotencyKey: `idem_${input.eventId}`,
		locale: "en-US",
		payload: input.payload,
		policyVersion: "2026.1",
		requestId: input.requestId,
	});

const postWebhook = async (
	rawBody: string,
	signature?: string
): Promise<Response> => {
	const { POST } = await import("../app/api/webhooks/dsar/route");
	const headers = new Headers({ "content-type": "application/json" });
	if (signature) {
		headers.set("x-dsar-signature", signature);
	}
	return POST(
		new Request("http://localhost:3000/api/webhooks/dsar", {
			body: rawBody,
			headers,
			method: "POST",
		})
	);
};

const withTempStore = async (run: () => Promise<void>): Promise<void> => {
	const directory = mkdtempSync(join(tmpdir(), "dsar-deletion-webhook-"));
	const previousStore = process.env.DEMO_STORE_PATH;
	const previousSecret = process.env.DSAR_WEBHOOK_SECRET;
	process.env.DEMO_STORE_PATH = join(directory, "users.json");
	process.env.DSAR_WEBHOOK_SECRET = signingSecret;
	seedDemoUsers(demoUsers);
	try {
		await run();
	} finally {
		if (previousStore === undefined) {
			delete process.env.DEMO_STORE_PATH;
		} else {
			process.env.DEMO_STORE_PATH = previousStore;
		}
		if (previousSecret === undefined) {
			delete process.env.DSAR_WEBHOOK_SECRET;
		} else {
			process.env.DSAR_WEBHOOK_SECRET = previousSecret;
		}
		rmSync(directory, { force: true, recursive: true });
	}
};

afterEach(() => {
	delete process.env.DEMO_STORE_PATH;
	delete process.env.DSAR_WEBHOOK_SECRET;
});

describe("Next.js deletion webhook", () => {
	it("deletes the mapped user on a signed request_fulfilled event", async () => {
		await withTempStore(async () => {
			const rawBody = webhookEvent({
				eventId: "evt_smoke_delete",
				eventType: "request_fulfilled",
				payload: { from: "in_progress", to: "fulfilled" },
				requestId: SMOKE_DELETE_REQUEST_ID,
			});

			const response = await postWebhook(rawBody, signBody(rawBody));

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({ ok: true });
			expect(findUserByRequestId(SMOKE_DELETE_REQUEST_ID)).toBeUndefined();
			expect(findUserByRequestId(SMOKE_ACCESS_REQUEST_ID)?.id).toBe(
				"user_access_001"
			);
		});
	});

	it("is idempotent for a retried fulfilment event", async () => {
		await withTempStore(async () => {
			const rawBody = webhookEvent({
				eventId: "evt_smoke_retry",
				eventType: "request_fulfilled",
				payload: { from: "in_progress", to: "fulfilled" },
				requestId: SMOKE_DELETE_REQUEST_ID,
			});
			const signature = signBody(rawBody);

			await expect(postWebhook(rawBody, signature)).resolves.toMatchObject({
				status: 200,
			});
			const retry = await postWebhook(rawBody, signature);

			expect(retry.status).toBe(200);
			await expect(retry.json()).resolves.toEqual({ ok: true });
			expect(findUserByRequestId(SMOKE_DELETE_REQUEST_ID)).toBeUndefined();
		});
	});

	it("does not delete on request_captured", async () => {
		await withTempStore(async () => {
			const rawBody = webhookEvent({
				eventId: "evt_smoke_capture",
				eventType: "request_captured",
				payload: {
					action: "capture",
					dueAt: "2026-09-29T12:00:00.000Z",
					status: "captured",
				},
				requestId: SMOKE_DELETE_REQUEST_ID,
			});

			const response = await postWebhook(rawBody, signBody(rawBody));

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({ ok: true });
			expect(findUserByRequestId(SMOKE_DELETE_REQUEST_ID)?.id).toBe(
				"user_delete_001"
			);
		});
	});

	it("does not delete when fulfilment is for an access request", async () => {
		await withTempStore(async () => {
			const rawBody = webhookEvent({
				eventId: "evt_smoke_access",
				eventType: "request_fulfilled",
				payload: { from: "in_progress", to: "fulfilled" },
				requestId: SMOKE_ACCESS_REQUEST_ID,
			});

			const response = await postWebhook(rawBody, signBody(rawBody));

			expect(response.status).toBe(200);
			expect(findUserByRequestId(SMOKE_ACCESS_REQUEST_ID)?.id).toBe(
				"user_access_001"
			);
			expect(findUserByRequestId(SMOKE_DELETE_REQUEST_ID)?.id).toBe(
				"user_delete_001"
			);
		});
	});

	it("rejects a missing signature", async () => {
		await withTempStore(async () => {
			const rawBody = webhookEvent({
				eventId: "evt_smoke_missing_sig",
				eventType: "request_fulfilled",
				payload: { from: "in_progress", to: "fulfilled" },
				requestId: SMOKE_DELETE_REQUEST_ID,
			});

			const response = await postWebhook(rawBody);

			expect(response.status).toBe(401);
			await expect(response.json()).resolves.toEqual({
				error: "missing_signature",
				ok: false,
			});
			expect(findUserByRequestId(SMOKE_DELETE_REQUEST_ID)?.id).toBe(
				"user_delete_001"
			);
		});
	});

	it("rejects an invalid signature", async () => {
		await withTempStore(async () => {
			const rawBody = webhookEvent({
				eventId: "evt_smoke_bad_sig",
				eventType: "request_fulfilled",
				payload: { from: "in_progress", to: "fulfilled" },
				requestId: SMOKE_DELETE_REQUEST_ID,
			});

			const response = await postWebhook(rawBody, "not-a-valid-hmac");

			expect(response.status).toBe(401);
			await expect(response.json()).resolves.toEqual({
				error: "invalid_signature",
				ok: false,
			});
			expect(findUserByRequestId(SMOKE_DELETE_REQUEST_ID)?.id).toBe(
				"user_delete_001"
			);
		});
	});
});
