export async function syncSplitwiseForUser(accessToken: string) {
	const appUrl = (process.env.PROSPIFY_APP_URL || "https://prospify.app").replace(/\/$/, "");
	const response = await fetch(
		`${appUrl}/api/mcp/sync-splitwise`,
		{
			method: "POST",
			headers: { Authorization: `Bearer ${accessToken}` },
		},
	);

	const body = (await response.json().catch(() => null)) as
		| Record<string, unknown>
		| null;
	if (!response.ok) {
		throw new Error(
			(typeof body?.error === "string" && body.error) ||
				`Splitwise sync failed (${response.status})`,
		);
	}

	return body ?? { success: true };
}
