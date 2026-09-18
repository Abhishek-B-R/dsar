"use client";

import { useCallback, useEffect, useState } from "react";

import { DsarBrowserError } from "./client";
import { useDsarClient } from "./provider";

interface Requestor {
	readonly email?: string;
	readonly name?: string;
	readonly type?: string;
}

interface QueueItem {
	readonly dueAt?: string;
	readonly id: string;
	readonly receivedAt?: string;
	readonly requestor?: Requestor;
	readonly status?: string;
}

interface RequestDetail {
	readonly capture?: {
		readonly intakeSource?: {
			readonly rawText?: string;
		};
		readonly jurisdiction?: string;
		readonly requestType?: string;
	};
	readonly dueAt?: string;
	readonly id: string;
	readonly intakeSource?: {
		readonly rawText?: string;
	};
	readonly receivedAt?: string;
	readonly requestor?: Requestor;
	readonly status?: string;
}

const formatWhen = (value: string | undefined): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	return date.toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
};

const who = (requestor: Requestor | undefined): string => {
	if (requestor?.name && requestor.name.trim().length > 0) {
		return requestor.name;
	}
	if (requestor?.email && requestor.email.trim().length > 0) {
		return requestor.email;
	}
	return "Unknown requestor";
};

const intakeText = (detail: RequestDetail | undefined): string | undefined => {
	const fromIntake = detail?.intakeSource?.rawText;
	if (typeof fromIntake === "string" && fromIntake.trim().length > 0) {
		return fromIntake;
	}
	const fromCapture = detail?.capture?.intakeSource?.rawText;
	if (typeof fromCapture === "string" && fromCapture.trim().length > 0) {
		return fromCapture;
	}
	return undefined;
};

interface AcmePerson {
	readonly orders: readonly {
		readonly amountCents: number;
		readonly deletedAt: string | null;
		readonly sku: string;
	}[];
	readonly sessions: readonly {
		readonly deletedAt: string | null;
		readonly id: string;
	}[];
	readonly user: {
		readonly deletedAt: string | null;
		readonly email: string;
		readonly name: string;
		readonly plan: string;
	} | null;
}

const liveCount = (rows: readonly { readonly deletedAt: string | null }[]) =>
	rows.filter((row) => row.deletedAt === null).length;

const demoPeopleUrl = (dsarBaseUrl: string, email: string): string => {
	const origin = dsarBaseUrl.replace(/\/api\/v1\/?$/, "");
	return `${origin}/demo/people?email=${encodeURIComponent(email)}`;
};

const AcmeRecords = ({ person }: { readonly person: AcmePerson | null }) => {
	if (person === null) {
		return <p className="dsar-empty">No Acme account for this email.</p>;
	}
	if (person.user === null) {
		return <p className="dsar-empty">No Acme account for this email.</p>;
	}
	const liveSessions = liveCount(person.sessions);
	const liveOrders = liveCount(person.orders);
	const erased = person.user.deletedAt !== null;
	return (
		<div className="dsar-acme">
			<p className="dsar-list-title">Acme product data</p>
			<p className="dsar-meta">
				{person.user.name} · {person.user.plan}
				{erased ? " · erased" : ""}
			</p>
			<ul className="dsar-acme-counts">
				<li>
					{liveSessions} live session{liveSessions === 1 ? "" : "s"}
					{person.sessions.length === liveSessions
						? ""
						: ` (${String(person.sessions.length - liveSessions)} deleted)`}
				</li>
				<li>
					{liveOrders} live order{liveOrders === 1 ? "" : "s"}
					{person.orders.length === liveOrders
						? ""
						: ` (${String(person.orders.length - liveOrders)} deleted)`}
				</li>
			</ul>
			{erased ? (
				<p className="dsar-empty">Fulfilment webhook erased this account.</p>
			) : null}
		</div>
	);
};

const QueueActions = ({
	busy,
	onAction,
	onRefuse,
	path,
	status,
}: {
	readonly busy: boolean;
	readonly onAction: (path: string, body: unknown) => void;
	readonly onRefuse: () => void;
	readonly path: (suffix: string) => string;
	readonly status: string | undefined;
}) => (
	<div className="dsar-actions dsar-actions-row">
		{status === "captured" ? (
			<button
				disabled={busy}
				onClick={() => onAction(path("/verification/request"), {})}
				type="button"
			>
				Start verification
			</button>
		) : null}
		{status === "verification_pending" ? (
			<>
				<button
					disabled={busy}
					onClick={() => onAction(path("/verification/approve"), {})}
					type="button"
				>
					Confirm identity
				</button>
				<button
					className="dsar-btn-secondary"
					disabled={busy}
					onClick={() => onAction(path("/verification/reject"), {})}
					type="button"
				>
					Reject identity
				</button>
			</>
		) : null}
		{status === "in_progress" ? (
			<>
				<button
					disabled={busy}
					onClick={() => onAction(path("/fulfilment"), {})}
					type="button"
				>
					Mark fulfilled
				</button>
				<button
					className="dsar-btn-secondary"
					disabled={busy}
					onClick={onRefuse}
					type="button"
				>
					Refuse
				</button>
			</>
		) : null}
		{status === "fulfilled" || status === "refused" ? (
			<button
				className="dsar-btn-secondary"
				disabled={busy}
				onClick={() => onAction(path("/closures"), {})}
				type="button"
			>
				Close
			</button>
		) : null}
	</div>
);

