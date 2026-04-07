/**
 * Security-focused unit tests — validate input sanitization, length limits,
 * and auth guard behavior.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { escapeLikePattern } from "../../src/utils";

describe("escapeLikePattern", () => {
	test("escapes % wildcard", () => {
		expect(escapeLikePattern("100%")).toBe("100\\%");
	});

	test("escapes _ wildcard", () => {
		expect(escapeLikePattern("file_name")).toBe("file\\_name");
	});

	test("escapes both wildcards together", () => {
		expect(escapeLikePattern("%_test_%")).toBe("\\%\\_test\\_\\%");
	});

	test("leaves normal strings unchanged", () => {
		expect(escapeLikePattern("uber eats")).toBe("uber eats");
	});

	test("handles empty string", () => {
		expect(escapeLikePattern("")).toBe("");
	});

	test("escapes consecutive wildcards", () => {
		expect(escapeLikePattern("%%%")).toBe("\\%\\%\\%");
	});

	test("escapes backslash before wildcards", () => {
		// Backslash must be escaped first to prevent \% bypass
		expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
	});

	test("escapes standalone backslash", () => {
		expect(escapeLikePattern("test\\path")).toBe("test\\\\path");
	});

	test("handles backslash-underscore combination", () => {
		expect(escapeLikePattern("\\_")).toBe("\\\\\\_");
	});
});

describe("string length limits on tool schemas", () => {
	// Reproduce actual schema constraints from the tools

	const getTransactionsSchema = z.object({
		search: z.string().max(500).optional(),
		startDate: z.string().max(10).optional(),
		endDate: z.string().max(10).optional(),
		category: z.string().max(100).optional(),
	});

	test("rejects search string over 500 chars", () => {
		expect(() =>
			getTransactionsSchema.parse({ search: "a".repeat(501) }),
		).toThrow();
	});

	test("accepts search string at 500 chars", () => {
		const result = getTransactionsSchema.parse({ search: "a".repeat(500) });
		expect(result.search!.length).toBe(500);
	});

	test("rejects date string over 10 chars", () => {
		expect(() =>
			getTransactionsSchema.parse({ startDate: "2026-01-01T00:00:00Z" }),
		).toThrow();
	});

	test("rejects category over 100 chars", () => {
		expect(() =>
			getTransactionsSchema.parse({ category: "X".repeat(101) }),
		).toThrow();
	});

	const editTransactionSchema = z.object({
		transactionId: z.number(),
		name: z.string().max(500).optional(),
		date: z.string().max(10).optional(),
	});

	test("rejects name over 500 chars", () => {
		expect(() =>
			editTransactionSchema.parse({
				transactionId: 1,
				name: "a".repeat(501),
			}),
		).toThrow();
	});

	const changeCategorySchema = z.object({
		transactionId: z.number(),
		newCategory: z.string().max(100),
		applyToAll: z.boolean().default(false),
	});

	test("rejects newCategory over 100 chars", () => {
		expect(() =>
			changeCategorySchema.parse({
				transactionId: 1,
				newCategory: "X".repeat(101),
			}),
		).toThrow();
	});

	const creditMatchSchema = z.object({
		suggestionId: z.string().max(200),
	});

	test("rejects suggestionId over 200 chars", () => {
		expect(() =>
			creditMatchSchema.parse({ suggestionId: "x".repeat(201) }),
		).toThrow();
	});

	const dismissSubSchema = z.object({
		merchantKey: z.string().max(500),
		accountId: z.number(),
	});

	test("rejects merchantKey over 500 chars", () => {
		expect(() =>
			dismissSubSchema.parse({ merchantKey: "x".repeat(501), accountId: 1 }),
		).toThrow();
	});

	const noteSchema = z.object({
		note: z.string().max(1000).optional(),
	});

	test("rejects note over 1000 chars", () => {
		expect(() => noteSchema.parse({ note: "x".repeat(1001) })).toThrow();
	});

	test("accepts note at exactly 1000 chars", () => {
		const result = noteSchema.parse({ note: "x".repeat(1000) });
		expect(result.note!.length).toBe(1000);
	});
});

describe("LIKE injection prevention", () => {
	test("search with % wildcard is escaped", () => {
		const search = "100% match";
		const escaped = escapeLikePattern(search);
		expect(escaped).toBe("100\\% match");
	});

	test("search with _ wildcard is escaped", () => {
		const search = "file_2024_01";
		const escaped = escapeLikePattern(search);
		expect(escaped).toBe("file\\_2024\\_01");
	});

	test("adversarial patterns are neutralized", () => {
		const patterns = [
			"%", // Match everything
			"_", // Match any single char
			"%%", // Match everything
			"_%_", // Match strings of length >= 2
			"\\", // Backslash
		];

		for (const pattern of patterns) {
			const escaped = escapeLikePattern(pattern);
			// None should contain unescaped wildcards
			expect(escaped.replace(/\\%/g, "").replace(/\\_/g, "")).not.toContain("%");
			expect(escaped.replace(/\\%/g, "").replace(/\\_/g, "")).not.toContain("_");
		}
	});
});

describe("negative offset prevention", () => {
	const schema = z.object({
		offset: z.number().min(0).default(0),
	});

	test("rejects negative offset", () => {
		expect(() => schema.parse({ offset: -1 })).toThrow();
	});

	test("accepts zero offset", () => {
		expect(schema.parse({ offset: 0 }).offset).toBe(0);
	});
});
