import { getDemoInstance, withDemoAuth } from "../../../../lib/dsar-instance";

const handle = async (request: Request): Promise<Response> => {
	const instance = await getDemoInstance();
	return instance.handler(withDemoAuth(request));
};

export {
	handle as GET,
	handle as POST,
	handle as PUT,
	handle as PATCH,
	handle as DELETE,
	handle as OPTIONS,
};
