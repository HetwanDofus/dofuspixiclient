import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "react-tailwind-vite",
		identifier: "reacttailwindvite.electrobun.dev",
		version: "0.0.1",
	},
	build: {
		bun: {
			// The bun-side entry was moved under `src/window/bun/` to
			// sit next to the matching mainview React tree, so the
			// default `src/bun/index.ts` path doesn't apply.
			entrypoint: "src/window/bun/index.ts",
		},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
		},
		mac: {
			bundleCEF: true,
		},
		linux: {
			bundleCEF: true,
		},
		win: {
			bundleCEF: true,
		},
	},
} satisfies ElectrobunConfig;
