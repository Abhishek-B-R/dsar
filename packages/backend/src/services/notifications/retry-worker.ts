import { asRecordOrEmpty } from "@dsar/guards";
import { withTenant } from "@dsar/persistence";
import type {
	NotificationDeliveryAttemptRecord,
	NotificationEventRecord,
} from "@dsar/persistence";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

import { normalizeAdapterError, toAdapterFailureEvent } from "../../adapters";
import type { AdapterContractError } from "../../adapters";
import type { NotificationEventType } from "../../events/contracts";
import { makeRequestId } from "../../middleware/auth-context";
import { RequestValidationError } from "../../types/errors";
import type {
	NotificationDispatchInput,
	NotificationDispatchResult,
	RuntimeServices,
} from "../../types/runtime";
import { RuntimeServicesTag } from "../../types/runtime";
import { webhookClaimLeaseMs, webhookRetryDelayMs } from "./backoff";
import { dispatchWebhookNotification } from "./webhook";

const DEFAULT_WEBHOOK_ENDPOINT_ID = "default";
const DEFAULT_WEBHOOK_TIMEOUT_MS = 30_000;
const WEBHOOK_RETRY_WORKER_POLL = "1 second";
const NOTIFICATION_EVENT_TYPES = [
	"request_captured",
	"clock_due_changed",
	"clock_segment_opened",
	"clock_segment_closed",
	"request_acknowledged",
	"acknowledgement_sent",
	"verification_outcome_recorded",
	"manifest_review_recorded",
	"appeal_recorded",
	"fulfillment_callback_received",
	"delivery_prepared",
	"step_up_challenge_issued",
	"request_fulfilled",
	"request_refused",
] as const satisfies readonly NotificationEventType[];

const currentIsoTime: Effect.Effect<string> = Clock.currentTimeMillis.pipe(
	Effect.map((ms) => new Date(ms).toISOString())
);

const isoTimeOffset = (offsetMs: number): Effect.Effect<string> =>
	Clock.currentTimeMillis.pipe(
		Effect.map((ms) => new Date(ms + offsetMs).toISOString())
	);

const isNotificationEventType = (
	value: string
): value is NotificationEventType => {
	for (const eventType of NOTIFICATION_EVENT_TYPES) {
		if (eventType === value) {
			return true;
		}
	}
	return false;
};

const toDispatchInputFromEvent = (
	event: NotificationEventRecord
): Effect.Effect<NotificationDispatchInput, RequestValidationError> => {
	if (!isNotificationEventType(event.eventType)) {
		return Effect.fail(
			new RequestValidationError({
				details: { eventType: event.eventType },
				message:
					"Webhook dispatch cannot be retried because the persisted notification event type is not supported.",
				reasonCode: "REQUEST_VALIDATION_FAILED",
			})
		);
	}
	const normalizedPayload =
		typeof event.payload === "object" &&
		event.payload !== null &&
		!Array.isArray(event.payload)
			? asRecordOrEmpty(event.payload)
			: { value: event.payload };
	return Effect.succeed({
		correlationId: event.correlationId,
		eventId: event.id,
		eventType: event.eventType,
		idempotencyKey: event.idempotencyKey,
		locale: event.locale,
		payload: normalizedPayload,
		policyVersion: event.policyVersion,
		requestId: event.requestId,
	});
};

const nextWebhookAttemptNumber = (
	attempts: readonly NotificationDeliveryAttemptRecord[]
): number => {
	let maxAttempt = 0;
	for (const attempt of attempts) {
		if (attempt.channel === "webhook") {
			maxAttempt = Math.max(maxAttempt, attempt.attempt);
		}
	}
	return maxAttempt + 1;
};

const supportsNotificationChannel = (
	adapter:
		| { readonly channels?: readonly string[]; readonly key: string }
		| undefined,
	channel: "email" | "webhook"
): boolean => {
	if (!adapter) {
		return false;
	}
	if (adapter.channels) {
		return adapter.channels.includes(channel);
	}
	return channel === "webhook" && adapter.key !== "outbound-resend";
};

