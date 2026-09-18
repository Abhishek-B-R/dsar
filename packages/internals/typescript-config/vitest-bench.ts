import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.bench.ts"],
		setupFiles: ["@dsar/typescript-config/vitest-setup"],
	},
});
