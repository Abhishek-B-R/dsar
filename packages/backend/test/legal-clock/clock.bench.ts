import type {
	RequestRecord,
	RequestTimelineEventRecord,
} from "@dsar/persistence";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { computeLegalClock } from "../../src/services/legal-clock/engine";
import baseline from "./clock.bench.baseline.json" with { type: "json" };

const HOUR_IN_MS = 60 * 60 * 1000;

const addHoursIso = (iso: string, hours: number): string =>
	new Date(new Date(iso).getTime() + hours * HOUR_IN_MS).toISOString();

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

const baseRequest = (): RequestRecord => ({
	appeals: [],
	authority: { status: "not_required" },
	capture: {
		intakeSource: {
			receivedAt: "2026-01-01T00:00:00.000Z",
			type: "api",
		},
		policy: {
			clarificationEffect: "stop_clock",
			maxAdditionalDays: 60,
			policyPack: "global-default",
			policyVersion: "v1",
			responseDeadlineDays: 30,
			verificationEffect: "stop_clock",
		},
	},
	clockMode: "receipt",
	createdAt: "2026-01-01T00:00:00.000Z",
	dueAt: "2026-01-31T00:00:00.000Z",
	id: "req-clock-bench",
	receivedAt: "2025-12-31T00:00:00.000Z",
	requestor: { type: "subject" },
	status: "captured",
	tenantId: "tenant-bench",
	updatedAt: "2026-01-01T00:00:00.000Z",
});

const timelineEventTypes = [
	"verification_requested",
	"verification_resolved",
	"clarification_requested",
	"clarification_received",
	"deadline_extended",
] as const;

const buildTimeline = (
	eventCount: number
): readonly RequestTimelineEventRecord[] => {
	const receivedAt = "2026-01-01T00:00:00.000Z";
	return Array.from({ length: eventCount }, (_, index) => {
		const eventType = timelineEventTypes[index % timelineEventTypes.length];
		return {
			createdAt: addHoursIso(receivedAt, index * 6),
			eventType,
			id: `ev-clock-bench-${index.toString().padStart(4, "0")}`,
			payload: eventType === "deadline_extended" ? { additionalDays: 1 } : {},
			requestId: "req-clock-bench",
			tenantId: "tenant-bench",
		};
	});
};

describe("legal clock recompute bench", () => {
	it("keeps computeLegalClock p95 under the recorded bound", () => {
		const timelineEvents = buildTimeline(baseline.eventCount);
		const lastEvent = timelineEvents.at(-1);
		if (lastEvent === undefined) {
			throw new Error("clock bench fixture has no events");
		}
		const input = {
			actor: "bench",
			now: addHoursIso(lastEvent.createdAt, 6),
			persistedSegments: [],
			request: baseRequest(),
			timelineEvents,
		};
		const computed = Effect.runSync(computeLegalClock(input));
		expect(computed.pauses.length).toBeGreaterThan(0);
		expect(computed.segments.length).toBeGreaterThan(1);
		expect(Date.parse(computed.finalDueAt)).toBeGreaterThan(
			Date.parse(computed.baseDueAt)
		);

		for (let warmup = 0; warmup < baseline.warmup; warmup += 1) {
			Effect.runSync(computeLegalClock(input));
		}

		const samples: number[] = [];
		for (let sample = 0; sample < baseline.samples; sample += 1) {
			const started = performance.now();
			Effect.runSync(computeLegalClock(input));
			samples.push(performance.now() - started);
		}

		const p95Ms = percentileMs(samples, 95);
		expect(
			p95Ms,
			`clock recompute p95 ${p95Ms.toFixed(3)}ms over ${baseline.eventCount} events (bound ${baseline.boundMs}ms, recorded ${baseline.measuredP95Ms}ms)`
		).toBeLessThan(baseline.boundMs);
	});
});
