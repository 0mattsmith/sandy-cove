# Sandy Cove

A cosy farming/life-sim in the spirit of the genre, built from scratch on the
HTML5 Canvas. You live at **Harvest Hollow** and are searching for the rumoured
**Sandy Cove** — a place that hides from those who simply look for it.

**Play it:** just open `index.html` in any browser. No build step, no installs —
everything (code + art) is bundled into that one file.

## Features so far
- Farming: till, plant, water, multi-day crop growth, harvest
- Day/night cycle with a clock, energy + health, sleep to advance the day
- Inventory + tools (hoe, watering can, axe, pickaxe, scythe, sword, fishing rod)
- Chest storage, a shop (buy seeds) and a shipping bin (sell produce)
- Animals (cow + chickens) and basic slime combat
- Rivers and ponds with **different fish**, a **waterfall** and a hidden grotto behind it
- Bridges and shallow cobble fords across the river
- Elevation: raised plateaus you walk around (Animal-Crossing style)
- Auto-connecting fences, textured grass/dirt, touch controls for mobile
- Auto-saves to your browser

## Controls
- **Move:** WASD / arrow keys, or drag the on-screen joystick on touch devices
- **Use tool / interact:** Space, E, click, or the on-screen **Use** button
- **Select tool:** number keys 1–0
- **Buy seeds:** B (near the SHOP sign)
- **Sleep:** use the BED · **Ship goods:** use the SHIP bin
- **Pause:** Esc

## Project layout
- `index.html` / `Harvest_Hollow.html` — the built, self-contained game (identical)
- `engine.js` — the game engine (logic + rendering)
- `build.py` — bundles the Cute Fantasy PNGs (base64) + `engine.js` into the HTML
- `test_logic.js` — headless logic/render tests (`node test_logic.js`)
- `assets_raw/` — the Cute Fantasy (Free) asset pack

## Rebuilding
```bash
python3 build.py        # regenerates index.html + Harvest_Hollow.html
node test_logic.js      # runs the test suite
```

## Credits
Art: **Cute Fantasy (Free)** asset pack (used under its free, non-commercial
license — not redistributed for resale). Game code is original.