const QueueCard = ({
	busy,
	detail,
	onAction,
	onRefuse,
	onRefuseCancel,
	onRefuseReason,
	person,
	refuseOpen,
	refuseReason,
	row,
}: {
	readonly busy: boolean;
	readonly detail: RequestDetail | undefined;
	readonly onAction: (path: string, body: unknown) => void;
	readonly onRefuse: () => void;
	readonly onRefuseCancel: () => void;
	readonly onRefuseReason: (value: string) => void;
	readonly person: AcmePerson | null;
	readonly refuseOpen: boolean;
	readonly refuseReason: string;
	readonly row: QueueItem;
}) => {
	const status = detail?.status ?? row.status;
	const text = intakeText(detail);
	const requestType = detail?.capture?.requestType;
	const jurisdiction = detail?.capture?.jurisdiction;
	const path = (suffix: string) =>
		`/requests/${encodeURIComponent(row.id)}${suffix}`;
	return (
		<li className="dsar-card">
			<div className="dsar-card-head">
				<div className="dsar-item-main">
					<strong>{who(detail?.requestor ?? row.requestor)}</strong>
					<span className="dsar-meta">
						{[
							requestType,
							jurisdiction,
							formatWhen(row.receivedAt),
							row.dueAt === undefined
								? undefined
								: `due ${formatWhen(row.dueAt)}`,
						]
							.filter((part) => part !== undefined)
							.join(" · ")}
					</span>
				</div>
				{status === undefined ? null : (
					<span className="dsar-status">{status}</span>
				)}
			</div>
			{detail?.requestor?.email === undefined ? null : (
				<p className="dsar-meta">{detail.requestor.email}</p>
			)}
			{text === undefined ? null : <p className="dsar-quote">{text}</p>}
			<AcmeRecords person={person} />
			<QueueActions
				busy={busy}
				onAction={onAction}
				onRefuse={onRefuse}
				path={path}
				status={status}
			/>
			{refuseOpen ? (
				<form
					className="dsar-form"
					onSubmit={(event) => {
						event.preventDefault();
						onAction(path("/refusals"), { rationale: refuseReason.trim() });
					}}
				>
					<label className="dsar-field">
						<span>Reason for refusal</span>
						<textarea
							onChange={(event) => onRefuseReason(event.target.value)}
							value={refuseReason}
						/>
					</label>
					<div className="dsar-actions dsar-actions-row">
						<button disabled={busy} type="submit">
							Confirm refusal
						</button>
						<button
							className="dsar-btn-secondary"
							onClick={onRefuseCancel}
							type="button"
						>
							Cancel
						</button>
					</div>
				</form>
			) : null}
		</li>
	);
};

export const OperatorQueue = () => {
	const client = useDsarClient();
	const [rows, setRows] = useState<readonly QueueItem[]>([]);
	const [details, setDetails] = useState<
		Readonly<Record<string, RequestDetail>>
	>({});
	const [alertMessage, setAlertMessage] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [refuseId, setRefuseId] = useState<string | null>(null);
	const [refuseReason, setRefuseReason] = useState("");
	const [people, setPeople] = useState<
		Readonly<Record<string, AcmePerson | null>>
	>({});

	const refresh = useCallback(async () => {
		const listed = await client.get<{ readonly items?: readonly QueueItem[] }>(
			"/requests"
		);
		const items = listed.items ?? [];
		setRows(items);
		const loaded = await Promise.all(
			items.map(async (item) => {
				const detail = await client.get<RequestDetail>(
					`/requests/${encodeURIComponent(item.id)}`
				);
				return [item.id, detail] as const;
			})
		);
		setDetails(Object.fromEntries(loaded));
		const lookedUp = await Promise.all(
			loaded.map(async ([id, detail]) => {
				const email = detail.requestor?.email ?? undefined;
				if (email === undefined) {
					return [id, null] as const;
				}
				const response = await fetch(demoPeopleUrl(client.baseUrl, email), {
					credentials: "include",
				});
				if (!response.ok) {
					return [id, null] as const;
				}
				const person = (await response.json()) as AcmePerson;
				return [id, person] as const;
			})
		);
		setPeople(Object.fromEntries(lookedUp));
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

	const runAction = async (id: string, path: string, body: unknown) => {
		setBusyId(id);
		setAlertMessage(null);
		try {
			await client.post(path, body);
			setRefuseId(null);
			setRefuseReason("");
			await refresh();
		} catch (error) {
			setAlertMessage(
				error instanceof DsarBrowserError ? error.message : "Action failed"
			);
		} finally {
			setBusyId(null);
		}
	};

	return (
		<div className="dsar-root dsar-root-wide">
			<h1>Request queue</h1>
			<p className="dsar-lede">
				Open filings for this tenant. Verify identity, then fulfil or refuse.
			</p>
			<div className="dsar-panel">
				{alertMessage === null ? null : (
					<p className="dsar-alert" role="alert">
						{alertMessage}
					</p>
				)}
				{rows.length === 0 ? (
					<p className="dsar-empty">
						The queue is empty. File a request in the subject portal, then come
						back here.
					</p>
				) : (
					<ul className="dsar-list">
						{rows.map((row) => (
							<QueueCard
								busy={busyId === row.id}
								detail={details[row.id]}
								key={row.id}
								onAction={(path, body) => {
									if (
										path.endsWith("/refusals") &&
										typeof body === "object" &&
										body !== null &&
										"rationale" in body &&
										typeof body.rationale === "string" &&
										body.rationale.length === 0
									) {
										setAlertMessage("Add a reason to refuse.");
										return;
									}
									void runAction(row.id, path, body);
								}}
								onRefuse={() => {
									setRefuseId(row.id);
									setRefuseReason("");
								}}
								onRefuseCancel={() => setRefuseId(null)}
								onRefuseReason={setRefuseReason}
								person={people[row.id] ?? null}
								refuseOpen={refuseId === row.id}
								refuseReason={refuseReason}
								row={row}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	);
};
