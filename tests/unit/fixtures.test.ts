import { describe, expect, test } from "bun:test";
import { sampleAccounts, sampleBenefitConfigs, sampleTransactions } from "../helpers/fixtures";

describe("fixtures", () => {
	test("sample transactions have required fields", () => {
		for (const tx of sampleTransactions) {
			expect(tx.id).toBeNumber();
			expect(tx.plaid_transaction_id).toBeString();
			expect(tx.name).toBeString();
			expect(tx.amount).toBeNumber();
			expect(tx.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(tx.category).toBeString();
		}
	});

	test("sample accounts have required fields", () => {
		for (const acc of sampleAccounts) {
			expect(acc.id).toBeNumber();
			expect(acc.name).toBeString();
			expect(acc.mask).toMatch(/^\d{4}$/);
			expect(acc.type).toBeString();
		}
	});

	test("sample benefit configs have required fields", () => {
		for (const config of sampleBenefitConfigs) {
			expect(config.id).toBeString();
			expect(config.benefit_name).toBeString();
			expect(config.frequency).toBeString();
			expect(Number(config.amount)).toBeGreaterThan(0);
			expect(config.merchant_patterns).toBeArray();
		}
	});
});
