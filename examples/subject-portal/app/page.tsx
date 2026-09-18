"use client";

import { DsarProvider, SubjectPortal, hosted } from "@dsar/react";

const Page = () => (
	<DsarProvider mode={hosted({ url: "/api/dsar" })}>
		<SubjectPortal />
	</DsarProvider>
);

export default Page;
