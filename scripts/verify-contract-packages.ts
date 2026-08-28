import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");
const temporaryRoot = await mkdtemp(join(tmpdir(), "dofus-contracts-"));

const smokeSource = `
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ClientMessageSchema,
  DofusMessageSchema,
  PROTO_VERSION,
} from "@dofus/proto";
import { HandshakeConnectionKeySchema } from "@dofus/proto/account_pb";
import { GatewayFrameSchema } from "@dofus/proto/gateway/v1/gateway_frame_pb";
import { DofusPathfinding, GRID_VERSION } from "@dofus/grid";

const clientBytes = toBinary(ClientMessageSchema, create(ClientMessageSchema, {}));
const client = fromBinary(ClientMessageSchema, clientBytes);
if (client.$typeName !== "dofus.ClientMessage") throw new Error("ClientMessage roundtrip failed");

const serverBytes = toBinary(
  DofusMessageSchema,
  create(DofusMessageSchema, {
    payload: {
      case: "handshakeConnectionKey",
      value: create(HandshakeConnectionKeySchema, { connectionKey: "test" }),
    },
  }),
);
const server = fromBinary(DofusMessageSchema, serverBytes);
if (server.payload.case !== "handshakeConnectionKey") throw new Error("DofusMessage decode failed");
if (!GatewayFrameSchema) throw new Error("protobuf subpath import failed");

const path = new DofusPathfinding(2, 2, [0, 1, 2, 3, 4]).findPath(0, 4);
if (JSON.stringify(path) !== "[0,2,4]") throw new Error("grid pathfinding failed");
if (!PROTO_VERSION || !GRID_VERSION) throw new Error("package versions missing");
`;

try {
  await run("bun", ["run", "contracts:build"], repositoryRoot);

  const tarballDirectory = join(temporaryRoot, "tarballs");
  await mkdir(tarballDirectory);
  const protoTarball = await pack(
    resolve(repositoryRoot, "packages/proto"),
    tarballDirectory
  );
  const gridTarball = await pack(
    resolve(repositoryRoot, "packages/grid"),
    tarballDirectory
  );

  await verifyConsumer(
    "node-consumer",
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    ["node", "smoke.mjs"],
    protoTarball,
    gridTarball
  );
  await verifyConsumer(
    "bun-consumer",
    "bun",
    ["install", "--ignore-scripts"],
    ["bun", "smoke.mjs"],
    protoTarball,
    gridTarball
  );

  console.log("contract tarballs work outside the monorepo under Node and Bun");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function pack(
  packageDirectory: string,
  destination: string
): Promise<string> {
  const output = await run(
    "npm",
    ["pack", "--ignore-scripts", "--silent", "--pack-destination", destination],
    packageDirectory,
    true,
    { SKIP_PROTO_GEN: "1" }
  );
  const filename = output.trim().split("\n").at(-1);
  if (!filename) {
    throw new Error(`npm pack produced no tarball for ${packageDirectory}`);
  }
  return join(destination, filename);
}

async function verifyConsumer(
  name: string,
  installer: string,
  installArguments: string[],
  runtime: [string, ...string[]],
  protoTarball: string,
  gridTarball: string
): Promise<void> {
  const directory = join(temporaryRoot, name);
  await mkdir(directory);

  await Bun.write(
    join(directory, "package.json"),
    JSON.stringify(
      {
        name,
        private: true,
        type: "module",
        dependencies: {
          "@bufbuild/protobuf": "2.11.0",
          "@dofus/proto": `file:${protoTarball}`,
          "@dofus/grid": `file:${gridTarball}`,
          typescript: "5.9.3",
        },
      },
      null,
      2
    )
  );
  await Bun.write(join(directory, "smoke.mjs"), smokeSource);
  await Bun.write(join(directory, "smoke.ts"), smokeSource);
  await Bun.write(
    join(directory, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["smoke.ts"],
      },
      null,
      2
    )
  );

  await run(installer, installArguments, directory);
  await run(runtime[0], runtime.slice(1), directory);
  await run(
    resolve(directory, "node_modules/.bin/tsc"),
    ["--project", "tsconfig.json"],
    directory
  );
}

async function run(
  command: string,
  args: string[],
  cwd: string,
  capture = false,
  additionalEnvironment: Record<string, string> = {}
): Promise<string> {
  const child = Bun.spawn([command, ...args], {
    cwd,
    env: {
      ...process.env,
      npm_config_cache: join(temporaryRoot, "npm-cache"),
      ...additionalEnvironment,
    },
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const stdout = capture ? await new Response(child.stdout).text() : "";
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${exitCode}`);
  }
  return stdout;
}
