/**
 * Hosted DSAR backend URL, matching c15t's `hosted({ url })` mode.
 *
 * Production: `https://{project}.inth.app/dsar`
 * Local demo: a same-origin BFF such as `/api/dsar`
 */

export interface HostedMode {
	readonly kind: "hosted";
	readonly baseUrl: string;
}

const trimTrailingSlash = (value: string): string =>
	value.endsWith("/") ? value.slice(0, -1) : value;

/**
 * Builds a hosted transport pointing at inth.com or a local BFF.
 *
 * @example
 * hosted({ project: "acme" })
 * // https://acme.inth.app/dsar
 *
 * @example
 * hosted({ url: "/api/dsar" })
 */
export const hosted = (
	input: { readonly project: string } | { readonly url: string }
): HostedMode => {
	if ("url" in input) {
		const url = input.url.trim();
		if (url.length === 0) {
			throw new Error("hosted({ url }) requires a non-empty url");
		}
		return { baseUrl: trimTrailingSlash(url), kind: "hosted" };
	}
	const project = input.project.trim();
	if (project.length === 0) {
		throw new Error("hosted({ project }) requires a project slug");
	}
	if (project.includes("/") || project.includes(".")) {
		throw new Error(
			"hosted({ project }) is a slug, not a hostname. Use hosted({ url }) for a full URL."
		);
	}
	return {
		baseUrl: `https://${project}.inth.app/dsar`,
		kind: "hosted",
	};
};
