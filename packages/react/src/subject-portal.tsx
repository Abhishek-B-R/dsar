"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useState } from "react";

import { DsarBrowserError } from "./client";
import { useDsarClient } from "./provider";

interface RequestRow {
	readonly id: string;
	readonly status?: string;
	readonly jurisdiction?: string;
}

export interface SubjectPortalProps {
	readonly defaultJurisdiction?: string;
}

/**
 * Subject-facing portal: file a request and list the caller's own requests.
 * Hosted inth.app authenticates the subject. Local demos do that in the BFF.
 */
export const SubjectPortal = ({
	defaultJurisdiction = "eu",
}: SubjectPortalProps) => {
	const client = useDsarClient();
	const [jurisdiction, setJurisdiction] = useState(defaultJurisdiction);
	const [rawText, setRawText] = useState("Please provide my personal data.");
	const [rows, setRows] = useState<readonly RequestRow[]>([]);
	const [alertMessage, setAlertMessage] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const refresh = useCallback(async () => {
		const listed = await client.get<{ readonly items?: readonly RequestRow[] }>(
			"/requests"
		);
		setRows(listed.items ?? []);
	}, [client]);

	useEffect(() => {
		refresh().catch((error: unknown) => {
			setAlertMessage(
				error instanceof DsarBrowserError
					? error.message
					: "Failed to load requests"
			);
		});
	}, [refresh]);

	const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setPending(true);
		setAlertMessage(null);
		try {
			await client.post("/requests", {
				intakeSource: {
					channel: "web",
					rawText,
					receivedAt: new Date().toISOString(),
				},
				jurisdiction,
			});
			await refresh();
		} catch (error) {
			setAlertMessage(
				error instanceof DsarBrowserError
					? error.message
					: "Failed to create request"
			);
		} finally {
			setPending(false);
		}
	};

	return (
		<section>
			<h1>Privacy requests</h1>
			<form onSubmit={onSubmit}>
				<label>
					Jurisdiction
					<input
						name="jurisdiction"
						onChange={(event) => setJurisdiction(event.target.value)}
						value={jurisdiction}
					/>
				</label>
				<label>
					Request
					<textarea
						name="rawText"
						onChange={(event) => setRawText(event.target.value)}
						value={rawText}
					/>
				</label>
				<button disabled={pending} type="submit">
					Submit
				</button>
			</form>
			{alertMessage === null ? null : <p role="alert">{alertMessage}</p>}
			<ul>
				{rows.map((row) => (
					<li key={row.id}>
						{row.id} {row.status ?? ""} {row.jurisdiction ?? ""}
					</li>
				))}
			</ul>
		</section>
	);
};
