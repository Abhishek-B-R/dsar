import { describe, expect, it } from "@effect/vitest";

import { buildFilesystemArtifactKey, mapFilesystemStatToMetadata } from "#src";

describe("storage-filesystem mappers", () => {
	it("builds deterministic artifact keys with fallback behavior", () => {
		const key = buildFilesystemArtifactKey(
			{
				artifactId: "artifact-1",
				category: "identity_data",
				manifestId: "manifest-1",
				requestId: "request-1",
			},
			"artifacts"
		);
		expect(key).toBe(
			"artifacts/request-1/manifest-1/identity_data/raw/full/artifact-1.bin"
		);
	});

	it("strips parent-directory segments from generated artifact keys", () => {
		const fromFileName = buildFilesystemArtifactKey(
			{
				category: "../identity",
				fileName: "../secret.pdf",
				manifestId: "../manifest",
				requestId: "../request",
			},
			"../artifacts"
		);
		const fromArtifactId = buildFilesystemArtifactKey(
			{
				artifactId: "../artifact",
				category: "../identity",
				manifestId: "../manifest",
				requestId: "../request",
			},
			"../artifacts"
		);
		expect(fromFileName).toBe(
			"artifacts/request/manifest/identity/raw/full/secret.pdf"
		);
		expect(fromArtifactId).toBe(
			"artifacts/request/manifest/identity/raw/full/artifact.bin"
		);
		expect(fromFileName.split("/").includes("..")).toBe(false);
		expect(fromArtifactId.split("/").includes("..")).toBe(false);
	});

	it("keeps a single-dot filename after sanitizing other fields", () => {
		const key = buildFilesystemArtifactKey(
			{
				category: "identity_data",
				fileName: "export.pdf",
				manifestId: "manifest-1",
				requestId: "request-1",
			},
			"artifacts"
		);
		expect(key).toBe(
			"artifacts/request-1/manifest-1/identity_data/raw/full/export.pdf"
		);
	});

	it("returns an explicit key override unchanged", () => {
		const key = buildFilesystemArtifactKey(
			{
				key: "../explicit/key",
			},
			"artifacts"
		);
		expect(key).toBe("../explicit/key");
	});

	it("maps file stat output into normalized metadata", () => {
		const metadata = mapFilesystemStatToMetadata({
			key: "artifacts/request-1/file.pdf",
			reference: {
				key: "artifacts/request-1/file.pdf",
				manifestHash: "hash-1",
				manifestId: "manifest-1",
				manifestSignature: "sig-1",
				requestId: "request-1",
			},
			stat: {
				mtime: new Date("2026-01-01T00:00:00.000Z"),
				size: 42,
			},
			stored: {
				checksum: "etag-1",
				contentType: "application/pdf",
				manifestHash: "hash-1",
				manifestId: "manifest-1",
				manifestSignature: "sig-1",
				requestId: "request-1",
				sizeBytes: 42,
			},
		});
		expect(metadata.checksum).toBe("etag-1");
		expect(metadata.sizeBytes).toBe(42);
		expect(metadata.manifestId).toBe("manifest-1");
	});
});
