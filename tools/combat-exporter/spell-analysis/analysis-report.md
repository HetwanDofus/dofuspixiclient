# Spell ActionScript Analysis Report

Generated: 2026-01-09 09:35:53

Total spells analyzed: 282

## Summary by Category

| Category | Count | Description |
|----------|-------|-------------|
| No Script | 2 | No ActionScript - pure animation |
| Simple Stop | 54 | Only stop() calls - no custom TS needed |
| GotoAndPlay | 29 | Uses gotoAndPlay - might need frame jumps |
| Variables | 67 | Uses variables (t, alpha, scale) |
| onEnterFrame | 1 | Uses onEnterFrame - needs ticker |
| Timing | 0 | Uses setInterval/setTimeout |
| Math.random | 30 | Uses randomization |
| Target/Distance | 0 | References target, distance - needs game data |
| Complex | 99 | Multiple complex patterns - needs custom TS |

## Spells Requiring Custom TypeScript (100)

These spells have ActionScript logic that cannot be handled by simple pre-rendering.

### Spell 102
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, removeMovieClip, _root
- Variables: scale, rotation
- Notes: gotoAndPlay(60)

### Spell 103
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent, _root
- Variables: scale, rotation

### Spell 105
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, attachMovie, removeMovieClip, _parent
- Variables: scale

### Spell 112
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: rotation

### Spell 201
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, attachMovie, removeMovieClip, _parent
- Variables: rotation
- Notes: gotoAndPlay(18)

### Spell 202
- Complexity: complex
- Actions: stop, play, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 205
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(4)

### Spell 207
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 208
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 209
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 210
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, attachMovie, removeMovieClip, _parent
- Variables: rotation
- Notes: gotoAndPlay(18)

### Spell 211
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 212
- Complexity: complex
- Actions: stop, onEnterFrame, removeMovieClip, _parent
- Variables: rotation

### Spell 301
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 302
- Complexity: complex
- Actions: stop, play, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: rotation

### Spell 303
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 304
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 305
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(1)

### Spell 306
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: rotation

### Spell 314
- Complexity: ticker
- Actions: gotoAndPlay, onEnterFrame, removeMovieClip, _parent

### Spell 316
- Complexity: complex
- Actions: stop, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 317
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(1)

### Spell 401
- Complexity: complex
- Actions: stop, onEnterFrame, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 404
- Complexity: complex
- Actions: stop, onEnterFrame, attachMovie, removeMovieClip, _parent
- Variables: scale

### Spell 405
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 406
- Complexity: complex
- Actions: stop, gotoAndPlay, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 408
- Complexity: complex
- Actions: stop, gotoAndPlay, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 501
- Complexity: complex
- Actions: stop, gotoAndPlay, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 502
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 507
- Complexity: complex
- Actions: stop, play, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 512
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 513
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 515
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 601
- Complexity: complex
- Actions: stop, gotoAndStop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 603
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 611
- Complexity: complex
- Actions: stop, gotoAndStop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 615
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 616
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 806
- Complexity: complex
- Actions: stop, gotoAndStop, onEnterFrame, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 808
- Complexity: complex
- Actions: stop, gotoAndPlay, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 809
- Complexity: complex
- Actions: stop, gotoAndPlay, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 815
- Complexity: complex
- Actions: stop, gotoAndStop, onEnterFrame, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 816
- Complexity: complex
- Actions: stop, gotoAndStop, onEnterFrame, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 902
- Complexity: complex
- Actions: onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 905
- Complexity: complex
- Actions: gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 906
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 909
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 911
- Complexity: complex
- Actions: stop, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1015
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: rotation

### Spell 1050
- Complexity: complex
- Actions: stop, play, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale

### Spell 1053
- Complexity: complex
- Actions: play, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(4)

### Spell 1055
- Complexity: complex
- Actions: stop, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1200
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1201
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: rotation

### Spell 1203
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1204
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1205
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1206
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1207
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, removeMovieClip, _parent
- Variables: scale
- Notes: gotoAndPlay(3)

### Spell 1209
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1211
- Complexity: complex
- Actions: stop, play, gotoAndPlay, onEnterFrame, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 1212
- Complexity: complex
- Actions: stop, gotoAndStop, onEnterFrame, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2011
- Complexity: complex
- Actions: gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2012
- Complexity: complex
- Actions: gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2013
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: rotation

### Spell 2014
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2015
- Complexity: complex
- Actions: gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2016
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(1)

### Spell 2017
- Complexity: complex
- Actions: stop, play, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2018
- Complexity: complex
- Actions: stop, play, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2044
- Complexity: complex
- Actions: stop, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2046
- Complexity: complex
- Actions: stop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2049
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: rotation

### Spell 2051
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(2)

### Spell 2054
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: rotation

### Spell 2059
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2065
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: rotation

### Spell 2066
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: rotation

