import { describe, expect, test } from "bun:test";
import { isWriteAllowed, requireWriteAccess } from "../../src/lib/permissions";

describe("MCP write permission decisions", () => {
	test("allows only an explicit true grant", () => {
		expect(isWriteAllowed({ write_allowed: true })).toBe(true);
		expect(isWriteAllowed({ write_allowed: false })).toBe(false);
		expect(isWriteAllowed(null)).toBe(false);
		expect(isWriteAllowed({})).toBe(false);
	});

	test("blocks mutation when the OAuth grant is read-only or missing", async () => {
		const context = { accessToken: "token", userId: "user", clientId: "client" };
		await expect(
			requireWriteAccess(context, async () => ({ write_allowed: false })),
		).rejects.toThrow(/read-and-write/i);
		await expect(requireWriteAccess(context, async () => null)).rejects.toThrow(/read-and-write/i);
	});

	test("blocks mutation when permission lookup fails", async () => {
		const context = { accessToken: "token", userId: "user", clientId: "client" };
		await expect(
			requireWriteAccess(context, async () => {
				throw new Error("lookup failed");
			}),
		).rejects.toThrow("lookup failed");
	});
});
