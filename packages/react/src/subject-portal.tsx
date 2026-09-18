"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useId, useState } from "react";

import { DsarBrowserError } from "./client";
import { useDsarClient } from "./provider";

interface RequestRow {
	readonly id: string;
	readonly status?: string;
	readonly receivedAt?: string;
}

export interface SubjectPortalProps {
	readonly defaultJurisdiction?: string;
	/** Identifier used for GET /subjects/:subjectId. Must match the signed-in subject. */
	readonly subjectId: string;
	/** Stamped on create so the subject list can find the request. */
	readonly email?: string;
}

/**
 * Subject-facing portal: file a request and list that subject's requests.
 * Does not call GET /requests (operator queue).
 */
export const SubjectPortal = ({
	defaultJurisdiction = "eu",
	email,
	subjectId,
}: SubjectPortalProps) => {
	const client = useDsarClient();
	const jurisdictionId = useId();
	const requestFieldId = useId();
	const [jurisdiction, setJurisdiction] = useState(defaultJurisdiction);
	const [rawText, setRawText] = useState("Please provide my personal data.");
	const [rows, setRows] = useState<readonly RequestRow[]>([]);
	const [alertMessage, setAlertMessage] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const refresh = useCallback(async () => {
		const profile = await client.get<{
			readonly requests?: readonly RequestRow[];
		}>(`/subjects/${encodeURIComponent(subjectId)}`);
		setRows(profile.requests ?? []);
	}, [client, subjectId]);

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
				...(email === undefined
					? {}
					: { requestor: { email, type: "subject" } }),
			});
			await refresh();
		} catch (error) {
			setAlertMessage(
				error instanceof DsarBrowserError
					? error.message
					: "Could not file this request"
			);
		} finally {
			setPending(false);
		}
	};

	return (
		<div className="dsar-root">
			<h1>Privacy requests</h1>
			<p className="dsar-lede">
				File an access or deletion request. Status updates land in this list.
			</p>
			<div className="dsar-panel">
				<form className="dsar-form" onSubmit={onSubmit}>
					<label className="dsar-field" htmlFor={jurisdictionId}>
						<span>Jurisdiction</span>
						<input
							id={jurisdictionId}
							name="jurisdiction"
							onChange={(event) => setJurisdiction(event.target.value)}
							value={jurisdiction}
						/>
					</label>
					<label className="dsar-field" htmlFor={requestFieldId}>
						<span>What are you asking for?</span>
						<textarea
							id={requestFieldId}
							name="rawText"
							onChange={(event) => setRawText(event.target.value)}
							value={rawText}
						/>
					</label>
					<div className="dsar-actions">
						<button disabled={pending} type="submit">
							{pending ? "Filing…" : "File request"}
						</button>
					</div>
				</form>
				{alertMessage === null ? null : (
					<p className="dsar-alert" role="alert">
						{alertMessage}
					</p>
				)}
				<p className="dsar-list-title">Your requests</p>
				{rows.length === 0 ? (
					<p className="dsar-empty">None yet. File one above.</p>
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
