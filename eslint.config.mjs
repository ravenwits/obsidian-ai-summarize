import tsparser from "@typescript-eslint/parser";
import json from "@eslint/json";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{
		ignores: ["main.js", "*.map", "*.mjs", "node_modules/**"],
	},
	...obsidianmd.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					acronyms: ["AI", "API", "GPT", "YAML"],
					brands: ["OpenAI"],
					enforceCamelCaseLower: true,
				},
			],
		},
	},
	{
		files: ["package.json", "manifest.json", "versions.json"],
		language: "json/json",
		plugins: { json },
		rules: {
			"no-irregular-whitespace": "off",
			"obsidianmd/no-plugin-as-component": "off",
			"obsidianmd/no-view-references-in-plugin": "off",
			"obsidianmd/no-unsupported-api": "off",
			"obsidianmd/prefer-file-manager-trash-file": "off",
			"obsidianmd/prefer-instanceof": "off",
		},
	},
	{
		files: ["src/settings/settings.ts"],
		rules: {
			"@typescript-eslint/no-deprecated": "off",
		},
	},
	{
		files: ["eslint.config.mjs", "esbuild.config.mjs", "version-bump.mjs"],
		rules: {
			"import/no-nodejs-modules": "off",
			"import/no-extraneous-dependencies": "off",
		},
	},
]);
