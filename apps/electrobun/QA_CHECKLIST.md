# QA Smoke Checklist

Run this end-to-end after every rewrite phase. If any step regresses, the phase is not done.

Start: `bun run dev` (Vite + electrobun).

## 1. Boot
- [ ] Electrobun window opens without console errors
- [ ] Main view renders; fonts loaded; theme applied
- [ ] No React hydration / Vite HMR errors in terminal

## 2. Connection + login
- [ ] WebSocket connects (green state in `connection.machine`)
- [ ] Login flow completes; session machine transitions to authenticated
- [ ] Character list loads; character selection enters the game

## 3. Map rendering
- [ ] Tiles render (`.dofasset` assets, no SVG fallbacks)
- [ ] Character sprites appear at correct cells
- [ ] Map boundaries/edges draw correctly
- [ ] Adjacent-map preloader does not stall

## 4. Movement
- [ ] Click on reachable cell → pathfinding highlights path
- [ ] Character walks the path with animation
- [ ] Click on unreachable cell → no walk, no crash

## 5. Combat entry
- [ ] Initiate combat → `combat.machine` transitions to in-combat
- [ ] Grid overlay appears; fighters place on start cells
- [ ] Turn order / timeline HUD populated

## 6. Combat actions
- [ ] Walk within AP budget → MP deducts; AP preserved
- [ ] Select a spell from the spell bar → target cells highlight
- [ ] Cast spell → animation plays; damage numbers float; HP updates on stores
- [ ] End turn → `combat.machine` advances to next fighter

## 7. Combat end
- [ ] Victory/defeat screen renders
- [ ] Returns to map rendering (step 3)

## 8. Map transition
- [ ] Walk onto edge cell → `map-transition.machine` fires
- [ ] New map loads without full reload; character placed on arrival cell
- [ ] Previous map unloaded (no orphan PIXI objects — check with debug overlay if present)

## 9. HUD panels
- [ ] Open inventory → items render, tooltips work
- [ ] Open character sheet → stats match `character.store`
- [ ] Context menu on fighter/player → actions appear
- [ ] Close panels → no leaked listeners (repeat open/close ×5, no memory growth)

## 10. Build + lint
- [ ] `bun run build` succeeds (Vite + electrobun)
- [ ] `bunx tsc --noEmit` clean
- [ ] `bunx biome check apps/electrobun/src` errors trending down, never up

---

**Regression budget per phase**: 0 new failing items. A phase is complete only when every checked box above is green.
