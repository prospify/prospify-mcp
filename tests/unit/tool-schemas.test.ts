/**
 * Tool schema validation tests — verify that all tool parameter schemas
 * accept valid input and reject invalid input correctly.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";

// Reproduce the tool parameter schemas to test them in isolation

describe("get-transactions schema", () => {
	const schema = z.object({
		accountId: z.number().optional(),
		startDate: z.string().optional(),
		endDate: z.string().optional(),
		search: z.string().optional(),
		category: z.string().optional(),
		limit: z.number().max(100).default(50),
		offset: z.number().default(0),
		includeDeleted: z.boolean().default(false),
	});

	test("accepts empty params (all optional)", () => {
		const result = schema.parse({});
		expect(result.limit).toBe(50);
		expect(result.offset).toBe(0);
		expect(result.includeDeleted).toBe(false);
	});

	test("accepts full params", () => {
		const result = schema.parse({
			accountId: 100,
			startDate: "2026-01-01",
			endDate: "2026-12-31",
			search: "uber",
			category: "FOOD_AND_DRINK",
			limit: 25,
			offset: 50,
			includeDeleted: true,
		});
		expect(result.accountId).toBe(100);
		expect(result.limit).toBe(25);
	});

	test("rejects limit over 100", () => {
		expect(() => schema.parse({ limit: 200 })).toThrow();
	});

	test("rejects non-number accountId", () => {
		expect(() => schema.parse({ accountId: "abc" })).toThrow();
	});
});

describe("edit-transaction schema", () => {
	const schema = z.object({
		transactionId: z.number(),
		name: z.string().optional(),
		amount: z.number().positive().optional(),
		date: z.string().optional(),
	});

	test("requires transactionId", () => {
		expect(() => schema.parse({})).toThrow();
	});

	test("accepts transactionId only", () => {
		const result = schema.parse({ transactionId: 42 });
		expect(result.transactionId).toBe(42);
		expect(result.name).toBeUndefined();
	});

	test("rejects negative amount", () => {
		expect(() => schema.parse({ transactionId: 1, amount: -5 })).toThrow();
	});

	test("rejects zero amount", () => {
		expect(() => schema.parse({ transactionId: 1, amount: 0 })).toThrow();
	});
});

describe("mark-benefit-used schema", () => {
	const schema = z.object({
		benefitConfigId: z.string().uuid(),
		amountUsed: z.number().positive(),
		note: z.string().optional(),
	});

	test("rejects non-UUID config ID", () => {
		expect(() => schema.parse({ benefitConfigId: "not-a-uuid", amountUsed: 10 })).toThrow();
	});

	test("accepts valid UUID", () => {
		const result = schema.parse({
			benefitConfigId: "123e4567-e89b-12d3-a456-426614174000",
			amountUsed: 15.5,
			note: "Used at restaurant",
		});
		expect(result.amountUsed).toBe(15.5);
	});

	test("rejects zero amount", () => {
		expect(() =>
			schema.parse({
				benefitConfigId: "123e4567-e89b-12d3-a456-426614174000",
				amountUsed: 0,
			}),
		).toThrow();
	});
});

describe("change-category schema", () => {
	const schema = z.object({
		transactionId: z.number(),
		newCategory: z
			.string()
			.max(100)
			.regex(/^[A-Z][A-Z0-9_]*$/),
		applyToAll: z.boolean().default(false),
	});

	test("defaults applyToAll to false", () => {
		const result = schema.parse({ transactionId: 1, newCategory: "TRAVEL" });
		expect(result.applyToAll).toBe(false);
	});

	test("rejects missing category", () => {
		expect(() => schema.parse({ transactionId: 1 })).toThrow();
	});

	test("accepts valid uppercase categories", () => {
		for (const cat of ["FOOD_AND_DRINK", "TRAVEL", "ENTERTAINMENT", "LOAN_PAYMENTS", "GENERAL_MERCHANDISE"]) {
			expect(schema.parse({ transactionId: 1, newCategory: cat }).newCategory).toBe(cat);
		}
	});

	test("rejects lowercase categories", () => {
		expect(() => schema.parse({ transactionId: 1, newCategory: "travel" })).toThrow();
	});

	test("rejects categories with spaces", () => {
		expect(() => schema.parse({ transactionId: 1, newCategory: "FOOD AND DRINK" })).toThrow();
	});

	test("rejects XSS attempt in category", () => {
		expect(() =>
			schema.parse({ transactionId: 1, newCategory: "<script>alert(1)</script>" }),
		).toThrow();
	});

	test("rejects empty category", () => {
		expect(() => schema.parse({ transactionId: 1, newCategory: "" })).toThrow();
	});

	test("rejects category starting with number", () => {
		expect(() => schema.parse({ transactionId: 1, newCategory: "1FOOD" })).toThrow();
	});

	test("accepts category with numbers", () => {
		expect(schema.parse({ transactionId: 1, newCategory: "CATEGORY2" }).newCategory).toBe(
			"CATEGORY2",
		);
	});
});

describe("confirm-credit-match schema", () => {
	const schema = z.object({
		suggestionId: z.string(),
	});

	test("accepts any string ID", () => {
		const result = schema.parse({ suggestionId: "match-123" });
		expect(result.suggestionId).toBe("match-123");
	});

	test("rejects missing ID", () => {
		expect(() => schema.parse({})).toThrow();
	});
});

describe("dismiss-subscription schema", () => {
	const schema = z.object({
		merchantKey: z.string(),
		accountId: z.number(),
	});

	test("accepts valid params", () => {
		const result = schema.parse({ merchantKey: "netflix", accountId: 100 });
		expect(result.merchantKey).toBe("netflix");
	});

	test("rejects missing accountId", () => {
		expect(() => schema.parse({ merchantKey: "netflix" })).toThrow();
	});
});

describe("get-benefit-details schema", () => {
	const schema = z.object({
		accountId: z.number(),
		frequency: z.enum(["monthly", "quarterly", "semiannual", "annual", "one_time"]),
	});

	test("accepts valid frequency values", () => {
		const freqs = ["monthly", "quarterly", "semiannual", "annual", "one_time"] as const;
		for (const freq of freqs) {
			const result = schema.parse({ accountId: 1, frequency: freq });
			expect(result.frequency).toBe(freq);
		}
	});

	test("rejects invalid frequency", () => {
		expect(() => schema.parse({ accountId: 1, frequency: "weekly" })).toThrow();
	});

	test("rejects missing accountId", () => {
		expect(() => schema.parse({ frequency: "monthly" })).toThrow();
	});
});

describe("link-credit schema", () => {
	const schema = z.object({
		chargeTransactionId: z.number(),
		creditTransactionId: z.number(),
		creditAmount: z.number().positive(),
		note: z.string().optional(),
	});

	test("requires all mandatory fields", () => {
		expect(() => schema.parse({ chargeTransactionId: 1, creditTransactionId: 2 })).toThrow();
	});

	test("rejects non-positive creditAmount", () => {
		expect(() =>
			schema.parse({
				chargeTransactionId: 1,
				creditTransactionId: 2,
				creditAmount: -5,
			}),
		).toThrow();
	});

	test("accepts valid input with note", () => {
		const result = schema.parse({
			chargeTransactionId: 1,
			creditTransactionId: 2,
			creditAmount: 25.0,
			note: "Return",
		});
		expect(result.note).toBe("Return");
	});
});

describe("search-transactions-for-linking schema", () => {
	const schema = z.object({
		accountId: z.number(),
		search: z.string().default(""),
		limit: z.number().max(20).default(10),
	});

	test("defaults search to empty and limit to 10", () => {
		const result = schema.parse({ accountId: 100 });
		expect(result.search).toBe("");
		expect(result.limit).toBe(10);
	});

	test("rejects limit over 20", () => {
		expect(() => schema.parse({ accountId: 100, limit: 50 })).toThrow();
	});
});
