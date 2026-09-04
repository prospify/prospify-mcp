export function GET() {
	return new Response("Prospify MCP server is running", {
		status: 200,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}
