import { describe, expect, it } from "@effect/vitest";

import type { ErrorEnvelope } from "../../src";
import { dsarInstance } from "../../src";
import {
	TEST_ADMIN_HEADERS,
	TEST_MEMBER_HEADERS,
	TEST_RUNTIME_AUTH,
} from "../auth";
import { makeMemoryPersistence } from "../e2e/fixtures";

const authHeaders = {
	admin: TEST_ADMIN_HEADERS,
	member: TEST_MEMBER_HEADERS,
} as const;

type AuthActor = keyof typeof authHeaders;

interface InvalidBodyCase {
	readonly actor: AuthActor;
	readonly body: string;
	readonly code: "REQUEST_BODY_INVALID_JSON" | "REQUEST_VALIDATION_FAILED";
	readonly name: string;
	readonly path: string;
}

const INVALID_BODY_CASES: readonly InvalidBodyCase[] = [
	{
		actor: "member",
		body: '{"intakeSource":',
		code: "REQUEST_BODY_INVALID_JSON",
		name: "capture malformed JSON",
		path: "/requests/capture",
	},
	{
		actor: "member",
		body: "{}",
		code: "REQUEST_VALIDATION_FAILED",
		name: "capture empty object",
		path: "/requests/capture",
	},
	{
		actor: "member",
		body: "null",
		code: "REQUEST_VALIDATION_FAILED",
		name: "capture JSON null",
		path: "/requests/capture",
	},
	{
		actor: "member",
		body: JSON.stringify({
			intakeSource: null,
			jurisdiction: "uk",
		}),
		code: "REQUEST_VALIDATION_FAILED",
		name: "capture null intakeSource",
		path: "/requests/capture",
	},
	{
		actor: "member",
		body: JSON.stringify({
			intakeSource: "api",
			jurisdiction: "uk",
		}),
		code: "REQUEST_VALIDATION_FAILED",
		name: "capture intakeSource wrong type",
		path: "/requests/capture",
	},
	{
		actor: "member",
		body: JSON.stringify({
			intakeSource: { channel: "api" },
			jurisdiction: "uk",
		}),
		code: "REQUEST_VALIDATION_FAILED",
		name: "capture missing intakeSource.receivedAt",
		path: "/requests/capture",
	},
	{
		actor: "member",
		body: JSON.stringify({
			intakeSource: { receivedAt: 1 },
			jurisdiction: "uk",
		}),
		code: "REQUEST_VALIDATION_FAILED",
		name: "capture receivedAt wrong type",
		path: "/requests/capture",
	},
	{
		actor: "member",
		body: JSON.stringify({
			intakeSource: { receivedAt: null },
			jurisdiction: "uk",
		}),
		code: "REQUEST_VALIDATION_FAILED",
		name: "capture receivedAt null",
		path: "/requests/capture",
	},
	{
		actor: "admin",
		body: "{",
		code: "REQUEST_BODY_INVALID_JSON",
		name: "rotate-key malformed JSON",
		path: "/webhooks/endpoints/default/rotate-key",
	},
	{
		actor: "admin",
		body: JSON.stringify({ gracePeriodDays: -1 }),
		code: "REQUEST_VALIDATION_FAILED",
		name: "rotate-key gracePeriodDays negative",
		path: "/webhooks/endpoints/default/rotate-key",
	},
	{
		actor: "admin",
		body: JSON.stringify({ gracePeriodDays: 1.5 }),
		code: "REQUEST_VALIDATION_FAILED",
		name: "rotate-key gracePeriodDays fractional",
		path: "/webhooks/endpoints/default/rotate-key",
	},
	{
		actor: "admin",
		body: JSON.stringify({ gracePeriodDays: Number.MAX_SAFE_INTEGER }),
		code: "REQUEST_VALIDATION_FAILED",
		name: "rotate-key gracePeriodDays above supported range",
		path: "/webhooks/endpoints/default/rotate-key",
	},
	{
		actor: "admin",
		body: JSON.stringify({
			fromVersion: null,
			tenantId: "tenant-default",
			toVersion: "1.0.0",
		}),
		code: "REQUEST_VALIDATION_FAILED",
		name: "policy propose null required field",
		path: "/policies/upgrades/propose",
	},
	{
		actor: "admin",
		body: JSON.stringify({
			fromVersion: 1,
			tenantId: "tenant-default",
			toVersion: "1.0.0",
		}),
		code: "REQUEST_VALIDATION_FAILED",
		name: "policy propose wrong type",
		path: "/policies/upgrades/propose",
	},
];

describe("invalid HTTP request bodies", () => {
	it.each(INVALID_BODY_CASES)(
		"$name returns 400 $code",
		async ({ actor, body, code, path }) => {
			const runtime = dsarInstance({
				...TEST_RUNTIME_AUTH,
				repos: { persistence: makeMemoryPersistence() },
			});
			const response = await runtime.handler(
				new Request(`https://example.test${path}`, {
					body,
					headers: {
						"content-type": "application/json",
						...authHeaders[actor],
					},
					method: "POST",
				})
			);
			const payload = (await response.json()) as ErrorEnvelope;

			expect(response.status).toBe(400);
			expect(payload.ok).toBe(false);
			expect(payload.error.code).toBe(code);
			expect(payload.error.code).not.toBe("INTERNAL_RUNTIME_ERROR");
			expect(payload.error.status).toBe(400);
		}
	);
});
