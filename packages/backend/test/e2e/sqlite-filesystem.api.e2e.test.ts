import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withTenant } from "@dsar/persistence";
import { makeSqlitePersistenceService } from "@dsar/persistence-sqlite";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeFilesystemStorageAdapter } from "../../../storage-filesystem/src";
import type { SuccessEnvelope } from "../../src";
import { TEST_TENANT_ID } from "../auth";
import { ACTOR_HEADERS, startApiE2eServer } from "./harness";
import type { ApiE2eServer } from "./harness";

const E2E_TEST_TIMEOUT_MS = 20_000;
const EVIDENCE_BODY = new TextEncoder().encode("identity-document");
const EVIDENCE_FILE_NAME = "identity.txt";

const asEnvelope = async <T>(response: Response): Promise<SuccessEnvelope<T>> =>
	(await response.json()) as SuccessEnvelope<T>;

const artifactPath = (baseDir: string, key: string): string =>
	join(baseDir, ...key.split("/").filter((segment) => segment.length > 0));

const startSqliteFilesystemServer = async (input: {
	readonly artifactsDir: string;
	readonly sqliteFile: string;
}): Promise<ApiE2eServer> => {
	const persistence = await makeSqlitePersistenceService({
		create: true,
		filename: input.sqliteFile,
	});
	return startApiE2eServer({
		adapters: {
			inbound: "stub",
			notifications: "stub",
			storage: makeFilesystemStorageAdapter({
				baseDir: input.artifactsDir,
				prefix: "artifacts",
			}),
		},
		persistence,
	});
};

describe("api e2e sqlite file plus filesystem storage", () => {
	it(
		"runs capture, verification, evidence upload, and fulfilment on real adapters",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "dsar-sqlite-fs-e2e-"));
			const sqliteFile = join(root, "dsar.sqlite");
			const artifactsDir = join(root, "artifacts");
			let server: ApiE2eServer | undefined;
			let restarted: ApiE2eServer | undefined;
			try {
				server = await startSqliteFilesystemServer({
					artifactsDir,
					sqliteFile,
				});

				const create = await server.request({
					headers: ACTOR_HEADERS,
					json: {
						intakeSource: {
							channel: "api",
							receivedAt: "2026-03-01T00:00:00.000Z",
							type: "api",
						},
						jurisdiction: "uk",
						requestType: "access",
						requestor: {
							email: "sqlite-fs-subject@example.test",
							type: "subject",
						},
						requiresVerification: true,
					},
					method: "POST",
					path: "/requests/capture",
				});
				const createBody = await asEnvelope<{
					readonly id: string;
					readonly status: string;
				}>(create);
				const requestId = createBody.data.id;

				const verificationRequest = await server.request({
					headers: ACTOR_HEADERS,
					method: "POST",
					path: `/requests/${requestId}/verification/request`,
				});
				const verificationRequestBody = await asEnvelope<{
					readonly status: string;
				}>(verificationRequest);

				const evidenceUpload = await server.request({
					body: EVIDENCE_BODY,
					headers: {
						...ACTOR_HEADERS,
						"content-type": "application/octet-stream",
						"x-evidence-content-type": "text/plain",
						"x-evidence-filename": EVIDENCE_FILE_NAME,
						"x-evidence-level": "reasonable",
					},
					method: "POST",
					path: `/requests/${requestId}/verification/evidence/upload`,
				});
				const evidenceUploadBody = await asEnvelope<{
					readonly artifactKey: string;
					readonly evidenceId: string;
					readonly status: string;
				}>(evidenceUpload);

				const verificationApprove = await server.request({
					headers: ACTOR_HEADERS,
					method: "POST",
					path: `/requests/${requestId}/verification/approve`,
				});
				const verificationApproveBody = await asEnvelope<{
					readonly status: string;
				}>(verificationApprove);

				const fulfil = await server.request({
					headers: ACTOR_HEADERS,
					method: "POST",
					path: `/requests/${requestId}/fulfilment`,
				});
				const fulfilBody = await asEnvelope<{ readonly status: string }>(
					fulfil
				);

				const timeline = await server.request({
					headers: ACTOR_HEADERS,
					method: "GET",
					path: `/requests/${requestId}/timeline`,
				});
				const timelineBody = await asEnvelope<{
					readonly events: readonly { readonly eventType: string }[];
				}>(timeline);

				expect([
					create.status,
					createBody.data.status,
					verificationRequest.status,
					verificationRequestBody.data.status,
					evidenceUpload.status,
					evidenceUploadBody.data.status,
					verificationApprove.status,
					verificationApproveBody.data.status,
					fulfil.status,
					fulfilBody.data.status,
					timeline.status,
				]).toStrictEqual([
					202,
					"captured",
					202,
					"verification_pending",
					202,
					"pending",
					202,
					"in_progress",
					202,
					"fulfilled",
					200,
				]);
				expect(
					timelineBody.data.events.map((event) => event.eventType)
				).toStrictEqual([
					"captured",
					"verification_requested",
					"verification_evidence_uploaded",
					"verification_resolved",
					"fulfilled",
				]);

				const storedPath = artifactPath(
					artifactsDir,
					evidenceUploadBody.data.artifactKey
				);
				const storedBytes = await readFile(storedPath);
				expect(storedBytes).toStrictEqual(Buffer.from(EVIDENCE_BODY));
				const sqliteStat = await stat(sqliteFile);
				expect(sqliteStat.size).toBeGreaterThan(0);

				await server.close();
				server = undefined;

				const persistence = await makeSqlitePersistenceService({
					create: true,
					filename: sqliteFile,
				});
				const persisted = await Effect.runPromise(
					persistence.requests
						.getById(requestId)
						.pipe(withTenant(TEST_TENANT_ID))
				);
				expect(persisted.status).toBe("fulfilled");
				const evidence = await Effect.runPromise(
					persistence.verificationEvidence
						.listByRequestId(requestId)
						.pipe(withTenant(TEST_TENANT_ID))
				);
				expect(evidence.map((record) => record.id)).toStrictEqual([
					evidenceUploadBody.data.evidenceId,
				]);

				restarted = await startSqliteFilesystemServer({
					artifactsDir,
					sqliteFile,
				});
				const reloaded = await restarted.request({
					headers: ACTOR_HEADERS,
					method: "GET",
					path: `/requests/${requestId}`,
				});
				const reloadedBody = await asEnvelope<{
					readonly id: string;
					readonly status: string;
				}>(reloaded);
				expect([
					reloaded.status,
					reloadedBody.data.id,
					reloadedBody.data.status,
				]).toStrictEqual([200, requestId, "fulfilled"]);
			} finally {
				await server?.close();
				await restarted?.close();
				await rm(root, { force: true, recursive: true });
			}
		},
		E2E_TEST_TIMEOUT_MS
	);
});
