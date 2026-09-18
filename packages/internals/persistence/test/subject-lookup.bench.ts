import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeSqlitePersistenceLayer } from "../../persistence-sqlite/src";
import { Persistence, withTenant } from "../src";
import {
	extractRequestLookupFields,
	jsonEncode,
} from "../src/services/persistence/shared";
import type { Sql } from "../src/services/persistence/shared";
import baseline from "./subject-lookup.bench.baseline.json" with { type: "json" };

const SQLITE_INSERT_BATCH_SIZE = 500;

const percentileMs = (
	samples: readonly number[],
	percentile: number
): number => {
	if (samples.length === 0) {
		throw new Error("bench produced no samples");
	}
	const sorted = samples.toSorted((left, right) => left - right);
	const rank = Math.ceil((percentile / 100) * sorted.length) - 1;
	const value = sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
	if (value === undefined) {
		throw new Error("bench percentile index was empty");
	}
	return value;
};

const scaledSubjectLookupSeedInput = (scale: number, index: number) => ({
	appeals: [],
	authority: { status: "verified", type: "subject" },
	capture: {
		policy: {
			policyPack: index % 4 === 0 ? "pack-scale" : "pack-other",
		},
		subject: {
			subjectId: index % 100 === 0 ? "subject-scale" : "subject-other",
		},
	},
	clockMode: "calendar_days",
	dueAt: "2026-02-01T00:00:00.000Z",
	id: `req-bench-${scale}-${index.toString().padStart(5, "0")}`,
	receivedAt: `2026-03-${((index % 28) + 1).toString().padStart(2, "0")}T00:00:00.000Z`,
	requestor: { type: "subject" },
	status: index % 2 === 0 ? "in_progress" : "fulfilled",
});

const seedRequestsDirectly = (scale: number) => (sql: Sql) =>
	sql.withTransaction(
		Effect.forEach(
			Array.from(
				{ length: Math.ceil(scale / SQLITE_INSERT_BATCH_SIZE) },
				(_, batchIndex) => batchIndex
			),
			(batchIndex) => {
				const start = batchIndex * SQLITE_INSERT_BATCH_SIZE;
				const rows = Array.from(
					{
						length: Math.min(SQLITE_INSERT_BATCH_SIZE, scale - start),
					},
					(_, offset) => {
						const input = scaledSubjectLookupSeedInput(scale, start + offset);
						const lookupFields = extractRequestLookupFields(input);
						return {
							appeals_json: jsonEncode(input.appeals),
							authority_json: jsonEncode(input.authority),
							capture_json: jsonEncode(input.capture),
							clock_mode: input.clockMode,
							created_at: input.receivedAt,
							due_at: input.dueAt,
							id: input.id,
							policy_pack: lookupFields.policyPack,
							received_at: input.receivedAt,
							requestor_email: lookupFields.requestorEmail,
							requestor_json: jsonEncode(input.requestor),
							status: input.status,
							subject_external_ref: lookupFields.subjectExternalRef,
							subject_id: lookupFields.subjectId,
							tenant_id: "tenant-bench",
							updated_at: input.receivedAt,
						};
					}
				);
				return sql`INSERT INTO requests ${sql.insert(rows)}`;
			},
			{ concurrency: 1, discard: true }
		)
	);

describe("subject lookup bench", () => {
	it("keeps indexed listBySubject p95 under the recorded bound", async () => {
		const result = await Effect.runPromise(
			Effect.gen(function* subjectLookupBench() {
				const persistence = yield* Effect.service(Persistence);
				const lookup = persistence.requests.listBySubject({
					identifiers: ["subject-scale"],
					limit: 25,
					policyPack: "pack-scale",
					status: ["in_progress"],
				});

				const firstPage = yield* lookup;
				for (let warmup = 0; warmup < baseline.warmup; warmup += 1) {
					yield* lookup;
				}

				const samples: number[] = [];
				for (let sample = 0; sample < baseline.samples; sample += 1) {
					const started = performance.now();
					yield* lookup;
					samples.push(performance.now() - started);
				}

				return {
					itemCount: firstPage.items.length,
					p95Ms: percentileMs(samples, 95),
				};
			}).pipe(
				Effect.provide(
					makeSqlitePersistenceLayer({
						disableWAL: true,
						filename: ":memory:",
						migrationHooks: {
							afterMigrations: seedRequestsDirectly(baseline.requestCount),
						},
					})
				),
				withTenant("tenant-bench")
			)
		);

		expect(result.itemCount).toBeGreaterThan(0);
		expect(
			result.p95Ms,
			`subject lookup p95 ${result.p95Ms.toFixed(3)}ms over ${baseline.requestCount} indexed rows (bound ${baseline.boundMs}ms, recorded ${baseline.measuredP95Ms}ms)`
		).toBeLessThan(baseline.boundMs);
	}, 30_000);
});
