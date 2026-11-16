# XC-R static — the XC-R player, with a ghost partner

A static test space for **XC-R**, the remake of Xplosive Collision: the same
RNBO device (`xplosive-collision`, rnbo.js 1.4.2), the same preset space, sound
analysis, radar and score of targets as the networked
[XC_R](https://github.com/lucamorino/XC_R) player and server, packaged as a
plain website — the same architecture as
[XC_INSTR](https://github.com/lucamorino/XC_INSTR).

No server, no second phone, no controller. Your partner is a **ghost**.

## Using it

- Press **>>>** to start (on iOS, allow the motion sensors).
- **Tilt the phone** to move the dot; the noise follows it through the preset
  space (the 9 small points). Without motion sensors (desktop, permission
  denied, or `?nomotion`) you drag on the pad instead.
- The **radar** behind the dot shows the five descriptors of your sound
  (sharpness, loudness, centroid, dissonance, complexity) and, during a round,
  your configuration of the current **target** (dashed). With a shared dot
  the ghost's sound is drawn too, as a dotted outline.
- **The ghost** is the second player. It has its own input on the pad and its
  own sound — silent, read from the calibration of the patch
  (`assets/targets.json`) at the position of its dot, in its own preset space
  (mirrored when `mapping` is mirrored), exactly as the second phone would
  hear it. With **auto** it moves like a player: it explores a sector, dashes
  to another, and during a round it looks for its configuration of the
  target, finding it more precisely the longer the target has been played.

The buttons at the bottom of the page are the controller's switches:

| button              | XC-R                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| **shared / own**    | `control`: one dot at the midpoint of both inputs, or each their own    |
| **coop / comp / free** | `goal`: team score, two scores with a winner, or no score shown      |
| **mirror / same**   | `mapping`: the ghost's preset space is point-mirrored, or the same      |
| **trial / round**   | `training` on (radar only) / a scored round (`training` off, `running`) |
| **next**            | NEXT in the controller: skip to the next target                         |
| **ghost**           | show / hide the ghost (with a shared dot: both inputs, as rings)        |
| **auto**            | the ghost moves on its own                                              |

A round lasts 3 minutes; at its end the overlay shows the result (team score
and ranking in coop, winner in comp). Tap it for the next round; after the
third round a tap starts a new session. Switching back to **trial** during a
round aborts it (not recorded), as stopping a round by hand did in XC-R.

The score works as in XC-R (see its README): about ten times a second each
player's smoothed descriptors are compared with their configuration of the
target; in coop both have to match together for `matchHold` seconds (10
points shared), in comp the first to hold a match wins the 10 points; a
target nobody reaches is skipped after 45 s.

## URL parameters

| parameter                      | effect                                                        |
| ------------------------------ | ------------------------------------------------------------- |
| `?nomotion`                    | no motion sensors: drag on the pad                            |
| `?debug`                       | console logs and the devicemotion read-out                    |
| `?control=own`, `?goal=comp\|free`, `?mapping=same` | initial condition                        |
| `?scoring=sharpness`           | v1's rule: points accrue with sharpness, no targets           |
| `?round=60`                    | round length in seconds (180)                                 |
| `?tolerance=0.15`, `?hold=1`, `?timeout=45`, `?points=10` | `matchTolerance`, `matchHold`, `targetTimeout`, `targetPoints` |
| `?ghost`, `?auto`              | start with the ghost shown / moving                           |
| `?calibrate` (`?calibrate=6`)  | calibrate the patch on this phone (see below)                 |
| `?targets=default`             | ignore a calibration kept in this browser                     |

## How it maps to XC-R

| XC-R (networked)                                  | XC-R static                                        |
| ------------------------------------------------- | -------------------------------------------------- |
| the second player's phone                         | the ghost (sound from the calibration grid)        |
| server `updateDots()` (shared midpoint)           | the same, between you and the ghost                |
| server `evaluateTarget()`, points, rounds         | the same, in the page                              |
| controller switches                               | buttons at the bottom, URL parameters              |
| `data/leaderboard.json`                           | `localStorage` of this browser (`xcr.leaderboard()`) |
| `logs/` (logger plugin)                           | in memory: `xcr.downloadLogs()` saves both as JSON lines |
| calibration saved by the server (`CALIBRATE=1`)   | kept in this browser and downloaded as `targets.json` |
| `@ircam/devicemotion`, platform-init screen       | `devicemotion` event, enter screen                 |

## Calibrating

Open the page with `?calibrate` on the phone of the study, press **>>>** and
leave it: it sweeps a 5×5 grid twice (about 5 minutes) as XC-R's player does.
The result becomes the target database of this browser (used from then on,
also for the ghost's sound) and is downloaded as `targets.json`; copy it to
`assets/targets.json` to ship it. `xcr.clearCalibration()` in the console
goes back to the shipped file.

## Layout

```
index.html                    entry point
js/app.js                     player + the server's logic + the ghost (ES module, no build step)
js/lib/                       XC-R's libraries, unchanged: preset-space, descriptors,
                              sound-analysis, radar, score-order
js/vendor/lit-html.js         lit-html 3.3.3 (BSD-3-Clause, see lit-html.LICENSE)
style/app.scss → app.css      styles (app.css is committed, compiled from app.scss)
assets/rnbo_export/           RNBO export of the device (patch.export.json)
assets/rnbo/<version>/        rnbo.js matching the export (1.4.2)
assets/essentia/              Essentia.js (WASM), for the sound analysis
assets/BH1-presets.txt        the presets of the preset space
assets/targets.json           the target database (calibration of the patch)
assets/fonts/                 Roboto Condensed, self-hosted
tools/sync-from-xcr.sh        pull all of the above from an XC_R checkout
```

## Updating from XC-R

After re-exporting the patch, editing the presets or calibrating in XC-R:

```bash
tools/sync-from-xcr.sh ../XC_R
```

## Running locally

Any static server works — the page uses ES modules, WASM and `fetch`, so it
can't be opened as a `file://` URL:

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000/?nomotion` on a desktop. Motion sensors need
https on phones (GitHub Pages provides it). From the browser console,
`xcr.global`, `xcr.me` and `xcr.ghost` show the live state, and
`xcr.set({ goal: 'comp' })` changes it.
