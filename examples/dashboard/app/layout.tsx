import type { ReactNode } from "react";

const RootLayout = ({ children }: { readonly children: ReactNode }) => (
	<html lang="en">
		<body>{children}</body>
	</html>
);

export default RootLayout;
