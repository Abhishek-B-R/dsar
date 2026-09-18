/**
 * Delay after a failed webhook attempt before the next durable retry.
 *
 * Index 0 is the wait after attempt 1 fails, then 5m, 30m, 2h, 6h, and 24h.
 */
export const WEBHOOK_RETRY_BACKOFF_MS = [
	60_000,
	5 * 60_000,
	30 * 60_000,
	2 * 60 * 60_000,
	6 * 60 * 60_000,
	24 * 60 * 60_000,
] as const;

/**
 * Returns the delay before the next webhook retry, or `undefined` when the
 * failed attempt has no remaining backoff slot.
 *
 * @param failedAttemptNumber - 1-based attempt that just failed.
 * @param backoffMs - Optional override schedule in milliseconds.
 * @returns Delay in milliseconds, or `undefined` when the schedule is exhausted.
 */
export const webhookRetryDelayMs = (
	failedAttemptNumber: number,
	backoffMs: readonly number[] = WEBHOOK_RETRY_BACKOFF_MS
): number | undefined => {
	if (!Number.isSafeInteger(failedAttemptNumber) || failedAttemptNumber < 1) {
		return undefined;
	}
	return backoffMs[failedAttemptNumber - 1];
};

/**
 * Lease length used when a worker claims a due webhook attempt.
 *
 * @param timeoutMs - Per-attempt HTTP timeout.
 * @returns Claim duration in milliseconds.
 */
export const webhookClaimLeaseMs = (timeoutMs: number): number => {
	const safeTimeout =
		Number.isFinite(timeoutMs) && timeoutMs > 0
			? Math.floor(timeoutMs)
			: 30_000;
	return safeTimeout + 5000;
};
