import { describe, expect, test } from "bun:test";
import { getUserId } from "../../src/auth";

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
