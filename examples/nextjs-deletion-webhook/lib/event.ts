const isRecord = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

/**
 * Fields DSAR puts on every signed outbound webhook body.
 */
export interface OutboundWebhookEvent {
	readonly correlationId: string;
	readonly eventId: string;
	readonly eventType: string;
	readonly idempotencyKey: string;
	readonly locale: string;
	readonly payload: Record<string, unknown>;
	readonly policyVersion: string;
	readonly requestId: string;
}

export type ParseOutboundWebhookEventResult =
	| { readonly event: OutboundWebhookEvent; readonly ok: true }
	| {
			readonly error: "invalid_event" | "malformed_body";
			readonly ok: false;
	  };

/**
 * Decode a verified outbound webhook JSON body without type assertions.
 */
export const parseOutboundWebhookEvent = (
	rawBody: string
): ParseOutboundWebhookEventResult => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawBody);
	} catch {
		return { error: "malformed_body", ok: false };
	}

	if (!isRecord(parsed)) {
		return { error: "invalid_event", ok: false };
	}

	const correlationId = readString(parsed.correlationId);
	const eventId = readString(parsed.eventId);
	const eventType = readString(parsed.eventType);
	const idempotencyKey = readString(parsed.idempotencyKey);
	const locale = readString(parsed.locale);
	const policyVersion = readString(parsed.policyVersion);
	const requestId = readString(parsed.requestId);
	const payload = isRecord(parsed.payload) ? parsed.payload : undefined;

	if (
		!(
			correlationId &&
			eventId &&
			eventType &&
			idempotencyKey &&
			locale &&
			payload &&
			policyVersion &&
			requestId
		)
	) {
		return { error: "invalid_event", ok: false };
	}

	return {
		event: {
			correlationId,
			eventId,
			eventType,
			idempotencyKey,
			locale,
			payload,
			policyVersion,
			requestId,
		},
		ok: true,
	};
};
