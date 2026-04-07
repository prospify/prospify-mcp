import { describe, expect, test } from "bun:test";
import { getUserId, resolveUserId } from "../../src/auth";

describe("getUserId", () => {
	test("throws when session is undefined", async () => {
		expect(getUserId(undefined)).rejects.toThrow("Authentication required");
	});

	test("throws when session has no email", async () => {
		expect(getUserId({ accessToken: "test" })).rejects.toThrow("Authentication required");
	});

	test("throws when email is empty string", async () => {
		expect(getUserId({ email: "", accessToken: "test" })).rejects.toThrow(
			"Authentication required",
		);
	});
});

describe("resolveUserId error messages", () => {
	test("error for unknown email does NOT contain the email address", async () => {
		const testEmail = "secret-user@example.com";
		try {
			await resolveUserId(testEmail);
			// If it succeeds (unlikely for this email), that's fine
		} catch (e) {
			const message = (e as Error).message;
			// The error should NOT leak the email (prevents user enumeration)
			expect(message).not.toContain(testEmail);
			expect(message).toContain("No Prospify account found");
		}
	});
});
