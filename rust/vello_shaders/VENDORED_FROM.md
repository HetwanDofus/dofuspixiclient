# vello_shaders — vendored fork

Vendored from `vello_shaders` 0.7.0 on crates.io (upstream:
<https://github.com/linebender/vello>, tag `v0.7.0`).

## Why this is vendored

Tier 6 (instanced retained sub-scenes) edits the WGSL pipeline. The
crate moved into the workspace so `rust/vello_shaders/shader/*.wgsl`
edits land natively. The workspace `[patch.crates-io]` table in
`rust/Cargo.toml` redirects the `vello_shaders = "0.7.0"` reference
used by `rust/vello/` to this path.

## Local divergences from upstream 0.7.0

(Track each Tier 6 phase that mutates the WGSL pipeline here so a
future vello upgrade is traceable.)

- **Phase -1:** lint section replaced with the DOFUS
  `clippy.all = allow` pattern (matches `rust/vello/` and
  `rust/vello_encoding/`). No source changes.
- **Phase 2:** to land.

## When upgrading vello

1. Update `rust/vello/`, `rust/vello_encoding/`, `rust/vello_shaders/`
   to the new upstream tag in lockstep — the three must match.
2. Re-apply every divergence listed above on top of the new upstream
   source.
3. Re-run `cargo check --workspace` on both native and
   `wasm32-unknown-unknown` targets.
4. Re-run the Tier 6 snapshot tests
   (`rust/client/tests/snapshot_instanced.rs`).
