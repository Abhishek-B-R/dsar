import { once } from "node:events";

import { describe, expect, it } from "@effect/vitest";

import { createNodeSdk } from "#src/client";
import type { NodeSdkConfig, SdkError } from "#src/types";

const hangUntilAborted: NonNullable<NodeSdkConfig["fetch"]> = async (
	_input,
	init
) => {
	const { signal } = init ?? {};
	if (signal === undefined) {
		throw new Error("expected the SDK to pass an abort signal");
	}
	if (!signal.aborted) {
		await once(signal, "abort");
	}
	const { reason } = signal;
	throw reason instanceof Error
		? reason
		: new DOMException("The operation was aborted.", "AbortError");
};

const catchError = async (run: () => Promise<unknown>): Promise<Error> => {
	try {
		await run();
	} catch (error) {
		if (error instanceof Error) {
			return error;
		}
		throw error;
	}
	throw new Error("expected the SDK request to fail");
};

const expectSdkCode = (error: Error, code: string): SdkError => {
	expect(error.message).toContain(code);
	const sdkError = error as SdkError;
	expect(sdkError.code).toBe(code);
	expect(sdkError.type).toBe("dsar.sdk.error");
	return sdkError;
};

describe("node-sdk fetcher transport", () => {
	it("maps timeoutMs abort to SDK_TIMEOUT", async () => {
		let attempts = 0;
		const sdk = createNodeSdk({
			baseUrl: "https://example.test",
			fetch: (input, init) => {
				attempts += 1;
				return hangUntilAborted(input, init);
			},
			retryMaxAttempts: 1,
			timeoutMs: 30,
		});

		const error = expectSdkCode(
			await catchError(() => sdk.status()),
			"SDK_TIMEOUT"
		);
		expect(error.category).toBe("timeout");
		expect(error.errorId).toBe("DSAR-SDK-1102");
		expect(error.retriable).toBe(true);
		expect(attempts).toBe(1);
	});

	it("maps a thrown fetch failure to SDK_NETWORK_ERROR", async () => {
		let attempts = 0;
		const sdk = createNodeSdk({
			baseUrl: "https://example.test",
			fetch: () => {
				attempts += 1;
				return Promise.reject(new TypeError("fetch failed"));
			},
			retryMaxAttempts: 1,
		});

		const error = expectSdkCode(
			await catchError(() => sdk.status()),
			"SDK_NETWORK_ERROR"
		);
		expect(error.category).toBe("network");
		expect(error.errorId).toBe("DSAR-SDK-1101");
		expect(error.retriable).toBe(true);
		expect(attempts).toBe(1);
	});

	it("maps a non-JSON 200 body to SDK_INVALID_ENVELOPE", async () => {
		const sdk = createNodeSdk({
			baseUrl: "https://example.test",
			fetch: () =>
				Promise.resolve(
					new Response("<html>ok</html>", {
						headers: { "content-type": "text/html" },
						status: 200,
					})
				),
			retryMaxAttempts: 1,
		});

		const error = expectSdkCode(
			await catchError(() => sdk.status()),
			"SDK_INVALID_ENVELOPE"
		);
		expect(error.category).toBe("validation");
		expect(error.errorId).toBe("DSAR-SDK-1301");
		expect(error.retriable).toBe(false);
		expect(error.status).toBe(200);
	});

	it("maps truncated application/json to SDK_NETWORK_ERROR", async () => {
		const sdk = createNodeSdk({
			baseUrl: "https://example.test",
			fetch: () =>
				Promise.resolve(
					new Response('{"ok":true,"data":{"status":"ok"', {
						headers: { "content-type": "application/json" },
						status: 200,
					})
				),
			retryMaxAttempts: 1,
		});

		const error = expectSdkCode(
			await catchError(() => sdk.status()),
			"SDK_NETWORK_ERROR"
		);
		expect(error.category).toBe("network");
		expect(error.errorId).toBe("DSAR-SDK-1101");
		expect(error.retriable).toBe(true);
	});

	it("maps a non-JSON HTTP error body to SDK_HTTP_ERROR", async () => {
		const sdk = createNodeSdk({
			baseUrl: "https://example.test",
			fetch: () =>
				Promise.resolve(
					new Response("bad gateway", {
						headers: { "content-type": "text/plain" },
						status: 502,
					})
				),
			retryMaxAttempts: 1,
		});

		const error = expectSdkCode(
			await catchError(() => sdk.status()),
			"SDK_HTTP_ERROR"
		);
		expect(error.category).toBe("http");
		expect(error.errorId).toBe("DSAR-SDK-1201");
		expect(error.retriable).toBe(true);
		expect(error.status).toBe(502);
	});
});
