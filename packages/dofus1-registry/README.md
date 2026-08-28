# Dofus1 Registry

A [shadcn](https://ui.shadcn.com) component registry for Dofus 1.29 game UI components. Built with [Base UI](https://base-ui.com), [Tailwind CSS v4](https://tailwindcss.com), and [Next.js](https://nextjs.org).

**Docs:** [hetwandofus.github.io/dofus1-registry](https://hetwandofus.github.io/dofus1-registry)

## Installation

Add components directly to your project using the shadcn CLI:

```bash
npx shadcn@latest add https://hetwandofus.github.io/dofus1-registry/r/action-popout-menu.json
```

## Components

| Component | Description |
|-----------|-------------|
| **ActionPopoutMenu** | A context menu triggered by right-click or programmatically, styled like the Dofus Zaap menu. |
| **Button** | A pill-shaped button styled like the Dofus 1.29 UI with pressed state. |
| **Scrollbar** | A Dofus 1.29-styled scrollbar with vertical and horizontal axis variants. |
| **MainBanner** | The bottom HUD bar from Dofus 1.29 with chat, minimap circle, action buttons, and fight mode. |

## Resolution Scaling

All components scale proportionally using a `--resolution-factor` CSS variable, calculated from the viewport size relative to the original Dofus resolution (800x600). The game width is capped to maintain the 4:3 aspect ratio:

```css
--resolution-factor: calc(
  min(100vw, calc(100vh * 4 / 3)) / 800px
);
```

Override `--dofus-base-width` and `--dofus-base-height` in your CSS to change the base resolution.

## Development

```bash
bun install
bun run dev          # Start docs site
bun run registry:build  # Build registry JSON
bun run lint         # Check with biome
bun run lint:fix     # Auto-fix
```

## Adding a Component

1. Create the component in `registry/dofus1/ui/my-component.tsx`
2. Add it to `registry.json`
3. Write docs in `content/docs/components/my-component.mdx`
4. Run `bun run registry:build`

## License

MIT
