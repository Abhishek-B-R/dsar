import { dsarInstance, runtimeReposFromPersistence } from "dsar/backend";
import { makeSqlitePersistenceService } from "dsar/persistence-sqlite";
import { makeFilesystemStorageAdapter } from "dsar/storage-filesystem";

const DEMO_TOKEN =
	process.env.DSAR_ADMIN_API_TOKEN ?? "dsar_admin_local_dev_token";

type DemoInstance = ReturnType<typeof dsarInstance>;

let demoInstance: DemoInstance | undefined;

export const getDemoInstance = async (): Promise<DemoInstance> => {
	if (demoInstance) {
		return demoInstance;
	}
	const persistence = await makeSqlitePersistenceService({
		filename: process.env.DSAR_PERSISTENCE_SQLITE_PATH ?? ".dsar-dashboard.db",
	});
	demoInstance = dsarInstance({
		adapters: {
			storage: makeFilesystemStorageAdapter({
				baseDir: ".dsar-dashboard-artifacts",
				prefix: "artifacts",
			}),
		},
		basePath: "/api/dsar",
		config: {
			auth: {
				staticBearerTokens: {
					[DEMO_TOKEN]: {
						actorId: "dashboard-admin",
						principalKind: "operator",
						role: "admin",
						tenantId: "tenant-default",
					},
				},
			},
			environment: "development",
		},
		repos: runtimeReposFromPersistence(persistence),
	});
	return demoInstance;
};

export const withDemoAuth = (request: Request): Request => {
	if (request.headers.has("authorization")) {
		return request;
	}
	const headers = new Headers(request.headers);
	headers.set("authorization", `Bearer ${DEMO_TOKEN}`);
	return new Request(request, { headers });
};
