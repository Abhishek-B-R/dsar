---
"dsar": minor
---

Resume outbound webhook delivery after the HTTP request returns. Failed webhook attempts are scheduled on existing `notification_delivery_attempts` rows (1m, 5m, 30m, 2h, 6h, 24h) and marked `dead` when `retryMaxAttempts` is exhausted. Receivers still see the original event id and idempotency key.
