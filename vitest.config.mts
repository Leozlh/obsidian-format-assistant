import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node"
	},
	resolve: {
		alias: {
			obsidian: "./src/test/obsidian-mock.ts"
		}
	}
});
