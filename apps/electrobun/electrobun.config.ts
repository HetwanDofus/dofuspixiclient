import type { ElectrobunConfig } from "electrobun";

export default {
	app: {
		name: "react-tailwind-vite",
		identifier: "reacttailwindvite.electrobun.dev",
		version: "0.0.1",
	},
	build: {
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
