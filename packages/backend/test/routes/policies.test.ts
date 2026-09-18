import type { PolicyPack } from "@dsar/policy-engine";
import {
	PolicyPackDiff,
	PolicyPackDiffLive,
	ukDefaultPack,
} from "@dsar/policy-packs";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { dsarInstance } from "../../src";
import { TEST_ADMIN_HEADERS, TEST_RUNTIME_AUTH, TEST_TENANT_ID } from "../auth";
import { makeMemoryPersistence } from "../e2e/fixtures";

interface UpgradeEnvelope {
	readonly ok: boolean;
	readonly data: {
		readonly id: string;
		readonly status: string;
		readonly diff: unknown;
	};
}

const fromPack: PolicyPack = {
	...ukDefaultPack.pack,
	jurisdiction: "global",
	packId: "pack-global",
	version: "1.0.0",
};

const toPack: PolicyPack = {
	...fromPack,
	sections: {
		...fromPack.sections,
		clock: {
			...fromPack.sections.clock,
			verificationEffect: "no_stop_clock",
		},
	},
	version: "1.1.0",
};

const makeRuntime = () =>
	dsarInstance({
		...TEST_RUNTIME_AUTH,
		repos: { persistence: makeMemoryPersistence() },
	});

const postJson = (
	runtime: ReturnType<typeof makeRuntime>,
	path: string,
	body?: unknown
) =>
	runtime.handler(
		new Request(`https://example.test${path}`, {
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			headers: {
				"content-type": "application/json",
				...TEST_ADMIN_HEADERS,
			},
			method: "POST",
		})
	);

const registerPack = (
	runtime: ReturnType<typeof makeRuntime>,
	pack: PolicyPack,
	releaseType: "major" | "minor"
) =>
	postJson(runtime, "/policies/custom/register", {
		jurisdiction: "global",
		metadata: {
			changelog: `Release ${pack.version}`,
			compatibilityNotes: `Compatibility reviewed for ${pack.version}`,
			releaseType,
		},
		name: "global-default",
		pack,
		publishedAt: "2026-01-01T00:00:00.000Z",
		version: pack.version,
	});

const expectedUpgradeDiff = () =>
	Effect.runPromise(
		Effect.flatMap(Effect.service(PolicyPackDiff), (diff) =>
			diff.diff(fromPack, toPack)
		).pipe(Effect.provide(PolicyPackDiffLive))
	);

describe("policy upgrade routes", () => {
	it("walks propose, approve, and apply and returns PolicyPackDiff output", async () => {
		const runtime = makeRuntime();
		const registeredFrom = await registerPack(runtime, fromPack, "major");
		const registeredTo = await registerPack(runtime, toPack, "minor");
		expect(registeredFrom.status).toBe(202);
		expect(registeredTo.status).toBe(202);

		const proposed = await postJson(runtime, "/policies/upgrades/propose", {
			fromVersion: fromPack.version,
			tenantId: TEST_TENANT_ID,
			toVersion: toPack.version,
		});
		expect(proposed.status).toBe(202);
		const proposedBody = (await proposed.json()) as UpgradeEnvelope;
		expect(proposedBody.ok).toBe(true);
		expect(proposedBody.data.status).toBe("pending_approval");
		expect(proposedBody.data.diff).toStrictEqual(await expectedUpgradeDiff());

		const approved = await postJson(
			runtime,
			`/policies/upgrades/${proposedBody.data.id}/approve`
		);
		expect(approved.status).toBe(202);
		const approvedBody = (await approved.json()) as UpgradeEnvelope;
		expect(approvedBody.data.status).toBe("approved");

		const applied = await postJson(
			runtime,
			`/policies/upgrades/${proposedBody.data.id}/apply`
		);
		expect(applied.status).toBe(202);
		const appliedBody = (await applied.json()) as UpgradeEnvelope;
		expect(appliedBody.data.status).toBe("applied");
	});
});