const resolveWebhookSigningKey = (input: {
	readonly config: NonNullable<
		RuntimeServices["config"]["notificationWebhook"]
	>;
	readonly services: RuntimeServices;
	readonly tenantId: string;
	readonly createdAt: string;
}) =>
	input.services.repos.persistence.webhookEndpoints
		.ensureConfigured({
			createdAt: input.createdAt,
			id: input.config.endpointId ?? DEFAULT_WEBHOOK_ENDPOINT_ID,
			signingSecret: input.config.signingSecret,
			url: input.config.url,
		})
		.pipe(
			withTenant(input.tenantId),
			Effect.map(({ primaryKey }) => ({
				id: primaryKey.id,
				secret: primaryKey.secret,
			}))
		);

const requireTenantId = (
	tenantId: string | undefined
): Effect.Effect<string, RequestValidationError> => {
	if (!tenantId || tenantId.length === 0) {
		return Effect.fail(
			new RequestValidationError({
				message: "Webhook retry processing requires tenant scope.",
				reasonCode: "REQUEST_VALIDATION_FAILED",
			})
		);
	}
	return Effect.succeed(tenantId);
};

const makeWebhookSender = (input: {
	readonly services: RuntimeServices;
	readonly tenantId: string;
	readonly createdAt: string;
}) =>
	Effect.gen(function* makeWebhookSenderProgram() {
		const webhookConfig = input.services.config.notificationWebhook;
		if (!webhookConfig || webhookConfig.url.length === 0) {
			return;
		}
		const resolvedNotificationAdapter =
			input.services.adapterRegistry.resolveNotification();
		const webhookAdapter = supportsNotificationChannel(
			resolvedNotificationAdapter,
			"webhook"
		)
			? resolvedNotificationAdapter
			: undefined;
		const signingKey = yield* resolveWebhookSigningKey({
			config: webhookConfig,
			createdAt: input.createdAt,
			services: input.services,
			tenantId: input.tenantId,
		});
		return {
			adapterKey: webhookAdapter?.key ?? "webhook-fallback",
			destination: webhookConfig.url,
			retryMaxAttempts: webhookConfig.retryMaxAttempts,
			send: (dispatchInput: NotificationDispatchInput) =>
				webhookAdapter
					? webhookAdapter.send({
							...dispatchInput,
							webhookSigningKey: signingKey,
						})
					: dispatchWebhookNotification({
							event: dispatchInput,
							signingKey,
							timeoutMs: webhookConfig.timeoutMs,
							url: webhookConfig.url,
						}),
			timeoutMs: webhookConfig.timeoutMs,
		};
	});

const releaseClaim = (input: {
	readonly attemptId: string;
	readonly tenantId: string;
	readonly status: NotificationDeliveryAttemptRecord["status"];
	readonly error?: string;
	readonly responseCode?: number;
	readonly nextAttemptAt?: string | null;
}) =>
	Effect.gen(function* releaseClaimProgram() {
		const services = yield* Effect.service(RuntimeServicesTag);
		yield* services.repos.persistence.notificationDeliveryAttempts
			.update(input.attemptId, {
				claimedAt: null,
				claimedUntil: null,
				error: input.error,
				nextAttemptAt:
					input.nextAttemptAt === undefined ? null : input.nextAttemptAt,
				responseCode: input.responseCode,
				status: input.status,
			})
			.pipe(withTenant(input.tenantId));
	});

const scheduleNextPendingAttempt = (input: {
	readonly tenantId: string;
	readonly requestId: string;
	readonly eventId: string;
	readonly destination: string;
	readonly attempt: number;
	readonly nextAttemptAt: string;
	readonly createdAt: string;
}) =>
	Effect.gen(function* scheduleNextPendingAttemptProgram() {
		const services = yield* Effect.service(RuntimeServicesTag);
		yield* services.repos.persistence.notificationDeliveryAttempts
			.append({
				attempt: input.attempt,
				channel: "webhook",
				createdAt: input.createdAt,
				destination: input.destination,
				id: makeRequestId(),
				nextAttemptAt: input.nextAttemptAt,
				notificationEventId: input.eventId,
				requestId: input.requestId,
				status: "pending",
			})
			.pipe(withTenant(input.tenantId));
	});

const recordAdapterFailure = (input: {
	readonly services: RuntimeServices;
	readonly adapterKey: string;
	readonly error: AdapterContractError;
}) =>
	Effect.gen(function* recordAdapterFailureProgram() {
		const normalized = normalizeAdapterError({
			adapterKey: input.adapterKey,
			capability: "notifications",
			error: input.error,
		});
		const adapterEvent = toAdapterFailureEvent({
			error: normalized,
			requestId: input.services.requestContext.requestId,
		});
		if (input.services.config.onAdapterEvent) {
			yield* Effect.tryPromise(() =>
				Promise.resolve(input.services.config.onAdapterEvent?.(adapterEvent))
			).pipe(Effect.catch(() => Effect.void));
		}
		return normalized;
	});

