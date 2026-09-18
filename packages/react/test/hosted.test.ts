import { describe, expect, it } from "vitest";

import { hosted } from "../src/hosted";

describe("hosted", () => {
	it("builds the inth.app DSAR origin from a project slug", () => {
		expect(hosted({ project: "acme" })).toEqual({
			baseUrl: "https://acme.inth.app/dsar",
			kind: "hosted",
		});
	});

	it("keeps an explicit BFF or self-host URL", () => {
		expect(hosted({ url: "/api/dsar/" })).toEqual({
			baseUrl: "/api/dsar",
			kind: "hosted",
		});
	});

	it("rejects a hostname as a project slug", () => {
		expect(() => hosted({ project: "acme.inth.app" })).toThrow(/slug/);
	});
});
