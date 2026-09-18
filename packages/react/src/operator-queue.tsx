"use client";

import { useCallback, useEffect, useState } from "react";

import { DsarBrowserError } from "./client";
import { useDsarClient } from "./provider";

interface RequestRow {
	readonly id: string;
	readonly status?: string;
	readonly jurisdiction?: string;
}

/**
 * Operator queue. Same transport rules as SubjectPortal: no API keys in the
 * widget. Hosted operator UI lives on inth.com; this is the embeddable piece.
 */
export const OperatorQueue = () => {
	const client = useDsarClient();
	const [rows, setRows] = useState<readonly RequestRow[]>([]);
	const [alertMessage, setAlertMessage] = useState<string | null>(null);

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
					: "Failed to load queue"
			);
		});
	}, [refresh]);

	return (
		<section>
			<h1>Request queue</h1>
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
