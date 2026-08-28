# Public client contracts

External clients do not need a checkout of this repository. Three immutable
artifacts define the shared boundary:

| Artifact | Public contract |
|---|---|
| `@dofus/proto` | Protobuf envelopes and generated message schemas |
| `@dofus/grid` | Dofus 1.29 grid geometry and pathfinding |
| `/assets/data/navigation-manifest.json` | Static global map graph matching the imported server world |

The packages contain ESM JavaScript, declarations and source maps under
`dist/`; no TypeScript source is needed at runtime. `@dofus/proto` supports
both its barrel and stable generated subpaths such as
`@dofus/proto/account_pb` and
`@dofus/proto/gateway/v1/gateway_frame_pb`.

## Build and verify

```bash
bun run contracts:build
bun run contracts:verify
```

The verification creates `npm pack` tarballs, installs them in temporary
non-workspace projects, runs protobuf and grid smoke tests under Node and Bun,
and compiles the consumer with TypeScript.

Regenerate protobuf sources after changing `proto/*.proto`:

```bash
bun run --cwd packages/proto gen
```

CI rejects any generated diff. Contract publication is handled by
`contracts-publish.yml`; its registry is configurable, and it refuses to
overwrite an existing package version.

## Navigation manifest

`just import-world game.sql` now ends with `just export-navigation`. The
standalone command is useful after a database correction:

```bash
just export-navigation
```

It writes these versioned public assets:

- `/assets/data/navigation-manifest.json`;
- `/assets/data/navigation-manifest.schema.json`.

The manifest contains sorted maps, elected border transitions and valid
scripted teleports. Scripted transitions have priority `100`, ahead of the
geometric border fallback at priority `10`. It intentionally omits detailed
cell geometry; the current map still arrives through `GameMapData`.

`worldRevision` is the SHA-256 of the canonical payload without the hash field.
No timestamp participates, so two exports of the same database are identical
byte for byte. Missing targets, duplicate transition selectors and missing
required map data stop the export.

## Compatibility handshake

Before credentials, `HandshakeConnectionKey` announces:

- the exact `@dofus/proto` version;
- the exact `@dofus/grid` version;
- the navigation `schemaVersion`;
- the navigation `worldRevision`.

The official client logs these values and waits for a compatible contract
before sending `AccountSendIdentity`. Package majors follow semver; the
navigation schema integer is itself a major version. Consumers should pin
exact package versions and download the announced world revision.

Versioning policy:

- backward-compatible protobuf additions: minor;
- protobuf removals, semantic changes or field renumbering: major;
- fixes without contract changes: patch;
- incompatible grid behavior: major.
