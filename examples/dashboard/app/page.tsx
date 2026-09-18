"use client";

import { DsarProvider, OperatorQueue, hosted } from "@dsar/react";

const Page = () => (
	<DsarProvider mode={hosted({ url: "/api/dsar" })}>
		<OperatorQueue />
	</DsarProvider>
);

export default Page;