const finalizeWebhookAttempt = (input: {
	readonly attempt: NotificationDeliveryAttemptRecord;
	readonly tenantId: string;
	readonly retryMaxAttempts: number;
	readonly destination: string;
	readonly result: NotificationDispatchResult;
	readonly retriable: boolean;
}) =>
	Effect.gen(function* finalizeWebhookAttemptProgram() {
		const now = yield* currentIsoTime;
		if (input.result.status === "delivered") {
			yield* releaseClaim({
				attemptId: input.attempt.id,
				error: input.result.error,
				responseCode: input.result.responseCode,
				status: "delivered",
				tenantId: input.tenantId,
			});
			return;
		}
		if (input.result.status === "skipped") {
			yield* releaseClaim({
				attemptId: input.attempt.id,
				error: input.result.error,
				responseCode: input.result.responseCode,
				status: "skipped",
				tenantId: input.tenantId,
			});
			return;
		}
		const delayMs = webhookRetryDelayMs(input.attempt.attempt);
		const hasRetryBudget = input.attempt.attempt < input.retryMaxAttempts;
		if (!(input.retriable && hasRetryBudget && delayMs !== undefined)) {
			yield* releaseClaim({
				attemptId: input.attempt.id,
				error: input.result.error,
				responseCode: input.result.responseCode,
				status: "dead",
				tenantId: input.tenantId,
			});
			return;
		}
		yield* releaseClaim({
			attemptId: input.attempt.id,
			error: input.result.error,
			responseCode: input.result.responseCode,
			status: "failed",
			tenantId: input.tenantId,
		});
		yield* scheduleNextPendingAttempt({
			attempt: input.attempt.attempt + 1,
			createdAt: now,
			destination: input.destination,
			eventId: input.attempt.notificationEventId,
			nextAttemptAt: yield* isoTimeOffset(delayMs),
			requestId: input.attempt.requestId,
			tenantId: input.tenantId,
		});
	});

const dispatchClaimedWebhookAttempt = (input: {
	readonly attempt: NotificationDeliveryAttemptRecord;
	readonly tenantId: string;
}) =>
	Effect.gen(function* dispatchClaimedWebhookAttemptProgram() {
		const services = yield* Effect.service(RuntimeServicesTag);
		const now = yield* currentIsoTime;
		const eventResult = yield* services.repos.persistence.notificationEvents
			.getById(input.attempt.notificationEventId)
			.pipe(withTenant(input.tenantId), Effect.result);
		if (eventResult._tag === "Failure") {
			yield* releaseClaim({
				attemptId: input.attempt.id,
				error: "Notification event is missing for webhook retry.",
				status: "dead",
				tenantId: input.tenantId,
			});
			return;
		}
		const sender = yield* makeWebhookSender({
			createdAt: now,
			services,
			tenantId: input.tenantId,
		});
		if (!sender) {
			yield* releaseClaim({
				attemptId: input.attempt.id,
				error: "Webhook endpoint is not configured.",
				status: "dead",
				tenantId: input.tenantId,
			});
			return;
		}
		const dispatchInput = yield* toDispatchInputFromEvent(
			eventResult.success
		).pipe(
			Effect.catch(() =>
				Effect.succeed(undefined as NotificationDispatchInput | undefined)
			)
		);
		if (!dispatchInput) {
			yield* releaseClaim({
				attemptId: input.attempt.id,
				error: "Persisted notification event type is not supported.",
				status: "dead",
				tenantId: input.tenantId,
			});
			return;
		}
		const sendResult = yield* Effect.result(sender.send(dispatchInput));
		if (sendResult._tag === "Failure") {
			const normalized = yield* recordAdapterFailure({
				adapterKey: sender.adapterKey,
				error: sendResult.failure,
				services,
			});
			yield* finalizeWebhookAttempt({
				attempt: input.attempt,
				destination: sender.destination,
				result: {
					error: normalized.message,
					status: "failed",
				},
				retriable: normalized.retriable,
				retryMaxAttempts: sender.retryMaxAttempts,
				tenantId: input.tenantId,
			});
			return;
		}
		yield* finalizeWebhookAttempt({
			attempt: input.attempt,
			destination: sender.destination,
			result: sendResult.success,
			retriable: sendResult.success.status === "failed",
			retryMaxAttempts: sender.retryMaxAttempts,
			tenantId: input.tenantId,
		});
	});

