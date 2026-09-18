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
		<div className="dsar-root">
			<h1>Request queue</h1>
			<p className="dsar-lede">
				Open requests for this tenant. Fulfilment and refusals stay in the
				operator tools on inth.com.
			</p>
			<div className="dsar-panel">
				{alertMessage === null ? null : (
					<p className="dsar-alert" role="alert">
						{alertMessage}
					</p>
				)}
				{rows.length === 0 ? (
					<p className="dsar-empty">
						The queue is empty. New subject filings will show up here.
					</p>
				) : (
					<ul className="dsar-list">
						{rows.map((row) => (
							<li className="dsar-item" key={row.id}>
								<span className="dsar-id" title={row.id}>
									{row.id}
								</span>
								{row.status === undefined ? null : (
									<span className="dsar-status">{row.status}</span>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
};
