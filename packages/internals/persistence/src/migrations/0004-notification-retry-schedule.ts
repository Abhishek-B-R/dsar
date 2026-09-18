import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

/**
 * Unique migration identifier used to track notification retry-schedule DDL.
 */
export const migrationId = 4;

/**
 * Human-readable migration name for auditability.
 */
export const migrationName = "notification_delivery_retry_schedule";

/**
 * Adds durable retry scheduling columns to notification delivery attempts.
 *
 * Existing pending rows become due immediately so a restarted worker can send
 * work that never left `pending`. Historical failed rows stay unscheduled.
 *
 * @param sql - Effect SQL client used to execute retry-schedule DDL.
 * @returns An effect that succeeds after columns and the due-work index exist.
 */
export const applyMigration0004 = (
	sql: SqlClient.SqlClient
): Effect.Effect<void, SqlError> =>
	Effect.gen(function* runMigration0004() {
		yield* sql`ALTER TABLE notification_delivery_attempts
			ADD COLUMN next_attempt_at TEXT`;
		yield* sql`ALTER TABLE notification_delivery_attempts
			ADD COLUMN claimed_at TEXT`;
		yield* sql`ALTER TABLE notification_delivery_attempts
			ADD COLUMN claimed_until TEXT`;
		yield* sql`UPDATE notification_delivery_attempts
			SET next_attempt_at = created_at
			WHERE status = 'pending'
				AND next_attempt_at IS NULL`;
		yield* sql`CREATE INDEX IF NOT EXISTS idx_notification_attempts_tenant_due
			ON notification_delivery_attempts(tenant_id, next_attempt_at)
			WHERE next_attempt_at IS NOT NULL`;
	});

/**
 * Test-only rollback for notification retry-schedule DDL.
 *
 * Production persistence remains forward-only; this helper exists so driver
 * migration suites can verify each migration's DDL boundary.
 *
 * @param sql - Effect SQL client used to execute rollback DDL.
 * @returns An effect that succeeds once retry-schedule objects are gone.
 */
export const revertMigration0004 = (
	sql: SqlClient.SqlClient
): Effect.Effect<void, SqlError> =>
	Effect.gen(function* revertMigration0004Program() {
		yield* sql`DROP INDEX IF EXISTS idx_notification_attempts_tenant_due`;
		yield* sql`ALTER TABLE notification_delivery_attempts
			DROP COLUMN claimed_until`;
		yield* sql`ALTER TABLE notification_delivery_attempts
			DROP COLUMN claimed_at`;
		yield* sql`ALTER TABLE notification_delivery_attempts
			DROP COLUMN next_attempt_at`;
	});