### Spell 2067
- Complexity: complex
- Actions: stop, onEnterFrame, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2070
- Complexity: complex
- Actions: stop, play, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2071
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, removeMovieClip, _parent
- Variables: scale

### Spell 2103
- Complexity: complex
- Actions: stop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2107
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, removeMovieClip, _root
- Variables: scale, rotation
- Notes: gotoAndPlay(57)

### Spell 2109
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(2)

### Spell 2110
- Complexity: complex
- Actions: stop, onEnterFrame, removeMovieClip, _parent
- Variables: rotation

### Spell 2111
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(2)

### Spell 2116
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, removeMovieClip, _root
- Variables: scale, rotation
- Notes: gotoAndPlay(38)

### Spell 2900
- Complexity: complex
- Actions: stop, play, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2901
- Complexity: complex
- Actions: stop, play, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2902
- Complexity: complex
- Actions: stop, play, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2903
- Complexity: complex
- Actions: stop, play, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2904
- Complexity: complex
- Actions: stop, play, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 2905
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay("exp")

### Spell 2905
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay("exp")

### Spell 2912
- Complexity: complex
- Actions: stop, onEnterFrame, removeMovieClip, _parent
- Variables: rotation

### Spell 2914
- Complexity: complex
- Actions: stop, gotoAndPlay, gotoAndStop, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation
- Notes: gotoAndPlay(1)

### Spell 3000
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 3001
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 3002
- Complexity: complex
- Actions: stop, gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

### Spell 4600
- Complexity: complex
- Actions: gotoAndPlay, onEnterFrame, Math_random, attachMovie, removeMovieClip, _parent
- Variables: scale, rotation

## Simple Spells (No Custom TS Needed)

These spells can be handled with pre-rendered frames or simple stop frame logic.

IDs: 2052, 2911, 1001, 1002, 1004, 1009, 1016, 108, 110, 1100, 1109, 1208, 1213, 1481, 2002, 2003, 2004, 2005, 2007, 2008, 2010, 2042, 2057, 2058, 206, 2061, 2062, 2063, 2069, 2102, 2113, 2117, 2915, 2918, 2919, 2920, 2921, 2922, 2923, 2924, 307, 308, 309, 402, 4800, 505, 506, 509, 605, 607, 608, 783, 807, 810, 813, 0, 1003, 1006, 1010, 1012, 1056, 1101, 1102, 1103, 1104, 1105, 1107, 111, 2112, 2917, 510, 511, 610, 613, 701, 702, 704, 705, 706, 707, 712, 713, 714, 803, 811

## Spells Using Variables (May Need Custom TS)

- **1005**: scale
- **1007**: scale
- **1008**: scale (gotoAndPlay(40))
- **1011**: scale, rotation
- **1014**: scale, rotation
- **104**: scale, rotation
- **109**: rotation
- **1202**: rotation
- **1210**: scale, rotation (gotoAndPlay(148))
- **1214**: scale
- **2001**: rotation
- **2006**: rotation (gotoAndPlay(2))
- **2009**: rotation
- **2019**: scale, rotation
- **2021**: rotation
- **2022**: rotation
- **2030**: scale, rotation
- **2040**: rotation
- **2041**: rotation
- **2043**: rotation
- **2045**: rotation
- **2047**: rotation
- **2048**: rotation
- **2053**: rotation
- **2055**: rotation
- **2060**: rotation
- **2064**: rotation
- **2068**: rotation
- **2101**: rotation
- **2104**: rotation
- **2105**: scale, rotation
- **2106**: rotation
- **2108**: rotation (gotoAndPlay(2))
- **2114**: rotation
- **2115**: rotation
- **2119**: rotation
- **214**: rotation (gotoAndPlay(2))
- **2910**: rotation
- **2925**: rotation
- **3003**: rotation
- **311**: scale, rotation
- **315**: rotation (gotoAndPlay(2))
- **407**: scale, rotation
- **409**: scale, rotation
- **410**: scale, rotation
- **411**: scale, rotation
- **412**: rotation
- **503**: rotation
- **508**: rotation (gotoAndPlay(1))
- **514**: rotation (gotoAndPlay(11))
- **604**: scale, rotation
- **606**: rotation (gotoAndPlay(2))
- **609**: rotation
- **612**: scale, rotation
- **703**: scale (gotoAndPlay(2))
- **708**: rotation (gotoAndPlay(2))
- **709**: rotation
- **710**: rotation
- **711**: rotation
- **802**: scale, rotation
- **805**: scale
- **812**: scale, rotation
- **814**: rotation
- **901**: rotation
- **908**: scale, rotation
- **910**: rotation
- **912**: scale, rotation

## Spells Using Math.random()

These spells have randomized behavior that needs implementation.

IDs: 101, 1013, 1051, 1052, 1054, 2000, 2020, 2023, 2050, 2056, 213, 2200, 2906, 2907, 2908, 2909, 2916, 310, 312, 313, 403, 504, 602, 614, 801, 804, 903, 904, 907, 913