/**
 * Claims due webhook delivery attempts for the current tenant and dispatches
 * them. Remaining retries are written back with `next_attempt_at`.
 *
 * @param input - Optional tenant override and claim batch size.
 * @returns Claimed attempt rows processed in this tick.
 */
export const processDueWebhookDeliveries = Effect.fn(
	"processDueWebhookDeliveries"
)(function* processDueWebhookDeliveries(input?: {
	readonly tenantId?: string;
	readonly limit?: number;
}) {
	const services = yield* Effect.service(RuntimeServicesTag);
	const tenantId = yield* requireTenantId(
		input?.tenantId ?? services.requestContext.tenantId
	);
	const now = yield* currentIsoTime;
	const timeoutMs =
		services.config.notificationWebhook?.timeoutMs ??
		DEFAULT_WEBHOOK_TIMEOUT_MS;
	const claimed = yield* services.repos.persistence.notificationDeliveryAttempts
		.claimDue({
			channel: "webhook",
			claimUntil: yield* isoTimeOffset(webhookClaimLeaseMs(timeoutMs)),
			limit: input?.limit,
			now,
		})
		.pipe(withTenant(tenantId));
	yield* Effect.forEach(claimed, (attempt) =>
		dispatchClaimedWebhookAttempt({
			attempt,
			tenantId,
		}).pipe(
			Effect.catch((error) =>
				releaseClaim({
					attemptId: attempt.id,
					error:
						error instanceof Error ? error.message : "Webhook retry failed.",
					status: "failed",
					tenantId,
				})
			)
		)
	);
	return claimed;
});

/**
 * Polls due webhook delivery attempts on a 1-second cadence.
 *
 * Fork this fiber from tests with `TestClock`, or from a long-lived runtime
 * so retries continue after the originating HTTP request returns.
 */
export const runWebhookRetryWorker = processDueWebhookDeliveries().pipe(
	Effect.repeat(Schedule.spaced(WEBHOOK_RETRY_WORKER_POLL))
);

/**
 * Writes a pending webhook attempt before dispatch, then claims due work so
 * the first send happens on the same path the worker uses after a crash.
 *
 * @param input - Tenant, event, and destination for the pending attempt.
 * @returns An effect that completes after the first due dispatch is processed.
 */
export const queueWebhookDelivery = Effect.fn("queueWebhookDelivery")(
	function* queueWebhookDelivery(input: {
		readonly tenantId: string;
		readonly eventId: string;
		readonly requestId: string;
		readonly destination: string;
	}) {
		const services = yield* Effect.service(RuntimeServicesTag);
		const tenantId = yield* requireTenantId(input.tenantId);
		const now = yield* currentIsoTime;
		const attempts =
			yield* services.repos.persistence.notificationDeliveryAttempts
				.listByNotificationEventId(input.eventId)
				.pipe(withTenant(tenantId));
		yield* services.repos.persistence.notificationDeliveryAttempts
			.append({
				attempt: nextWebhookAttemptNumber(attempts),
				channel: "webhook",
				createdAt: now,
				destination: input.destination,
				id: makeRequestId(),
				nextAttemptAt: now,
				notificationEventId: input.eventId,
				requestId: input.requestId,
				status: "pending",
			})
			.pipe(withTenant(tenantId));
		yield* processDueWebhookDeliveries({ tenantId });
		const recorded =
			yield* services.repos.persistence.notificationDeliveryAttempts
				.listByNotificationEventId(input.eventId)
				.pipe(withTenant(tenantId));
		const completed = recorded.filter(
			(attempt) => attempt.channel === "webhook" && attempt.status !== "pending"
		);
		const latest = completed.at(-1);
		if (!latest) {
			return {
				error: "Webhook delivery was not recorded.",
				status: "failed" as const,
			};
		}
		if (latest.status === "delivered" || latest.status === "skipped") {
			return {
				error: latest.error,
				responseCode: latest.responseCode,
				status: latest.status,
			};
		}
		return {
			error: latest.error,
			responseCode: latest.responseCode,
			status: "failed" as const,
		};
	}
);
