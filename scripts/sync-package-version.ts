import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const [packageDirectoryArg, outputArg, constantName] = process.argv.slice(2);

if (!packageDirectoryArg || !outputArg || !constantName) {
  throw new Error(
    "usage: bun scripts/sync-package-version.ts <package-dir> <output.ts> <CONSTANT_NAME>"
  );
}

if (!/^[A-Z][A-Z0-9_]*$/.test(constantName)) {
  throw new Error(`invalid constant name ${JSON.stringify(constantName)}`);
}

const packageDirectory = resolve(packageDirectoryArg);
const packageJson = JSON.parse(
  await readFile(resolve(packageDirectory, "package.json"), "utf8")
) as { name?: string; version?: string };

if (!packageJson.name || !packageJson.version) {
  throw new Error(`${packageDirectory}/package.json needs name and version`);
}

const outputPath = resolve(packageDirectory, outputArg);
const source = `// Generated from package.json by scripts/sync-package-version.ts.\n// Do not edit this value by hand.\nexport const ${constantName} = ${JSON.stringify(packageJson.version)};\n`;

await writeFile(outputPath, source);
console.log(`${packageJson.name}@${packageJson.version} -> ${outputPath}`);
