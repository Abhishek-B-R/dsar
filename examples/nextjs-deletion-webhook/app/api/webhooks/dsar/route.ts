import { verifyWebhook } from "@dsar/node-sdk/webhooks";

import { parseOutboundWebhookEvent } from "../../../../lib/event";
import { applyFulfilment } from "../../../../lib/store";

/** Terminal lifecycle event DSAR emits after `POST /requests/:id/fulfilment`. */
const FULFILLED_EVENT = "request_fulfilled";

const json = (
	status: number,
	body: { readonly error?: string; readonly ok: boolean }
): Response => Response.json(body, { status });

/** File store and `verifyWebhook` use Node APIs, not the Edge runtime. */
export const runtime = "nodejs";

/**
 * Verify a DSAR outbound webhook and mock-delete only on `request_fulfilled`.
 */
export const POST = async (request: Request): Promise<Response> => {
	const signingSecret = process.env.DSAR_WEBHOOK_SECRET?.trim();
	if (!signingSecret) {
		throw new Error("DSAR_WEBHOOK_SECRET is required.");
	}

	const rawBody = await request.text();
	const signature = request.headers.get("x-dsar-signature");
	if (signature === null || signature.trim().length === 0) {
		return json(401, { error: "missing_signature", ok: false });
	}

	const verification = await verifyWebhook({
		body: rawBody,
		keyId: request.headers.get("x-dsar-signature-key-id") ?? undefined,
		secrets: [signingSecret],
		signature,
	});
	if (!verification.verified) {
		return json(401, { error: "invalid_signature", ok: false });
	}

	const parsed = parseOutboundWebhookEvent(rawBody);
	if (!parsed.ok) {
		return json(400, { error: parsed.error, ok: false });
	}

	if (parsed.event.eventType !== FULFILLED_EVENT) {
		return json(200, { ok: true });
	}

	try {
		applyFulfilment({
			eventId: parsed.event.eventId,
			requestId: parsed.event.requestId,
		});
	} catch (error) {
		console.error("Deletion webhook handler failed", {
			error: error instanceof Error ? error.message : String(error),
			eventId: parsed.event.eventId,
			requestId: parsed.event.requestId,
		});
		return json(500, { error: "handler_failed", ok: false });
	}

	return json(200, { ok: true });
};
