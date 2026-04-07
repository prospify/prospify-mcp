/**
 * Test setup — preloaded before all test files.
 */

// Suppress console output in tests unless DEBUG is set
if (!process.env.DEBUG) {
	console.log = () => {};
	console.debug = () => {};
}
