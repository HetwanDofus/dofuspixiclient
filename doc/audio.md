# Audio

Music and ambient sound work the way the retail 1.29 client did: every map
carries two ids, and both index the `audio` lang bundle, which is the only
thing that knows what the ids mean.

```
maps.music_id ─┐                            ┌─→ AUM[id].f ─→ sound/musics/<f>
               ├─→ GameMapData ─→ client ──┤
maps.ambiance_id ┘        AudioManager      └─→ AUA[id]    ─→ sound/effects/<f>
```

## Where the ids come from

Nowhere but the retail client. The StarLoco dump does not carry them, because
the original never sent them over the wire — it read them from the map's own
SWF (`MapsServersManager.as:135-136`). `just import-map-swf <Client/data/maps>`
parses all 9 209 map SWFs and fills `maps.music_id` / `maps.ambiance_id`:

| | |
|---|---|
| Maps with music | 7 062 |
| Maps with an ambiance | 7 506 |
| Distinct music ids | 33 |
| Distinct ambiance ids | 17 |

`0` (stored as NULL) means the map has none, and the client then **keeps
playing whatever is already playing** — that is the retail behaviour
(`DofusBattlefield.as:130-136` only calls the players when the id is `> 0`), and
it is why walking into a house does not cut the area's theme.

Three music ids the maps reference — 100, 102 and 111, on maps 6150, 1489,
1687 and 1689 — are absent from the lang bundle. The client logs a warning and
leaves the current track alone. Every other id, and all 17 ambiances including
each effect they layer, resolves to a file that exists.

## The lang bundle

`apps/electrobun/public/assets/langs/<locale>/audio.json`, under `data`:

| Key | Contents |
|---|---|
| `AUM` | 42 musics — `{f: file, v: base volume 0-100, l: loop, o: start offset}` |
| `AUE` | 766 sound effects, same shape |
| `AUA` | 20 ambiances — `{bg: [effect ids], n: [effect ids], mind, maxd}` |
| `AUMC`, `AUEC`, `AUAC` | Name → id constants (`PLACE_AMAKNA: 115`) |

An ambiance is a continuous bed (`bg`, looped forever) with one-shot noises
(`n`) fired over it every `mind + round(rand × maxd)` seconds. That is what
makes a forest sound like a forest: a wind loop plus occasional birds.

## The files

`apps/electrobun/public/assets/sound/{musics,effects}/<name>.mp3` — 48 musics
and 905 effects, extracted from `audio/musics.swf` and `audio/effects.swf`.
Both SWFs are just `DefineSound` tags (MP3, format 2) paired with
`ExportAssets` symbol names, and **the symbol name is exactly the lang bundle's
`f` field**, so a file name needs no lookup table.

The published files originally carried an extraction index (`1_loc_kwistmas.
mp3.mp3`); they were renamed to their canonical symbol name so the lang `f`
field is a URL directly. The rename was injective — 953 files, no collisions.

Two caveats:

- The published set is **larger** than what this particular client holds
  (48 musics vs 36 in its `musics.swf`), so it came from a different build.
  Re-extracting from the client on this machine would *lose* 6 musics that the
  lang bundle references. Do not overwrite the published files with a naive
  re-extract.
- 139 of the 905 effects are not in `AUE` at all. They are addressed by symbol
  name rather than id (`AudioManager.playSound` → `getElementFromLinkname`),
  which is how sprite animations trigger their own sounds. Nothing uses them
  yet.

## The client side

`apps/electrobun/src/game/audio/audio-manager.ts` mirrors
`dofus.sounds.AudioManager`: `playMusic(id, saveOld?)`, `backToOldMusic()`,
`playEnvironment(id)`, `playEffect(id)`, with a 4-second cross-fade between
tracks and three independent channels (music / environment / effects) each with
its own volume and mute.

`saveOld` exists for fights: stash the map theme and its position, play the
battle theme, then resume the map theme where it left off. The fight code does
not call it yet.

Every `HTMLAudioElement` touch lives in `sound.ts` behind a `Sound` interface,
and the timers are injected, so `audio-manager.spec.ts` drives fades and the
random noise scheduler on a fake clock with no DOM.

### Autoplay

Browsers refuse to start audio before the page has been interacted with.
`createHtmlSound` catches the rejected `play()` and retries on the first click
or key press — which is the same gesture that makes the character walk, so in
practice the first track starts as soon as the player does anything.
