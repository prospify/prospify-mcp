import {
	metadataCorsOptionsRequestHandler,
	protectedResourceHandler,
} from "mcp-handler";

const handler = protectedResourceHandler({
	authServerUrls: [
		`${process.env.SUPABASE_URL || "https://woyzkhxlffctvwsoytuk.supabase.co"}/auth/v1`,
	],
});

const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
