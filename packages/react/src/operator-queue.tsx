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

interface AcmeSlice<T> {
	readonly live: number;
	readonly preview: readonly T[];
	readonly total: number;
}

interface AcmePerson {
	readonly orders: AcmeSlice<{
		readonly amountCents: number;
		readonly createdAt: string;
		readonly deletedAt: string | null;
		readonly sku: string;
	}>;
	readonly sessions: AcmeSlice<{
		readonly deletedAt: string | null;
		readonly id: string;
		readonly ip: string;
		readonly lastSeen: string;
	}>;
	readonly user: {
		readonly deletedAt: string | null;
		readonly email: string;
		readonly name: string;
		readonly plan: string;
	} | null;
}

const fulfilLabel = (requestType: string | undefined, liveRecords: number) => {
	if (requestType === "delete" && liveRecords > 0) {
		return `Erase ${String(liveRecords)} live record${liveRecords === 1 ? "" : "s"}`;
	}
	if (requestType === "delete") {
		return "Confirm data is gone";
	}
	return "Complete request";
};

const formatMoney = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const demoPeopleUrl = (dsarBaseUrl: string, email: string): string => {
	const origin = dsarBaseUrl.replace(/\/api\/v1\/?$/, "");
	return `${origin}/demo/people?email=${encodeURIComponent(email)}`;
};

const AcmeRecords = ({ person }: { readonly person: AcmePerson | null }) => {
	if (person === null || person.user === null) {
		return (
			<div className="dsar-acme">
				<p className="dsar-list-title">Held at Acme</p>
				<p className="dsar-empty">
					No product account for this email. Fulfilment will not delete
					anything.
				</p>
			</div>
		);
	}
	const liveTotal =
		person.sessions.live +
		person.orders.live +
		(person.user.deletedAt === null ? 1 : 0);
	const erased = liveTotal === 0;
	return (
		<div className="dsar-acme">
			<p className="dsar-list-title">Held at Acme</p>
			<p className="dsar-meta">
				{person.user.name} · {person.user.plan} plan
			</p>
			{erased ? (
				<p className="dsar-acme-ok" role="status">
					Nothing live remains. Account, sessions, and orders are tombstoned.
				</p>
			) : (
				<p className="dsar-meta">
					{String(liveTotal)} live record{liveTotal === 1 ? "" : "s"} will be
					erased. Tables show a preview, not the full store.
				</p>
			)}
			<table className="dsar-table">
				<caption className="dsar-table-caption">
					Sessions · {String(person.sessions.preview.length)} of{" "}
					{String(person.sessions.total)}
				</caption>
				<thead>
					<tr>
						<th scope="col">ID</th>
						<th scope="col">IP</th>
						<th scope="col">Last seen</th>
						<th scope="col">State</th>
					</tr>
				</thead>
				<tbody>
					{person.sessions.preview.map((session) => (
						<tr
							className={
								session.deletedAt === null ? undefined : "dsar-row-gone"
							}
							key={session.id}
						>
							<td className="dsar-mono">{session.id}</td>
							<td className="dsar-mono">{session.ip}</td>
							<td>{formatWhen(session.lastSeen)}</td>
							<td>{session.deletedAt === null ? "live" : "deleted"}</td>
						</tr>
					))}
				</tbody>
			</table>
			<table className="dsar-table">
				<caption className="dsar-table-caption">
					Orders · {String(person.orders.preview.length)} of{" "}
					{String(person.orders.total)}
				</caption>
				<thead>
					<tr>
						<th scope="col">SKU</th>
						<th className="dsar-num" scope="col">
							Amount
						</th>
						<th scope="col">Placed</th>
						<th scope="col">State</th>
					</tr>
				</thead>
				<tbody>
					{person.orders.preview.map((order) => (
						<tr
							className={order.deletedAt === null ? undefined : "dsar-row-gone"}
							key={order.id}
						>
							<td className="dsar-mono">{order.sku}</td>
							<td className="dsar-num">{formatMoney(order.amountCents)}</td>
							<td>{formatWhen(order.createdAt)}</td>
							<td>{order.deletedAt === null ? "live" : "deleted"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
};

const QueueActions = ({
	busy,
	liveRecords,
	onAction,
	onRefuse,
	path,
	requestType,
	status,
}: {
	readonly busy: boolean;
	readonly liveRecords: number;
	readonly onAction: (path: string, body: unknown) => void;
	readonly onRefuse: () => void;
	readonly path: (suffix: string) => string;
	readonly requestType: string | undefined;
	readonly status: string | undefined;
}) => (
	<div className="dsar-actions dsar-actions-row">
		{status === "captured" ? (
			<button
				disabled={busy}
				onClick={() => onAction(path("/verification/request"), {})}
				type="button"
			>
				Match to Acme account
			</button>
		) : null}
		{status === "verification_pending" ? (
			<>
				<button
					disabled={busy}
					onClick={() => onAction(path("/verification/approve"), {})}
					type="button"
				>
					Identity matches
				</button>
				<button
					className="dsar-btn-secondary"
					disabled={busy}
					onClick={() => onAction(path("/verification/reject"), {})}
					type="button"
				>
					Not this person
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
					{fulfilLabel(requestType, liveRecords)}
				</button>
				<button
					className="dsar-btn-danger"
					disabled={busy}
					onClick={onRefuse}
					type="button"
				>
					Refuse request
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
				Close request
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
	const liveRecords =
		person === null || person.user === null
			? 0
			: person.sessions.live +
				person.orders.live +
				(person.user.deletedAt === null ? 1 : 0);
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
				liveRecords={liveRecords}
				onAction={onAction}
				onRefuse={onRefuse}
				path={path}
				requestType={requestType}
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
				Match the filer to an Acme account, then erase those rows. Deleted rows
				stay in the table so you can check the webhook ran.
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
