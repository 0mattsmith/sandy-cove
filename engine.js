/* =========================================================================
   HARVEST HOLLOW  —  a Stardew-style farming sim
   Built on the Cute Fantasy (Free) asset pack.
   Single-file HTML5 Canvas engine. Vanilla JS, no dependencies.

   Design note: game LOGIC lives in plain data tables + pure-ish functions
   (CROPS, advanceDay, useTool, etc.) so it ports cleanly to Godot/GDScript.
   Only the RENDER + INPUT layers are canvas-specific.
   ========================================================================= */

(() => {
'use strict';

// ----------------------------------------------------------------- CONSTANTS
const TILE = 16;            // source pixel size of one tile
const SCALE = 4;            // on-screen zoom (higher = tighter FOV, less visible area)
const TS = TILE * SCALE;    // 64px on screen
const MAP_W = 44, MAP_H = 34;

// Player sprite sheet: 32x32 frames, 6 cols. Walk rows: down=0, up=2, side=4.
const PF = 32;              // player frame size (source)
const PDRAW = PF * SCALE;   // 96 on screen
const WALK = { down: 3, up: 5, side: 4 };   // walk cycles (legs move)
const IDLE = { down: 0, up: 2, side: 4 };   // idle poses (used when standing still)

// Fence autotiling: pick the source cell (col,row in the 4x4 Fences.png) from the
// bitmask of connected neighbours  N=1, E=2, S=4, W=8.
const FENCE_TILES = {
  0:  [0, 3], // isolated post
  1:  [0, 2], // N        (cap, opens up)
  2:  [1, 0], // E        (cap, opens right)
  3:  [1, 3], // N+E      corner
  4:  [0, 0], // S        (cap, opens down)
  5:  [0, 1], // N+S      vertical
  6:  [1, 1], // E+S      corner
  7:  [1, 2], // N+E+S    T
  8:  [3, 0], // W        (cap, opens left)
  9:  [3, 3], // N+W      corner
  10: [2, 0], // E+W      horizontal
  11: [2, 3], // N+E+W    T
  12: [3, 1], // S+W      corner
  13: [3, 2], // N+S+W    T
  14: [2, 1], // E+S+W    T
  15: [2, 2], // N+E+S+W  cross
};

// In-game time: minutes advance continuously. 1 game-minute every MIN_MS ms.
const MIN_MS = 600;         // ~ a full 6:00->26:00 day in ~12 real minutes
const DAY_START = 360;      // 6:00 AM in minutes
const DAY_END   = 26 * 60;  // 2:00 AM next day -> forced sleep

// Crop catalogue. days = growth time; sprite drawn procedurally per stage.
const CROPS = {
  parsnip: { name: 'Parsnip', stages: 4, days: 4, sell: 35, seed: 20, color: '#e8d36b', leaf: '#5aa84b' },
  potato:  { name: 'Potato',  stages: 4, days: 6, sell: 80, seed: 50, color: '#c98a4b', leaf: '#3f8f3a' },
  carrot:  { name: 'Carrot',  stages: 4, days: 3, sell: 35, seed: 25, color: '#e8742b', leaf: '#4faa42' },
  pumpkin: { name: 'Pumpkin', stages: 5, days: 9, sell: 320, seed: 100, color: '#e07b1a', leaf: '#3f8f3a' },
};

// Home upgrade ladder. `cost` is what it takes to upgrade INTO that tier.
// Currencies: coins (standard), pearls (mid, from fishing), emeralds (rare, from mining).
const HOME_TIERS = [
  { name: 'Basic Shelter', w: 2, h: 2, cost: null },
  { name: 'Small Tent',    w: 2, h: 2, cost: { coins: 300,   wood: 20 } },
  { name: 'Large Tent',    w: 3, h: 3, cost: { coins: 800,   wood: 50,  pearls: 2 } },
  { name: 'Small Home',    w: 4, h: 4, cost: { coins: 2000,  wood: 120, stone: 50,  pearls: 6 } },
  { name: 'Town Home',     w: 6, h: 8, cost: { coins: 6000,  wood: 300, stone: 150, pearls: 15, emeralds: 2 } },
  { name: 'Ranch',         w: 8, h: 8, cost: { coins: 15000, wood: 600, stone: 400, pearls: 40, emeralds: 10 } },
];

const SAPLING_DAYS = 4;   // days for a planted sapling to grow into a choppable tree

// Farm level (separate from the player) — rises as you ship goods, harvest and fish.
// A higher farm draws better workers to the town job board.
const FARM_XP_THRESHOLDS = [0, 400, 1200, 3000, 6500, 13000, 24000, 42000];
const ROLE_INFO = {
  farmer:  { name: 'Farmer',  desc: 'Waters your crops each morning' },
  rancher: { name: 'Rancher', desc: 'Gathers milk & eggs each morning' },
};
// hireable candidates posted by the local towns; better tiers unlock at higher farm levels.
// `cap` is the max level a worker can be trained to before you must replace them — and the
// replacement tier costs a rarer currency: Coins -> Pearls -> Emeralds.
const HIRE_POOL = [
  { role: 'farmer',  tier: 'Farmhand',       cap: 3,  cur: 'coins',    hire: 300, upBase: 150, minFarmLv: 2 },
  { role: 'rancher', tier: 'Ranch Hand',     cap: 3,  cur: 'coins',    hire: 300, upBase: 150, minFarmLv: 2 },
  { role: 'farmer',  tier: 'Skilled Farmer', cap: 6,  cur: 'pearls',   hire: 10,  upBase: 400, minFarmLv: 4 },
  { role: 'rancher', tier: 'Stockkeeper',    cap: 6,  cur: 'pearls',   hire: 10,  upBase: 400, minFarmLv: 4 },
  { role: 'farmer',  tier: 'Master Farmer',  cap: 10, cur: 'emeralds', hire: 6,   upBase: 900, minFarmLv: 6 },
  { role: 'rancher', tier: 'Master Rancher', cap: 10, cur: 'emeralds', hire: 6,   upBase: 900, minFarmLv: 6 },
];
const CUR_NAME = { coins: 'Coins', pearls: 'Pearls', emeralds: 'Emeralds' };
function currencyAmount(cur) { return cur === 'pearls' ? game.pearls : cur === 'emeralds' ? game.emeralds : game.gold; }
function spendCurrency(cur, n) { if (cur === 'pearls') game.pearls -= n; else if (cur === 'emeralds') game.emeralds -= n; else game.gold -= n; }
function farmLevel() {
  let lv = 1;
  for (let i = 1; i < FARM_XP_THRESHOLDS.length; i++) if (game.farmXP >= FARM_XP_THRESHOLDS[i]) lv = i + 1;
  return lv;
}

// Game modes: Explorer is a relaxed mode (faster, cheaper, more loot); Adventurer is normal.
function isExplorer() { return game.mode === 'explorer'; }
function modeSpeed() { return isExplorer() ? 1.4 : 1; }
function priceMult() { return isExplorer() ? 0.6 : 1; }                 // coin/currency costs
function modePrice(n) { return Math.max(1, Math.round(n * priceMult())); }
function lootMult() { return isExplorer() ? 2 : 1; }

// Mail-order catalogue (no shop on the ranch — the big shops are in the towns).
// Orders arrive by post the next Wednesday; the postman leaves a parcel by the tent.
const CATALOGUE = [
  { key: 'parsnip', name: 'Parsnip Seeds', price: CROPS.parsnip.seed },
  { key: 'carrot',  name: 'Carrot Seeds',  price: CROPS.carrot.seed },
  { key: 'potato',  name: 'Potato Seeds',  price: CROPS.potato.seed },
  { key: 'pumpkin', name: 'Pumpkin Seeds', price: CROPS.pumpkin.seed },
];
const POST_DOW = 2;   // Wednesday (Mon=0) in WEEKDAYS
function isPostDay(day) { return ((day - 1) % 7) === POST_DOW; }
function daysUntilPost() { let d = 1; while (!isPostDay(game.day + d)) d++; return d; }

// Crafting. Recipes cost materials + a coin LABOUR FEE paid to a crafter — until the
// player has learned that skill themselves (by crafting), after which it's materials-only.
const LEARN_THRESHOLD = 3;          // crafts in an area before you've "earned the skill"
const TOOL_MAX = 3;
const CRAFT_RECIPES = [
  { id: 'shed',    name: 'Build Tool Shed', area: 'carpentry',    mats: { wood: 40, stone: 12 }, fee: 220, once: true },
  { id: 'kitchen', name: 'Build Kitchen',   area: 'carpentry',    mats: { wood: 55, stone: 20 }, fee: 300, once: true },
  { id: 'axe',     name: 'Upgrade Axe',     area: 'toolsmithing', mats: { wood: 20, stone: 15 }, fee: 200, needsShed: true, tool: 'axe' },
  { id: 'pickaxe', name: 'Upgrade Pickaxe', area: 'toolsmithing', mats: { wood: 15, stone: 25 }, fee: 200, needsShed: true, tool: 'pickaxe' },
  { id: 'can',     name: 'Upgrade Watering Can', area: 'toolsmithing', mats: { wood: 10, stone: 10 }, fee: 150, needsShed: true, tool: 'wateringcan' },
];
function skillLearned(area) { return (game.skills[area] || 0) >= LEARN_THRESHOLD; }
function recipeFee(r) { return skillLearned(r.area) ? 0 : modePrice(r.fee); }
function recipeAvailable(r) {
  if (r.id === 'shed' && game.shedBuilt) return false;
  if (r.id === 'kitchen' && game.kitchenBuilt) return false;
  if (r.needsShed && !game.shedBuilt) return false;
  if (r.tool && (game.toolLevel[r.tool] || 1) >= TOOL_MAX) return false;
  return true;
}
function canCraft(r) {
  if (!recipeAvailable(r)) return false;
  for (const k in r.mats) if ((game.bag[k] || 0) < r.mats[k]) return false;
  return game.gold >= recipeFee(r);
}

// Fish split by water type — pond fish vs river fish.
const POND_FISH = [
  { name: 'Carp', sell: 30 }, { name: 'Bluegill', sell: 45 },
  { name: 'Pond Loach', sell: 70 }, { name: 'Catfish', sell: 130 },
];
const RIVER_FISH = [
  { name: 'Perch', sell: 40 }, { name: 'Rainbow Trout', sell: 65 },
  { name: 'Smallmouth Bass', sell: 90 }, { name: 'Sturgeon', sell: 210 },
];

// Item catalogue (produce + resources) with sell values.
const SELLABLE = {
  wood: 4, stone: 5, milk: 125, egg: 50, slimeball: 12,
  parsnip: CROPS.parsnip.sell, potato: CROPS.potato.sell,
  carrot: CROPS.carrot.sell, pumpkin: CROPS.pumpkin.sell,
};
[...POND_FISH, ...RIVER_FISH].forEach(f => { SELLABLE[f.name] = f.sell; });

// Artisan goods: process a raw item (in) into a far more valuable product (out) at the Kitchen.
const ARTISAN = [
  { in: 'milk',    out: 'Cheese',           sell: 230 },
  { in: 'egg',     out: 'Mayonnaise',       sell: 95 },
  { in: 'parsnip', out: 'Parsnip Preserve', sell: Math.round(CROPS.parsnip.sell * 2.3) },
  { in: 'carrot',  out: 'Carrot Preserve',  sell: Math.round(CROPS.carrot.sell * 2.3) },
  { in: 'potato',  out: 'Potato Preserve',  sell: Math.round(CROPS.potato.sell * 2.3) },
  { in: 'pumpkin', out: 'Pumpkin Preserve', sell: Math.round(CROPS.pumpkin.sell * 2.3) },
];
ARTISAN.forEach(a => { SELLABLE[a.out] = a.sell; });

// Tools live in the hotbar. seed_* entries are plantable.
const TOOLS = ['hoe', 'wateringcan', 'axe', 'pickaxe', 'scythe', 'sword', 'fishingrod'];
const TOOL_LABEL = {
  hoe: 'Hoe', wateringcan: 'Can', axe: 'Axe', pickaxe: 'Pick',
  scythe: 'Scythe', sword: 'Sword', fishingrod: 'Rod', sapling: 'Sapling',
  seed_parsnip: 'Parsnip Sd', seed_potato: 'Potato Sd',
  seed_carrot: 'Carrot Sd', seed_pumpkin: 'Pumpkin Sd',
};

// ----------------------------------------------------------------- DOM SETUP
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ----------------------------------------------------------------- ASSETS
// ASSET_DATA (name -> dataURI) is injected by the build step above this script.
const IMG = {};
function loadAssets() {
  const names = Object.keys(window.ASSET_DATA);
  let loaded = 0;
  return new Promise((resolve) => {
    names.forEach((n) => {
      const im = new Image();
      im.onload = () => { if (++loaded === names.length) resolve(); };
      im.onerror = () => { if (++loaded === names.length) resolve(); };
      im.src = window.ASSET_DATA[n];
      IMG[n] = im;
    });
  });
}

// ----------------------------------------------------------------- STATE
const game = {
  // player
  px: 22 * TS, py: 18 * TS,   // pixel position (top-left of 32px sprite footprint area)
  dir: 'down', moving: false, facing: 'down',
  animTime: 0, animFrame: 0,
  speed: 150,                  // px / sec
  mode: 'adventurer',          // 'adventurer' (normal) or 'explorer' (faster, cheaper, more loot)
  energy: 100, maxEnergy: 100,
  health: 100, maxHealth: 100,
  gold: 150,                   // Coins (standard currency)
  pearls: 0,                   // mid-tier, from fishing
  emeralds: 0,                 // rare, from mining
  farmXP: 0,                   // grows the farm level (separate from the player)
  employees: [],               // hired NPC workers
  npcId: 0,
  pendingOrders: [],           // catalogue orders awaiting the next post day (Wednesday)
  mail: [],                    // delivered items waiting in the parcel by the tent
  postman: null,               // transient delivery NPC on post day
  skills: { carpentry: 0, toolsmithing: 0 },   // crafting skill XP (learned at LEARN_THRESHOLD)
  toolLevel: { axe: 1, pickaxe: 1, wateringcan: 1, hoe: 1 },
  shedBuilt: false,
  kitchenBuilt: false,
  kitchenMenuOpen: false,
  motes: [],                   // faint drifting ambient particles
  // time
  minutes: DAY_START, day: 1, season: 'Spring',
  minAccum: 0,
  // inventory
  hotbar: ['hoe', 'wateringcan', 'axe', 'pickaxe', 'scythe', 'sword', 'fishingrod', 'seed_parsnip', 'seed_carrot', 'sapling'],
  selected: 0,
  bag: {},                     // item -> count (produce/resources)
  chest: {},                   // stored items
  seeds: { parsnip: 5, carrot: 3, potato: 0, pumpkin: 0 },
  // world
  ground: [],                  // [y][x] -> 'grass'|'water'|'path'|'sand'
  solid: new Set(),            // "x,y" blocked tiles
  tilled: new Set(),           // "x,y"
  watered: new Set(),          // "x,y"
  crops: {},                   // "x,y" -> {type, stage, wateredToday}
  objects: [],                 // trees, rocks, structures
  animals: [],
  enemies: [],
  fenceSet: new Set(),
  cliff: new Set(),            // "x,y" raised, impassable plateau tiles
  plateaus: [],                // {x,y,w,h} for cliff autotiling
  waterType: {},               // "x,y" -> 'pond' | 'river'
  waterfall: [],               // "x,y" tiles drawn as falling water (in front of player)
  bridges: new Set(),          // "x,y" water tiles crossed by a wooden bridge (walkable)
  fords: new Set(),            // "x,y" shallow cobble water the player can wade across
  lilypads: new Set(),         // "x,y" water tiles with a lily pad the player can hop across
  secretFound: false,          // discovered the grotto behind the falls
  homeIntroShown: false,       // greeted at the home for the first time
  // fishing minigame
  fishing: { active: false, state: '', t: 0, biteAt: 0, biteEnd: 0, tx: 0, ty: 0, type: 'pond' },
  // animated world clock (for water/waterfall shimmer)
  anim: 0,
  camX: 0, camY: 0,            // smoothed (eased) camera position
  camInit: false,
  fishLeaps: [],               // transient fish-jump animations over water
  leapTimer: 3,
  critters: [],                // ambient butterflies / bees / flies near the player
  footsteps: [],               // terrain-dependent step puffs
  stepAccum: 0, stepSide: 1,
  explored: new Set(),         // tiles the player has discovered (minimap fog of war)
  // flags
  fading: 0, fadeDir: 0, sleeping: false,
  hitFlash: 0, toolUseTime: 0,
  message: '', messageTime: 0,
  paused: false,
  buildMenuOpen: false,
  hireMenuOpen: false,
  catalogueOpen: false,
  craftMenuOpen: false,
  storeMenuOpen: false,
  pauseMenuOpen: false,
  area: 'ranch',               // current map area
  areas: {},                   // cached world state per area
  travelCooldown: 0,           // prevents immediate re-trigger after travelling
  started: false,              // becomes true once the player clicks Play
};

const keyName = (x, y) => x + ',' + y;
function toast(msg, dur = 2.4) { game.message = msg; game.messageTime = dur; }

// deterministic 0..1 hash per tile (+salt) so texture detail is stable, not flickery
function tileRand(x, y, salt) {
  let n = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// small seeded PRNG so world layout is deterministic
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addPlateau(x, y, w, h) {
  game.plateaus.push({ x, y, w, h });
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) game.cliff.add(keyName(xx, yy));
}
function setWater(x, y, type) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
  game.ground[y][x] = 'water';
  game.waterType[keyName(x, y)] = type;
}
// which Cliff_Tile cell (3x3 blob autotile) to draw for a plateau tile
function cliffCell(x, y) {
  for (const r of game.plateaus) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) {
      const col = (x === r.x) ? 0 : (x === r.x + r.w - 1) ? 2 : 1;
      const row = (y === r.y) ? 0 : (y === r.y + r.h - 1) ? 2 : 1;
      return [col, row];
    }
  }
  return [1, 1];
}

// ----------------------------------------------------------------- WORLD GEN
function genWorld() {
  // ground: grass everywhere
  for (let y = 0; y < MAP_H; y++) {
    game.ground[y] = [];
    for (let x = 0; x < MAP_W; x++) game.ground[y][x] = 'grass';
  }

  // --- elevation: a couple of impassable plateaus the player must walk around
  addPlateau(23, 3, 5, 4);     // north hill
  addPlateau(2, 16, 3, 4);     // west bluff

  // --- waterfall + hidden grotto at the river's source (top-right) ---
  // cliff walls enclosing a 2-wide corridor at x=37,38 (open only at the south)
  addPlateau(35, 0, 2, 5);     // west wall of the falls
  addPlateau(39, 0, 2, 5);     // east wall of the falls
  addPlateau(37, 0, 2, 1);     // top cap above the corridor
  // corridor tiles (walkable). y1 grotto, y2 behind the falling water, y3 wet ledge
  game.waterfall = [keyName(37, 2), keyName(38, 2)];
  game.ground[3][37] = 'path'; game.ground[3][38] = 'path';   // foamy stone ledge
  // the river: pours from the falls straight down into the pond
  for (let y = 5; y < 24; y++) setWater(38, y, 'river');
  for (let y = 8; y < 24; y++) setWater(37, y, 'river');       // widens lower down
  // a wooden bridge across the river (walkable), and a shallow cobble ford lower down
  game.bridges.add(keyName(37, 13)); game.bridges.add(keyName(38, 13));
  game.fords.add(keyName(37, 19)); game.fords.add(keyName(38, 19));
  game.fords.add(keyName(37, 20)); game.fords.add(keyName(38, 20));

  // --- pond (bottom-right) for pond fish ---
  for (let y = 24; y < 30; y++)
    for (let x = 32; x < 40; x++) setWater(x, y, 'pond');
  // lily pads forming a hop-across crossing of the pond + a few scattered pads
  [[32, 26], [33, 26], [34, 27], [35, 27], [36, 26], [37, 26], [38, 26],
   [34, 25], [37, 28], [33, 28]].forEach(([x, y]) => game.lilypads.add(keyName(x, y)));
  // reeds/cattails on the land around the pond edge, and a frog basking on a pad
  [[31, 25], [31, 27], [40, 25], [40, 28], [33, 23], [36, 23], [34, 30], [37, 30]]
    .forEach(([x, y]) => { if (game.ground[y] && game.ground[y][x] === 'grass') addObject('reed', x, y, {}); });
  addObject('frog', 34, 25, {});

  // dirt paths from the homestead
  for (let y = 8; y < 24; y++) if (game.ground[y][20] === 'grass') game.ground[y][20] = 'path';
  for (let x = 8; x < 21; x++) if (game.ground[10][x] === 'grass') game.ground[10][x] = 'path';

  // helper: a tile that should stay clear of trees/rocks
  const reserved = (x, y) =>
    game.cliff.has(keyName(x, y)) || game.ground[y][x] !== 'grass' ||
    (x >= 35 && y < 6) || (x >= 37 && x <= 39);   // falls area + river banks

  // border trees (forest frame) + forest on the right
  const rnd = mulberry32(1337);
  const treeSpots = [];
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      const edge = (x < 2 || x > MAP_W - 3 || y < 2 || y > MAP_H - 3);
      const forest = (x > 28 && x < 35 && y < 20);
      if ((edge || forest) && rnd() < 0.5 && !reserved(x, y) && !occupied(x, y))
        treeSpots.push([x, y]);
    }
  }
  treeSpots.forEach(([x, y]) => addObject('tree', x, y, { hp: 4 }));

  // scattered rocks
  for (let i = 0; i < 14; i++) {
    const x = 22 + Math.floor(rnd() * 12), y = 18 + Math.floor(rnd() * 10);
    if (!reserved(x, y) && !occupied(x, y)) addObject('rock', x, y, { hp: 3 });
  }

  // homestead beside the path: your upgradeable home (a Basic Shelter to start),
  // with its own usable bed + chest. A short branch path leads up from the main path.
  const home = { type: 'home', x: 12, y: 12, tier: 0 };
  setHomeFixtures(home);
  game.objects.push(home);
  for (let x = 15; x < 20; x++) if (game.ground[13][x] === 'grass') game.ground[13][x] = 'path';
  addObject('sign', 15, 11, { text: 'Harvest Hollow' });
  addObject('bin', 23, 14, {});
  addObject('jobboard', 27, 14, {});   // hire workers here once your farm grows
  addObject('workbench', 10, 14, {});  // craft here (build a shed to unlock tool upgrades)
  // river-bank plants (reeds along the water's edge — no lily pads on flowing water)
  [[36, 9], [36, 13], [36, 17], [36, 21], [39, 8], [39, 12], [39, 16], [39, 20]]
    .forEach(([x, y]) => { if (game.ground[y] && game.ground[y][x] === 'grass' && !occupied(x, y)) addObject('reed', x, y, {}); });

  // roads leading out of Harvest Hollow — some signed to far-off places, some unknown.
  // (They run to the map edge for now; where they truly lead is for later chapters.)
  const road = [];
  for (let y = 24; y < MAP_H; y++) road.push([20, y]);   // south road -> the coast
  for (let x = 0; x < 8; x++) road.push([x, 10]);        // west road  -> a village
  for (let y = 0; y < 8; y++) road.push([20, y]);        // north trail -> the forest (unknown)
  road.forEach(([x, y]) => {
    if (game.ground[y] && game.ground[y][x] === 'grass' && !game.cliff.has(keyName(x, y)))
      game.ground[y][x] = 'path';
    game.objects = game.objects.filter(o => !((o.type === 'tree' || o.type === 'rock') && o.x === x && o.y === y));
  });
  addObject('signpost', 22, 26, { text: 'Tidewater Coast', known: true });
  addObject('signpost', 6, 8,   { text: 'Mossy Village', known: true });
  addObject('signpost', 22, 6,  { text: 'The Old Forest', known: false });

  // the mystery: an old carved relic in the grotto behind the waterfall
  addObject('relic', 38, 1, {});

  // animal pen (fenced) lower-left, with a cow + chickens
  buildPen(6, 22, 7, 6);
  game.animals.push(makeAnimal('cow', 8, 24));
  game.animals.push(makeAnimal('chicken', 10, 25));
  game.animals.push(makeAnimal('chicken', 9, 26));

  // a few slimes in the forest
  game.enemies.push(makeSlime(31, 6));
  game.enemies.push(makeSlime(33, 9));
  game.enemies.push(makeSlime(30, 4));

  rebuildSolids();
}

// ----------------------------------------------------------------- AREAS / TRAVEL
// the per-area world fields (kept the same map size so the rest of the engine is unchanged)
function snapshotArea() {
  return {
    ground: game.ground, objects: game.objects, tilled: game.tilled, watered: game.watered,
    crops: game.crops, animals: game.animals, enemies: game.enemies, cliff: game.cliff,
    plateaus: game.plateaus, waterType: game.waterType, waterfall: game.waterfall,
    bridges: game.bridges, fords: game.fords, lilypads: game.lilypads, explored: game.explored,
  };
}
function initAreaFields() {
  game.ground = []; game.objects = []; game.tilled = new Set(); game.watered = new Set();
  game.crops = {}; game.animals = []; game.enemies = []; game.cliff = new Set(); game.plateaus = [];
  game.waterType = {}; game.waterfall = []; game.bridges = new Set(); game.fords = new Set();
  game.lilypads = new Set(); game.explored = new Set();
}
function travelTo(area, sx, sy) {
  game.areas[game.area] = snapshotArea();
  game.area = area;
  if (game.areas[area]) Object.assign(game, game.areas[area]);
  else { initAreaFields(); if (area === 'village') genVillage(); else genWorld(); }
  game.px = sx * TS; game.py = sy * TS;
  game.camInit = false; game.travelCooldown = 0.7;
  rebuildSolids();
  toast(area === 'village' ? 'Mossy Village' : 'Harvest Hollow', 3);
}
// edge transitions: ranch west road <-> village east road
function checkTravel(dt) {
  if (game.travelCooldown > 0) { game.travelCooldown -= dt; return; }
  const pcx = Math.floor((game.px + TS / 2) / TS), pcy = Math.floor((game.py + TS / 2) / TS);
  if (game.area === 'ranch' && pcx <= 0 && pcy >= 9 && pcy <= 11) travelTo('village', MAP_W - 2, 17);
  else if (game.area === 'village' && pcx >= MAP_W - 1 && pcy >= 16 && pcy <= 18) travelTo('ranch', 1, 10);
}

// the first town — reached along the west road, signposted "Mossy Village"
function genVillage() {
  for (let y = 0; y < MAP_H; y++) { game.ground[y] = []; for (let x = 0; x < MAP_W; x++) game.ground[y][x] = 'grass'; }
  // main road across (east entrance from the ranch) with a spur up to the store
  for (let x = 6; x < MAP_W; x++) game.ground[17][x] = 'path';
  for (let y = 12; y < 18; y++) game.ground[y][17] = 'path';
  // buildings
  addObject('store', 16, 9, {});                    // 3x3 general store, spur leads to it
  addObject('house', 5, 6, { w: 6, h: 8 });
  addObject('house', 31, 6, { w: 6, h: 8 });
  addObject('house', 33, 20, { w: 6, h: 8 });
  addObject('sign', MAP_W - 4, 16, { text: 'Mossy Village' });
  // villagers (stationary for now — greet on interaction)
  addObject('villager', 14, 18, { name: 'Mara', col: '#c66a9a' });
  addObject('villager', 20, 16, { name: 'Tomas', col: '#6a8ac6' });
  addObject('villager', 24, 19, { name: 'Elsie', col: '#c6a86a' });
  // a little greenery + a pond
  const rnd = mulberry32(7);
  for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
    const edge = (x < 2 || x > MAP_W - 3 || y < 2 || y > MAP_H - 3);
    if (edge && rnd() < 0.45 && game.ground[y][x] === 'grass' && !occupied(x, y)) addObject('tree', x, y, { hp: 4 });
  }
  for (let y = 26; y < 31; y++) for (let x = 6; x < 12; x++) setWater(x, y, 'pond');
  [[7, 28], [9, 27], [10, 29]].forEach(([x, y]) => game.lilypads.add(keyName(x, y)));
  rebuildSolids();
}

function buildPen(ox, oy, w, h) {
  for (let x = ox; x < ox + w; x++) {
    addObject('fence', x, oy, {});
    addObject('fence', x, oy + h - 1, {});
  }
  for (let y = oy; y < oy + h; y++) {
    addObject('fence', ox, y, {});
    addObject('fence', ox + w - 1, y, {});
  }
  // gate gap
  removeObjectAt(ox + Math.floor(w / 2), oy + h - 1);
}

function addObject(type, x, y, extra) {
  game.objects.push(Object.assign({ type, x, y }, extra || {}));
}
function removeObjectAt(x, y) {
  game.objects = game.objects.filter(o => !(o.x === x && o.y === y && o.type === 'fence'));
}
function occupied(x, y) {
  return game.objects.some(o => o.x === x && o.y === y);
}

// place the home's usable bed + chest, and decide whether the structure blocks movement.
// Open tiers (shelter/tents) are walkable with fixtures inside; solid tiers (homes) put
// the bed + chest on a walkable porch in front so they stay reachable.
function setHomeFixtures(h) {
  const t = HOME_TIERS[h.tier];
  // the catalogue sits just in front of the home (order essentials by post here)
  h.catalogue = { x: h.x + Math.floor(t.w / 2), y: h.y + t.h };
  if (h.tier <= 2) {
    const fy = h.y + t.h - 1;            // front row
    h.bed = { x: h.x, y: fy };
    h.chest = { x: h.x + t.w - 1, y: fy };
    h.solidFootprint = false;
  } else {
    const py = h.y + t.h;                // porch row, just below the building
    h.bed = { x: h.x, y: py };
    h.chest = { x: h.x + t.w - 1, y: py };
    h.solidFootprint = true;
  }
}

function rebuildSolids() {
  game.solid = new Set();
  game.fenceSet = new Set();
  // water is solid, unless it's a bridge or a shallow ford you can walk across
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      const k = keyName(x, y);
      if (game.ground[y][x] === 'water' && !game.bridges.has(k) && !game.fords.has(k) && !game.lilypads.has(k))
        game.solid.add(k);
    }
  // raised plateaus are impassable
  game.cliff.forEach(k => game.solid.add(k));
  // objects
  game.objects.forEach(o => {
    if (o.type === 'house') {
      for (let yy = 0; yy < o.h; yy++)
        for (let xx = 0; xx < o.w; xx++) game.solid.add(keyName(o.x + xx, o.y + yy));
    } else if (o.type === 'home') {
      // open shelter/tents are walkable; only solid building tiers block movement
      if (o.solidFootprint) {
        const t = HOME_TIERS[o.tier];
        for (let yy = 0; yy < t.h; yy++)
          for (let xx = 0; xx < t.w; xx++) game.solid.add(keyName(o.x + xx, o.y + yy));
      }
    } else if (o.type === 'shed' || o.type === 'store') {
      const fw = o.type === 'store' ? 3 : 2, fh = o.type === 'store' ? 3 : 2;
      for (let yy = 0; yy < fh; yy++) for (let xx = 0; xx < fw; xx++) game.solid.add(keyName(o.x + xx, o.y + yy));
    } else if (o.type === 'tree' || o.type === 'rock' || o.type === 'fence' ||
               o.type === 'chest' || o.type === 'bin' || o.type === 'jobboard' || o.type === 'workbench' || o.type === 'kitchen') {
      game.solid.add(keyName(o.x, o.y));
      if (o.type === 'fence') game.fenceSet.add(keyName(o.x, o.y));
    }
  });
}

// which Fences.png cell to draw at (x,y) given connected fence neighbours
function fenceMask(x, y) {
  const f = game.fenceSet;
  let m = 0;
  if (f.has(keyName(x, y - 1))) m |= 1; // N
  if (f.has(keyName(x + 1, y))) m |= 2; // E
  if (f.has(keyName(x, y + 1))) m |= 4; // S
  if (f.has(keyName(x - 1, y))) m |= 8; // W
  return m;
}

// ----------------------------------------------------------------- ENTITIES
function makeAnimal(kind, x, y) {
  return { kind, x: x * TS, y: y * TS, dir: 1, t: Math.random() * 2,
           vx: 0, vy: 0, produce: true, frame: 0, animTime: 0 };
}
function makeSlime(x, y) {
  return { kind: 'slime', x: x * TS, y: y * TS, hp: 30, maxHp: 30,
           t: Math.random() * 2, vx: 0, vy: 0, hurt: 0, frame: 0, animTime: 0 };
}

// ----------------------------------------------------------------- INPUT
const keys = {};
let mouse = { x: 0, y: 0, down: false };

window.addEventListener('keydown', (e) => {
  // a modal menu is open: only Escape closes it
  if (game.buildMenuOpen) { if (e.key === 'Escape') closeBuildMenu(); return; }
  if (game.hireMenuOpen) { if (e.key === 'Escape') closeHireMenu(); return; }
  if (game.catalogueOpen) { if (e.key === 'Escape') closeCatalogue(); return; }
  if (game.craftMenuOpen) { if (e.key === 'Escape') closeCraftMenu(); return; }
  if (game.kitchenMenuOpen) { if (e.key === 'Escape') closeKitchenMenu(); return; }
  if (game.storeMenuOpen) { if (e.key === 'Escape') closeStoreMenu(); return; }
  if (game.paused && e.key !== 'Escape') return;
  keys[e.key.toLowerCase()] = true;
  // hotbar select (1-9 and 0 for slot 10)
  if (e.key >= '1' && e.key <= '9') game.selected = parseInt(e.key, 10) - 1;
  if (e.key === '0') game.selected = 9;
  if (e.key === ' ') { e.preventDefault(); doAction(); }
  if (e.key.toLowerCase() === 'e') doAction();       // interact
  if (e.key.toLowerCase() === 'b') tryBuy();          // buy seeds near shop
  if (e.key.toLowerCase() === 'm') document.body.classList.toggle('hidemap'); // toggle minimap
  if (e.key === 'Escape') togglePauseMenu();
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))
    e.preventDefault();
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

canvas.addEventListener('mousemove', (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (canvas.width / r.width);
  mouse.y = (e.clientY - r.top) * (canvas.height / r.height);
});
canvas.addEventListener('mousedown', () => { if (!game.paused) doAction(); });

// ---- touch controls: a floating "push toward direction" joystick + action button
game.touch = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
function canvasPos(t) {
  const r = canvas.getBoundingClientRect();
  return { x: (t.clientX - r.left) * (canvas.width / r.width),
           y: (t.clientY - r.top) * (canvas.height / r.height) };
}
canvas.addEventListener('touchstart', (e) => {
  document.body.classList.add('touch');
  if (game.paused) return;
  const t = e.changedTouches[0]; const p = canvasPos(t);
  game.touch.active = true; game.touch.id = t.identifier;
  game.touch.ox = p.x; game.touch.oy = p.y; game.touch.x = p.x; game.touch.y = p.y;
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === game.touch.id) { const p = canvasPos(t); game.touch.x = p.x; game.touch.y = p.y; }
  }
  e.preventDefault();
}, { passive: false });
function endTouch(e) {
  for (const t of e.changedTouches)
    if (t.identifier === game.touch.id) { game.touch.active = false; game.touch.id = null; }
}
canvas.addEventListener('touchend', endTouch);
canvas.addEventListener('touchcancel', endTouch);

// on-screen buttons (shown only once a touch is detected, via body.touch CSS)
function bindButton(id, fn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('touchstart', (ev) => { ev.preventDefault(); document.body.classList.add('touch'); fn(); }, { passive: false });
  el.addEventListener('click', fn);
}
bindButton('btnA', () => { if (!game.paused) doAction(); });
bindButton('btnB', () => { if (!game.paused) tryBuy(); });

// ----------------------------------------------------------------- HELPERS
// the tile directly in front of the player (where tools act)
function facingTile() {
  const cx = Math.floor((game.px + PF * SCALE / 2 * 0 + TS / 2) / TS); // player center tile
  const pcx = Math.floor((game.px + TS / 2) / TS);
  const pcy = Math.floor((game.py + TS / 2) / TS);
  let tx = pcx, ty = pcy;
  if (game.facing === 'up') ty -= 1;
  else if (game.facing === 'down') ty += 1;
  else if (game.facing === 'left') tx -= 1;
  else if (game.facing === 'right') tx += 1;
  return { tx, ty };
}

function selectedItem() { return game.hotbar[game.selected]; }

function addBag(item, n = 1) { game.bag[item] = (game.bag[item] || 0) + n; }

// ----------------------------------------------------------------- ACTIONS
function doAction() {
  const item = selectedItem();
  const { tx, ty } = facingTile();
  game.toolUseTime = 0.25;

  // fishing minigame takes priority while a line is in the water
  if (game.fishing.active) {
    if (game.fishing.state === 'bite') catchFish();
    else toast('Wait for a bite...');
    return;
  }

  // interact with adjacent special objects first (bed/chest/bin/shop/animals)
  if (tryInteract(tx, ty)) return;

  if (game.energy <= 0 && item && TOOLS.includes(item)) {
    toast('Too exhausted. Sleep to recover.');
    return;
  }

  if (!item) return;

  if (item === 'fishingrod') {
    startFishing(tx, ty);
  } else if (item === 'sapling') {
    plantSapling(tx, ty);
  } else if (item === 'hoe') {
    if (canTill(tx, ty)) { game.tilled.add(keyName(tx, ty)); spendEnergy(2); }
  } else if (item === 'wateringcan') {
    const r = (game.toolLevel.wateringcan || 1) - 1;   // upgraded can waters a wider area
    let did = false;
    for (let yy = ty - r; yy <= ty + r; yy++)
      for (let xx = tx - r; xx <= tx + r; xx++) {
        const wk = keyName(xx, yy);
        if (game.tilled.has(wk)) {
          game.watered.add(wk);
          if (game.crops[wk]) game.crops[wk].wateredToday = true;
          did = true;
        }
      }
    if (did) spendEnergy(2);
  } else if (item.startsWith('seed_')) {
    plantSeed(item.slice(5), tx, ty);
  } else if (item === 'axe') {
    hitObject('tree', tx, ty, 'wood', 2);
  } else if (item === 'pickaxe') {
    hitObject('rock', tx, ty, 'stone', 2);
  } else if (item === 'scythe') {
    harvestOrCut(tx, ty);
  } else if (item === 'sword') {
    swingSword();
  }
}

function canTill(tx, ty) {
  const g = game.ground[ty] && game.ground[ty][tx];
  return g === 'grass' && !game.solid.has(keyName(tx, ty)) &&
         !game.tilled.has(keyName(tx, ty)) && !occupied(tx, ty);
}

function plantSeed(type, tx, ty) {
  const k = keyName(tx, ty);
  if (!game.tilled.has(k) || game.crops[k]) { toast('Need tilled, empty soil.'); return; }
  if ((game.seeds[type] || 0) <= 0) { toast('No ' + type + ' seeds.'); return; }
  game.seeds[type]--;
  game.crops[k] = { type, stage: 0, growth: 0, wateredToday: game.watered.has(k) };
  spendEnergy(1);
}

function plantSapling(tx, ty) {
  if ((game.bag.sapling || 0) <= 0) { toast('No saplings. Chop trees to find some.'); return; }
  const k = keyName(tx, ty);
  const g = game.ground[ty] && game.ground[ty][tx];
  if (g !== 'grass' || game.solid.has(k) || game.tilled.has(k) || game.crops[k] || occupied(tx, ty)) {
    toast('Plant a sapling on open grass.'); return;
  }
  game.bag.sapling -= 1;
  addObject('sapling', tx, ty, { growth: 0 });
  spendEnergy(1);
  toast('Sapling planted — it will grow over a few days.');
}

// ---- fishing ----
function startFishing(tx, ty) {
  const type = game.waterType[keyName(tx, ty)];   // 'pond' | 'river' | undefined
  if (!type) { toast('Face a pond or river to fish.'); return; }
  if (game.energy <= 0) { toast('Too exhausted to fish.'); return; }
  game.fishing = { active: true, state: 'cast', t: 0,
                   biteAt: 1.2 + Math.random() * 2.6, biteEnd: 0, tx, ty, type };
  spendEnergy(1);
  toast('You cast your line into the ' + type + '...');
}
function catchFish() {
  const list = game.fishing.type === 'river' ? RIVER_FISH : POND_FISH;
  const r = Math.random();
  const idx = r < 0.5 ? 0 : r < 0.8 ? 1 : r < 0.95 ? 2 : 3;
  const fish = list[Math.min(idx, list.length - 1)];
  addBag(fish.name, 1);
  game.farmXP += 10;
  // Pearls are a water treasure — a chance to find one while fishing
  if (Math.random() < 0.14) { game.pearls += 1; toast('Caught a ' + fish.name + '! You also found a Pearl!', 4); }
  else toast('Caught a ' + fish.name + '!  (sells for ' + fish.sell + ' coins)');
  game.fishing.active = false; game.fishing.state = '';
}

function hitObject(kind, tx, ty, drop, amount) {
  const o = game.objects.find(o => o.x === tx && o.y === ty && o.type === kind);
  if (!o) return;
  o.hp -= toolPower(kind); o.shake = 0.25; spendEnergy(2);   // upgraded tools hit harder
  if (o.hp <= 0) {
    const got = amount * lootMult();          // Explorer mode yields more
    addBag(drop, got);
    game.objects = game.objects.filter(x => x !== o);
    rebuildSolids();
    let extra = '';
    // Emeralds are mined from rocks; felled trees sometimes drop a replantable sapling
    if (kind === 'rock' && Math.random() < 0.18 * (isExplorer() ? 2 : 1)) { game.emeralds += 1; extra = ' — and an Emerald!'; }
    if (kind === 'tree' && Math.random() < (isExplorer() ? 0.8 : 0.45)) { addBag('sapling', 1); extra = ' — and a Sapling!'; }
    toast('+' + got + ' ' + drop + extra, extra ? 4 : 2.4);
  }
}

function harvestOrCut(tx, ty) {
  const k = keyName(tx, ty);
  const crop = game.crops[k];
  const def = crop && CROPS[crop.type];
  if (crop && crop.stage >= def.stages - 1) {
    addBag(crop.type, 1);
    delete game.crops[k];
    game.farmXP += 15;
    toast('Harvested ' + def.name + '!');
    spendEnergy(1);
  } else {
    spendEnergy(1); // swinging at grass
  }
}

function swingSword() {
  const { tx, ty } = facingTile();
  const cx = (tx + 0.5) * TS, cy = (ty + 0.5) * TS;
  let hit = false;
  game.enemies.forEach(e => {
    const ex = e.x + TS / 2, ey = e.y + TS / 2;
    if (Math.hypot(ex - cx, ey - cy) < TS * 1.2) {
      e.hp -= 15; e.hurt = 0.3; hit = true;
      const kb = 12;
      if (game.facing === 'left') e.x -= kb; if (game.facing === 'right') e.x += kb;
      if (game.facing === 'up') e.y -= kb; if (game.facing === 'down') e.y += kb;
    }
  });
  if (hit) {
    game.enemies = game.enemies.filter(e => {
      if (e.hp <= 0) { addBag('slimeball', 1); game.gold += 5; return false; }
      return true;
    });
  }
  spendEnergy(1);
}

function storeInChest() {
  let moved = 0;
  for (const it in game.bag) { game.chest[it] = (game.chest[it] || 0) + game.bag[it]; moved += game.bag[it]; }
  game.bag = {};
  toast(moved ? 'Stored ' + moved + ' items in your chest.' : 'Your chest — keep your harvest safe here.');
}

function tryInteract(tx, ty) {
  // the home: its bed and chest are usable; the rest opens the build/upgrade menu
  const home = game.objects.find(h => h.type === 'home');
  if (home) {
    if (home.bed && tx === home.bed.x && ty === home.bed.y) { startSleep(); return true; }
    if (home.chest && tx === home.chest.x && ty === home.chest.y) { storeInChest(); return true; }
    if (home.catalogue && tx === home.catalogue.x && ty === home.catalogue.y) { openCatalogue(); return true; }
    const t = HOME_TIERS[home.tier];
    if (tx >= home.x && tx < home.x + t.w && ty >= home.y && ty < home.y + t.h) {
      openBuildMenu(); return true;
    }
  }
  const o = game.objects.find(o => o.x === tx && o.y === ty);
  // signpost -> read it
  if (o && o.type === 'signpost') {
    toast(o.known
      ? o.text + ' lies that way — a long road from Harvest Hollow. (You can\'t travel there yet.)'
      : 'A weathered signpost, its lettering worn away. The trail winds off into the unknown...', 6);
    return true;
  }
  // workbench (or the shed) -> crafting
  if (o && (o.type === 'workbench' || o.type === 'shed')) { openCraftMenu(); return true; }
  // kitchen -> process raw goods into artisan products
  if (o && o.type === 'kitchen') { openKitchenMenu(); return true; }
  // village general store -> buy seeds / sell goods at a better price
  if (o && o.type === 'store') { openStoreMenu(); return true; }
  // job board -> hire & manage workers (needs an established farm)
  if (o && o.type === 'jobboard') {
    if (farmLevel() < 2) { toast('The job board is bare. Grow your farm (reach Farm Lv 2 by shipping goods) to attract workers.', 6); }
    else openHireMenu();
    return true;
  }
  // shipping bin -> sell all sellable items
  if (o && o.type === 'bin') { sellAll(); return true; }
  // parcel left by the postman -> collect the delivery
  if (o && o.type === 'parcel') { collectMail(); return true; }
  // villager -> a friendly greeting
  if (o && o.type === 'villager') {
    const lines = ['"Welcome to Mossy Village!"', '"The store has better prices than mail-order."',
      '"Folk say Sandy Cove is just a tale... but you never know."', '"Lovely weather for the harvest."'];
    toast(o.name + ': ' + lines[(o.x + o.y) % lines.length], 5); return true;
  }
  // sign
  if (o && o.type === 'sign') { toast(o.text + (o.text === 'Harvest Hollow' ? ' — your home. For now.' : ''), 4); return true; }
  // the relic in the grotto: the first real clue toward Sandy Cove
  if (o && o.type === 'relic') {
    if (!game.secretFound) {
      game.secretFound = true; game.gold += 100;
      toast('Behind the falls, a mossy stone is carved with a tide and a cove. ' +
            '"When the harvest is greatest, the low tide will show the way to Sandy Cove." (+100g)', 11);
    } else { toast('The carved stone hums faintly, as if waiting.'); }
    return true;
  }
  // animal -> collect produce / pet
  const a = game.animals.find(a =>
    Math.abs(a.x - tx * TS) < TS * 1.5 && Math.abs(a.y - ty * TS) < TS * 1.5);
  if (a) {
    if (a.produce) {
      a.produce = false;
      const item = a.kind === 'cow' ? 'milk' : 'egg';
      addBag(item, 1); toast('Collected ' + item + '!');
    } else { toast('You pet the ' + a.kind + '.'); }
    return true;
  }
  return false;
}

function sellAll() {
  let total = 0, count = 0; const lines = [];
  for (const it in game.bag) {
    if (SELLABLE[it]) {
      const v = SELLABLE[it] * game.bag[it];
      lines.push(game.bag[it] + '× ' + it + ' = ' + v + 'g');
      total += v; count += game.bag[it]; delete game.bag[it];
    }
  }
  game.gold += total;
  game.farmXP += total;          // shipping grows the farm's reputation/level
  toast(count ? 'Shipped: ' + lines.join(', ') + '  —  +' + total + ' coins' : 'Nothing to ship.', count ? 6 : 2.4);
}

// the "Order"/B button: open the catalogue if standing near it
function tryBuy() {
  const h = homeObj();
  if (!h || !h.catalogue) return;
  const pcx = Math.floor((game.px + TS / 2) / TS), pcy = Math.floor((game.py + TS / 2) / TS);
  if (Math.hypot(h.catalogue.x - pcx, h.catalogue.y - pcy) <= 2.5) openCatalogue();
  else toast('Find the catalogue by your tent to order supplies.');
}

// ---- mail-order catalogue + Wednesday post ----
function orderItem(idx) {
  const it = CATALOGUE[idx]; if (!it) return false;
  const price = modePrice(it.price);
  if (game.gold < price) { toast('Not enough coins to order ' + it.name + '.'); return false; }
  game.gold -= price;
  const ex = game.pendingOrders.find(o => o.key === it.key);
  if (ex) ex.qty += 1; else game.pendingOrders.push({ key: it.key, name: it.name, qty: 1 });
  toast('Ordered ' + it.name + ' — arrives in ' + daysUntilPost() + ' day(s), on post day.', 4);
  saveGame();
  return true;
}
function deliverPost() {
  // called on a Wednesday: move pending orders (and any quest mail) into a parcel by the tent
  if (!game.pendingOrders.length && !game.mail.length) return;
  game.mail = game.mail.concat(game.pendingOrders);
  game.pendingOrders = [];
  const h = homeObj();
  const px = h ? h.catalogue.x : 13, py = (h ? h.catalogue.y : 15) + 1;
  if (!game.objects.some(o => o.type === 'parcel')) addObject('parcel', px, py, {});
  // a postman strolls in from the west road to drop it off
  game.postman = { x: -TS, y: 10 * TS, phase: 'in', tx: px * TS, ty: (py - 1) * TS, frame: 0, animTime: 0, dir: 1, wait: 0 };
  toast('Post day! The postman is bringing a parcel to your tent.', 6);
}
function collectMail() {
  if (!game.mail.length) { toast('The parcel is empty.'); return; }
  let n = 0;
  game.mail.forEach(m => {
    if (m.key && game.seeds[m.key] != null) game.seeds[m.key] += m.qty;     // seeds
    else addBag(m.item || m.key, m.qty);                                     // other items / quest goods
    n += m.qty;
  });
  game.mail = [];
  game.objects = game.objects.filter(o => o.type !== 'parcel');
  toast('Collected your delivery (' + n + ' item' + (n === 1 ? '' : 's') + ')!', 4);
  saveGame();
}

// ---- crafting ----
function craftRecipe(id) {
  const r = CRAFT_RECIPES.find(x => x.id === id); if (!r) return false;
  if (!canCraft(r)) { toast('Not enough materials or coins for ' + r.name + '.'); return false; }
  for (const k in r.mats) game.bag[k] -= r.mats[k];
  const fee = recipeFee(r);
  if (fee) game.gold -= fee;
  // apply the recipe's effect
  if (r.id === 'shed') {
    game.shedBuilt = true;
    addObject('shed', 9, 15, {});
    rebuildSolids();
    toast('Tool Shed built! Toolsmithing is now available at the workbench.', 6);
  } else if (r.id === 'kitchen') {
    game.kitchenBuilt = true;
    addObject('kitchen', 8, 12, {});
    rebuildSolids();
    toast('Kitchen built! Process milk, eggs and crops into valuable goods here.', 6);
  } else if (r.tool) {
    game.toolLevel[r.tool] = Math.min(TOOL_MAX, (game.toolLevel[r.tool] || 1) + 1);
    toast(r.name + ' to Lv ' + game.toolLevel[r.tool] + '!', 4);
  }
  // earn skill XP; once learned, no more crafter's fee in that area
  const wasLearned = skillLearned(r.area);
  game.skills[r.area] = (game.skills[r.area] || 0) + 1;
  if (!wasLearned && skillLearned(r.area)) {
    const nm = r.area.charAt(0).toUpperCase() + r.area.slice(1);
    toast('You\'ve learned ' + nm + '! You can now do it yourself — no more crafter\'s fee.', 7);
  }
  saveGame();
  return true;
}
// tool strength used when chopping/mining (improves with upgrades)
function toolPower(kind) {
  if (kind === 'tree') return game.toolLevel.axe || 1;
  if (kind === 'rock') return game.toolLevel.pickaxe || 1;
  return 1;
}

// turn one raw item into its artisan product at the Kitchen
function processItem(idx) {
  const a = ARTISAN[idx]; if (!a) return false;
  if ((game.bag[a.in] || 0) < 1) { toast('No ' + a.in + ' to process.'); return false; }
  game.bag[a.in] -= 1; if (game.bag[a.in] <= 0) delete game.bag[a.in];
  addBag(a.out, 1);
  toast('Made ' + a.out + ' — worth ' + a.sell + ' coins.', 3);
  return true;
}

function spendEnergy(n) {
  game.energy -= n;
  if (game.energy < 0) { game.health += game.energy; game.energy = 0; } // overexertion hurts
}

// ---- home upgrades ----
function homeObj() { return game.objects.find(o => o.type === 'home'); }
function haveAmount(key) {
  if (key === 'coins') return game.gold;
  if (key === 'pearls') return game.pearls;
  if (key === 'emeralds') return game.emeralds;
  return game.bag[key] || 0;                  // wood / stone live in the bag
}
function canAfford(cost) { return Object.keys(cost).every(k => haveAmount(k) >= cost[k]); }
function payCost(cost) {
  for (const k in cost) {
    if (k === 'coins') game.gold -= cost[k];
    else if (k === 'pearls') game.pearls -= cost[k];
    else if (k === 'emeralds') game.emeralds -= cost[k];
    else game.bag[k] -= cost[k];
  }
}
function upgradeHome() {
  const h = homeObj(); if (!h) return false;
  const next = HOME_TIERS[h.tier + 1];
  if (!next) { toast('Your Ranch is fully built!'); return false; }
  if (!canAfford(next.cost)) { toast('Not enough materials for the ' + next.name + '.'); return false; }
  payCost(next.cost);
  h.tier += 1;
  setHomeFixtures(h);
  rebuildSolids();
  toast('Home upgraded to ' + next.name + '!', 5);
  if (next.name === 'Ranch') toast('The Ranch is complete. Something stirs toward Sandy Cove...', 9);
  saveGame();
  return true;
}

// ---- employees (hired from the town job board) ----
function hireCandidate(idx) {
  const c = HIRE_POOL[idx]; if (!c) return false;
  if (farmLevel() < c.minFarmLv) { toast('Your farm isn\'t established enough for a ' + c.tier + ' yet.'); return false; }
  const hire = modePrice(c.hire);
  if (currencyAmount(c.cur) < hire) { toast('Not enough ' + CUR_NAME[c.cur] + ' to hire a ' + c.tier + '.'); return false; }
  spendCurrency(c.cur, hire);
  const h = homeObj();
  const e = {
    id: ++game.npcId, role: c.role, tier: c.tier, level: 1, cap: c.cap, upBase: c.upBase,
    x: ((h ? h.x : 14) + 1 + Math.random() * 2) * TS, y: ((h ? h.y : 12) + 3 + Math.random() * 2) * TS,
    vx: 0, vy: 0, t: Math.random() * 2, dir: 1, frame: 0, animTime: 0,
  };
  game.employees.push(e);
  toast('Hired a ' + c.tier + '! They\'ll get to work each morning.', 5);
  saveGame();
  return true;
}
function empUpgradeCost(e) { return e.upBase * e.level; }
function upgradeEmployee(id) {
  const e = game.employees.find(x => x.id === id); if (!e) return false;
  if (e.level >= e.cap) { toast(e.tier + ' is fully trained (Lv ' + e.cap + '). Dismiss and hire a higher tier to go further.'); return false; }
  const cost = empUpgradeCost(e);
  if (game.gold < cost) { toast('Need ' + cost + ' coins to train them.'); return false; }
  game.gold -= cost; e.level += 1;
  toast(e.tier + ' trained to Lv ' + e.level + (e.level >= e.cap ? ' (max for this tier).' : '.'), 4);
  saveGame();
  return true;
}
function dismissEmployee(id) {
  game.employees = game.employees.filter(x => x.id !== id);
  toast('Worker let go.'); saveGame();
}
// applied each morning during the day rollover
function applyEmployees() {
  game.employees.forEach(e => {
    if (e.role === 'farmer') {
      const cap = e.level * 8; let n = 0;
      for (const k in game.crops) { if (n >= cap) break; game.crops[k].wateredToday = true; game.watered.add(k); n++; }
    } else if (e.role === 'rancher') {
      game.animals.forEach(a => { if (a.produce) { a.produce = false; addBag(a.kind === 'cow' ? 'milk' : 'egg', 1); } });
      game.gold += e.level * 8;   // sells a little surplus
    }
  });
}

// ----------------------------------------------------------------- DAY CYCLE
function startSleep() {
  if (game.sleeping) return;
  game.sleeping = true; game.fadeDir = 1; game.fading = 0;
}

// advanceDay: pure-ish day rollover logic (verified headlessly).
function advanceDay() {
  game.day += 1;
  game.minutes = DAY_START;
  game.energy = game.maxEnergy;
  game.health = Math.min(game.maxHealth, game.health + 30);
  // grow watered crops, then dry everything out
  for (const k in game.crops) {
    const c = game.crops[k];
    const def = CROPS[c.type];
    if (c.wateredToday && c.stage < def.stages - 1) {
      c.growth += 1;
      const perStage = def.days / (def.stages - 1);
      c.stage = Math.min(def.stages - 1, Math.floor(c.growth / perStage));
    }
    c.wateredToday = false;
  }
  game.watered = new Set();
  // grow planted saplings; mature ones become choppable trees
  let grewTree = false;
  game.objects.forEach(o => {
    if (o.type === 'sapling') {
      o.growth = (o.growth || 0) + 1;
      if (o.growth >= SAPLING_DAYS) { o.type = 'tree'; o.hp = 4; delete o.growth; grewTree = true; }
    }
  });
  if (grewTree) rebuildSolids();
  // animals produce again
  game.animals.forEach(a => { a.produce = true; });
  // hired workers do their morning jobs (water crops, gather produce)
  applyEmployees();
  // Wednesday is post day — deliver any catalogue orders / quest mail
  if (isPostDay(game.day)) deliverPost();
  // respawn a slime occasionally
  if (game.enemies.length < 4 && Math.random() < 0.7)
    game.enemies.push(makeSlime(30 + Math.floor(Math.random() * 8), 3 + Math.floor(Math.random() * 6)));
  saveGame();
}

// ----------------------------------------------------------------- SAVE/LOAD
function saveGame() {
  if (game.area !== 'ranch') return;   // the persistent save is the home ranch; village is ephemeral
  try {
    const data = {
      ptx: game.px / TS, pty: game.py / TS,   // store position in tiles (scale-independent)
      energy: game.energy, health: game.health,
      gold: game.gold, pearls: game.pearls, emeralds: game.emeralds, mode: game.mode,
      farmXP: game.farmXP, employees: game.employees, npcId: game.npcId,
      pendingOrders: game.pendingOrders, mail: game.mail,
      skills: game.skills, toolLevel: game.toolLevel, shedBuilt: game.shedBuilt, kitchenBuilt: game.kitchenBuilt,
      minutes: game.minutes, day: game.day,
      hotbar: game.hotbar, selected: game.selected, bag: game.bag,
      chest: game.chest, seeds: game.seeds,
      tilled: [...game.tilled], watered: [...game.watered], crops: game.crops,
      objects: game.objects, animals: game.animals.map(a => ({ ...a })),
      explored: [...game.explored],
      secretFound: game.secretFound, homeIntroShown: game.homeIntroShown,
    };
    localStorage.setItem('harvest_hollow_save', JSON.stringify(data));
  } catch (e) { /* file:// may block storage; ignore */ }
}
function loadGame() {
  try {
    const raw = localStorage.getItem('harvest_hollow_save');
    if (!raw) return false;
    const d = JSON.parse(raw);
    Object.assign(game, {
      px: (d.ptx != null ? d.ptx * TS : d.px) || 0, py: (d.pty != null ? d.pty * TS : d.py) || 0,
      energy: d.energy, health: d.health, gold: d.gold,
      pearls: d.pearls || 0, emeralds: d.emeralds || 0, mode: d.mode || 'adventurer',
      farmXP: d.farmXP || 0, employees: d.employees || [], npcId: d.npcId || 0,
      pendingOrders: d.pendingOrders || [], mail: d.mail || [],
      skills: d.skills || { carpentry: 0, toolsmithing: 0 },
      toolLevel: d.toolLevel || { axe: 1, pickaxe: 1, wateringcan: 1, hoe: 1 },
      shedBuilt: !!d.shedBuilt, kitchenBuilt: !!d.kitchenBuilt,
      minutes: d.minutes, day: d.day, hotbar: d.hotbar, selected: d.selected,
      bag: d.bag, chest: d.chest, seeds: d.seeds, crops: d.crops, objects: d.objects,
      secretFound: !!d.secretFound, homeIntroShown: !!d.homeIntroShown,
    });
    game.tilled = new Set(d.tilled); game.watered = new Set(d.watered);
    game.explored = new Set(d.explored || []);
    rebuildSolids();
    return true;
  } catch (e) { return false; }
}

// ----------------------------------------------------------------- UPDATE
function update(dt) {
  if (game.paused) return;

  // ---- sleep fade transition
  if (game.sleeping) {
    game.fading += dt * 1.4 * game.fadeDir;
    if (game.fadeDir === 1 && game.fading >= 1) { advanceDay(); game.fadeDir = -1; }
    if (game.fadeDir === -1 && game.fading <= 0) { game.fading = 0; game.sleeping = false; }
    return;
  }

  game.anim += dt;   // drives water / waterfall shimmer
  updateFishLeaps(dt);

  // ---- time
  game.minAccum += dt * 1000;
  while (game.minAccum >= MIN_MS) { game.minAccum -= MIN_MS; game.minutes += 1; }
  if (game.minutes >= DAY_END) { toast('You passed out from exhaustion...'); startSleep(); }

  // ---- fishing minigame ticks
  if (game.fishing.active) {
    game.fishing.t += dt;
    if (game.fishing.state === 'cast' && game.fishing.t >= game.fishing.biteAt) {
      game.fishing.state = 'bite'; game.fishing.biteEnd = game.fishing.t + 1.5;
      toast('A bite! Use / tap to reel it in!');
    } else if (game.fishing.state === 'bite' && game.fishing.t >= game.fishing.biteEnd) {
      game.fishing.active = false; game.fishing.state = ''; toast('It got away...');
    }
  }

  // ---- player movement
  let dx = 0, dy = 0;
  if (keys['w'] || keys['arrowup']) dy -= 1;
  if (keys['s'] || keys['arrowdown']) dy += 1;
  if (keys['a'] || keys['arrowleft']) dx -= 1;
  if (keys['d'] || keys['arrowright']) dx += 1;
  // touch joystick overrides keys: walk toward where the thumb is pushed
  if (game.touch.active) {
    const jx = game.touch.x - game.touch.ox, jy = game.touch.y - game.touch.oy;
    if (Math.hypot(jx, jy) > 14) { dx = jx; dy = jy; }   // small dead-zone
  }
  game.moving = (dx !== 0 || dy !== 0);
  if (game.moving && game.fishing.active) { game.fishing.active = false; game.fishing.state = ''; }
  if (game.moving) {
    // face the dominant axis (works for keyboard and joystick)
    if (Math.abs(dx) >= Math.abs(dy)) game.facing = dx < 0 ? 'left' : 'right';
    else game.facing = dy < 0 ? 'up' : 'down';
    const len = Math.hypot(dx, dy) || 1;
    const sp = game.speed * modeSpeed() * (game.energy <= 0 ? 0.6 : 1);
    moveBy((dx / len) * sp * dt, (dy / len) * sp * dt);
    game.animTime += dt;
    if (game.animTime > 0.12) { game.animTime = 0; game.animFrame = (game.animFrame + 1) % 6; }
    game.stepAccum += sp * dt;                       // leave terrain-styled footprints
    if (game.stepAccum >= TS * 0.6) { game.stepAccum = 0; emitFootstep(); }
  } else { game.animFrame = 0; }

  if (game.toolUseTime > 0) game.toolUseTime -= dt;
  if (game.hitFlash > 0) game.hitFlash -= dt;
  if (game.messageTime > 0) game.messageTime -= dt;

  checkHomeIntro();
  checkTravel(dt);
  markExplored();
  updateCamera(dt);
  updateAnimals(dt);
  updateEmployees(dt);
  updatePostman(dt);
  updateCritters(dt);
  updateFootsteps(dt);
  updateMotes(dt);
  updateEnemies(dt);
}

// the postman walks in on post day, pauses by the tent, then heads back out
function updatePostman(dt) {
  const p = game.postman; if (!p) return;
  const spd = 72;
  if (p.phase === 'in') {
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy) || 1;
    p.dir = dx < 0 ? -1 : 1;
    if (d > 5) { p.x += dx / d * spd * dt; p.y += dy / d * spd * dt; }
    else { p.wait += dt; if (p.wait > 1.2) p.phase = 'out'; }
  } else {
    p.dir = -1; p.x -= spd * dt;
    if (p.x < -TS) game.postman = null;
  }
  if (p) { p.animTime += dt; if (p.animTime > 0.14) { p.animTime = 0; p.frame = (p.frame + 1) % 6; } }
}

// reveal minimap tiles within sight of the player (fog of war)
function markExplored() {
  const pcx = Math.floor((game.px + TS / 2) / TS), pcy = Math.floor((game.py + TS / 2) / TS);
  const R = 5;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const x = pcx + dx, y = pcy + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) game.explored.add(keyName(x, y));
    }
}

function updateFishLeaps(dt) {
  game.leapTimer -= dt;
  if (game.leapTimer <= 0) {
    game.leapTimer = 3 + Math.random() * 5;
    const keys = Object.keys(game.waterType);
    if (keys.length) {
      const [x, y] = keys[Math.floor(Math.random() * keys.length)].split(',').map(Number);
      game.fishLeaps.push({ x, y, t: 0, dur: 0.8 + Math.random() * 0.3, dir: Math.random() < 0.5 ? -1 : 1 });
    }
  }
  game.fishLeaps = game.fishLeaps.filter(f => (f.t += dt) < f.dur);
}

// ambient critters (butterflies, bees, flies) that drift around the player for atmosphere
const BFLY_COLORS = ['#ff7eb6', '#ffd14d', '#7ec8ff', '#b07eff', '#ff9e57', '#ffffff', '#8affc0'];
function makeCritter(px, py) {
  const r = Math.random();
  const kind = r < 0.55 ? 'butterfly' : r < 0.8 ? 'bee' : 'fly';
  const a = Math.random() * 7, dist = (2 + Math.random() * 6) * TS;
  return {
    kind, x: px + Math.cos(a) * dist, y: py + Math.sin(a) * dist, vx: 0, vy: 0, t: 0,
    phase: Math.random() * 7,
    col: kind === 'butterfly' ? BFLY_COLORS[Math.floor(Math.random() * BFLY_COLORS.length)] : kind === 'bee' ? '#f2c14e' : '#33343a',
    spd: kind === 'butterfly' ? 24 : kind === 'bee' ? 42 : 64,
    flutter: kind === 'butterfly' ? 7 : kind === 'bee' ? 17 : 28,
    amp: kind === 'butterfly' ? 7 : kind === 'bee' ? 3 : 2,
  };
}
function updateCritters(dt) {
  const px = game.px + TS / 2, py = game.py + TS / 2;
  if (game.critters.length < 9) game.critters.push(makeCritter(px, py));
  game.critters.forEach(c => {
    c.t -= dt;
    if (c.t <= 0) { c.t = 0.5 + Math.random() * 1.3; const a = Math.random() * 7; c.vx = Math.cos(a) * c.spd; c.vy = Math.sin(a) * c.spd; }
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.x += (px - c.x) * 0.15 * dt; c.y += (py - c.y) * 0.15 * dt;   // gently linger near you
  });
  game.critters = game.critters.filter(c => Math.hypot(c.x - px, c.y - py) < 11 * TS);
}

// footstep feedback — a little puff at the player's feet, styled by the terrain
function emitFootstep() {
  const cxp = game.px + TS / 2;
  const tx = Math.floor(cxp / TS), ty = Math.floor((game.py + TS - 6) / TS);
  let terr = (game.ground[ty] && game.ground[ty][tx]) || 'grass';
  const k = keyName(tx, ty);
  if (game.fords.has(k)) terr = 'water';
  else if (game.tilled.has(k)) terr = 'dirt';
  game.footsteps.push({ x: cxp + game.stepSide * 5, y: game.py + TS - 5, t: 0, dur: 0.55, type: terr });
  game.stepSide = -game.stepSide;
}
function updateFootsteps(dt) {
  game.footsteps = game.footsteps.filter(f => (f.t += dt) < f.dur);
}

// faint drifting motes (pollen/dust) in screen space, for subtle ambience
function updateMotes(dt) {
  const W = canvas.width, H = canvas.height;
  if (game.motes.length < 26) {
    game.motes.push({ x: Math.random() * W, y: Math.random() * H, vx: 4 + Math.random() * 8,
                      vy: 5 + Math.random() * 10, r: 0.8 + Math.random() * 1.4, phase: Math.random() * 7 });
  }
  game.motes.forEach(m => {
    m.x += (m.vx + Math.sin(game.anim * 0.6 + m.phase) * 6) * dt;
    m.y += m.vy * dt;
    if (m.y > H + 4) { m.y = -4; m.x = Math.random() * W; }
    if (m.x > W + 4) m.x = -4; else if (m.x < -4) m.x = W + 4;
  });
}
function drawMotes() {
  game.motes.forEach(m => {
    const a = 0.10 + 0.12 * (0.5 + 0.5 * Math.sin(game.anim * 1.2 + m.phase));
    ctx.fillStyle = 'rgba(255,252,235,' + a.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fill();
  });
}

// first time the player walks up to their shelter, explain what the home is for
function checkHomeIntro() {
  if (game.homeIntroShown) return;
  const h = homeObj(); if (!h) return;
  const t = HOME_TIERS[h.tier];
  const hcx = (h.x + t.w / 2) * TS, hcy = (h.y + t.h / 2) * TS;
  const pcx = game.px + TS / 2, pcy = game.py + TS / 2;
  if (Math.hypot(pcx - hcx, pcy - hcy) < TS * 3.2) {
    game.homeIntroShown = true;
    toast('This is your home — right now just a Basic Shelter. The bed beside it is where you sleep to start a new day, and the chest stores your belongings. As you earn coins and gather wood, stone, pearls and emeralds, walk up and press Use to upgrade it — tent, cabin, house, all the way to a grand Ranch.', 13);
    saveGame();
  }
}

// collision-aware movement against solid tiles
function moveBy(mx, my) {
  let nx = game.px + mx;
  if (!collides(nx, game.py)) game.px = nx;
  let ny = game.py + my;
  if (!collides(game.px, ny)) game.py = ny;
  game.px = Math.max(0, Math.min((MAP_W - 1) * TS, game.px));
  game.py = Math.max(0, Math.min((MAP_H - 1) * TS, game.py));
}
// collision uses a small "feet" box near the bottom-centre of the sprite, so the player
// can walk right up to (and visually overlap) fences, trees and other solids.
function collides(px, py) {
  const fx = px + TS * 0.30, fw = TS * 0.40;   // narrow box
  const fy = py + TS * 0.62, fh = TS * 0.34;   // low (feet only)
  const xs = [fx, fx + fw], ys = [fy, fy + fh];
  for (const cy of ys) for (const cx of xs)
    if (game.solid.has(keyName(Math.floor(cx / TS), Math.floor(cy / TS)))) return true;
  return false;
}

function updateAnimals(dt) {
  game.animals.forEach(a => {
    a.t -= dt;
    if (a.t <= 0) { a.t = 1 + Math.random() * 2; a.vx = (Math.random() - 0.5) * 24; a.vy = (Math.random() - 0.5) * 24;
      a.dir = a.vx < 0 ? -1 : 1; }
    a.x += a.vx * dt; a.y += a.vy * dt;
    // keep loosely in pen
    a.x = Math.max(6.5 * TS, Math.min(12 * TS, a.x));
    a.y = Math.max(22.5 * TS, Math.min(27 * TS, a.y));
    a.animTime += dt; if (a.animTime > 0.25) { a.animTime = 0; a.frame = (a.frame + 1) % 2; }
  });
}

// hired workers wander the farm (purely visual; their real work happens each morning)
function updateEmployees(dt) {
  const h = homeObj();
  const cx = (h ? h.x : 14) * TS, cy = (h ? h.y : 12) * TS;
  game.employees.forEach(e => {
    e.t -= dt;
    if (e.t <= 0) { e.t = 1.5 + Math.random() * 2.5; e.vx = (Math.random() - 0.5) * 34; e.vy = (Math.random() - 0.5) * 34; e.dir = e.vx < 0 ? -1 : 1; }
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.x = Math.max(cx - 4 * TS, Math.min(cx + 10 * TS, e.x));   // roam near the homestead
    e.y = Math.max(cy, Math.min(cy + 10 * TS, e.y));
    e.animTime += dt; if (e.animTime > 0.16) { e.animTime = 0; e.frame = (e.frame + 1) % 6; }
  });
}

function updateEnemies(dt) {
  const pcx = game.px + TS / 2, pcy = game.py + TS / 2;
  game.enemies.forEach(e => {
    if (e.hurt > 0) e.hurt -= dt;
    const dxp = pcx - (e.x + TS / 2), dyp = pcy - (e.y + TS / 2);
    const dist = Math.hypot(dxp, dyp);
    if (dist < TS * 6) { // chase
      const sp = 36;
      e.x += (dxp / dist) * sp * dt; e.y += (dyp / dist) * sp * dt;
    } else {
      e.t -= dt; if (e.t <= 0) { e.t = 1 + Math.random() * 2; e.vx = (Math.random() - 0.5) * 30; e.vy = (Math.random() - 0.5) * 30; }
      e.x += e.vx * dt; e.y += e.vy * dt;
    }
    e.animTime += dt; if (e.animTime > 0.2) { e.animTime = 0; e.frame = (e.frame + 1) % 4; }
    // damage player on contact
    if (dist < TS * 0.7 && game.hitFlash <= 0) {
      game.health -= 8; game.hitFlash = 0.8;
      if (game.health <= 0) { game.health = game.maxHealth * 0.5; toast('You collapsed! Rescued home.'); startSleep(); }
    }
  });
}

// ----------------------------------------------------------------- RENDER
function camTarget() {
  let cx = game.px + TS / 2 - canvas.width / 2;
  let cy = game.py + TS / 2 - canvas.height / 2;
  cx = Math.max(0, Math.min(MAP_W * TS - canvas.width, cx));
  cy = Math.max(0, Math.min(MAP_H * TS - canvas.height, cy));
  return { cx, cy };
}
// ease the camera toward the player so it lags a touch behind (subtle swoop)
function updateCamera(dt) {
  const t = camTarget();
  if (!game.camInit) { game.camX = t.cx; game.camY = t.cy; game.camInit = true; return; }
  const k = 1 - Math.exp(-dt * 5);     // gentle follow; higher = snappier
  game.camX += (t.cx - game.camX) * k;
  game.camY += (t.cy - game.camY) * k;
}
function camera() { return { cx: Math.round(game.camX), cy: Math.round(game.camY) }; }

function nightTint() {
  // 0 day .. up to ~0.55 deep night. brightens at dawn.
  const m = game.minutes;
  if (m < 17 * 60) return 0;                       // before 5pm: full day
  if (m < 19 * 60) return (m - 17 * 60) / 120 * 0.35;
  if (m < 24 * 60) return 0.35 + (m - 19 * 60) / 300 * 0.2;
  return 0.55;
}

function render() {
  const { cx, cy } = camera();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ---- ground tiles (only visible range)
  const x0 = Math.floor(cx / TS), y0 = Math.floor(cy / TS);
  const x1 = Math.min(MAP_W, x0 + Math.ceil(canvas.width / TS) + 1);
  const y1 = Math.min(MAP_H, y0 + Math.ceil(canvas.height / TS) + 1);
  for (let y = Math.max(0, y0); y < y1; y++) {
    for (let x = Math.max(0, x0); x < x1; x++) {
      const dx = x * TS - cx, dy = y * TS - cy, k = keyName(x, y);
      drawGround(game.ground[y][x], x, y, dx, dy);
      if (game.bridges.has(k)) drawBridge(x, y, dx, dy);
      else if (game.fords.has(k)) drawFord(x, y, dx, dy);
      else if (game.lilypads.has(k)) drawLily(x, y, dx, dy);
      if (game.cliff.has(k)) drawCliffTile(x, y, dx, dy);
      if (game.tilled.has(k)) drawTilled(x, y, dx, dy, game.watered.has(k));
    }
  }

  // ---- crops
  for (const k in game.crops) {
    const [x, y] = k.split(',').map(Number);
    drawCrop(game.crops[k], x * TS - cx, y * TS - cy);
  }

  // ---- footstep marks on the ground (under everything else)
  drawFootsteps(cx, cy);
  // ---- leaping fish (over the water surface)
  drawFishLeaps(cx, cy);

  // ---- depth-sorted sprites (objects + player + animals + enemies)
  const drawables = [];
  game.objects.forEach(o => drawables.push({ sortY: objSortY(o), draw: () => drawObject(o, cx, cy) }));
  game.animals.forEach(a => drawables.push({ sortY: a.y + TS, draw: () => drawAnimal(a, cx, cy) }));
  game.employees.forEach(e => drawables.push({ sortY: e.y + TS, draw: () => drawNPC(e, cx, cy) }));
  if (game.postman) drawables.push({ sortY: game.postman.y + TS, draw: () => drawPostman(cx, cy) });
  game.enemies.forEach(e => drawables.push({ sortY: e.y + TS, draw: () => drawSlime(e, cx, cy) }));
  drawables.push({ sortY: game.py + TS, draw: () => drawPlayer(cx, cy) });
  drawables.sort((a, b) => a.sortY - b.sortY);
  drawables.forEach(d => d.draw());

  // ---- ambient critters fluttering above the scene
  drawCritters(cx, cy);

  // ---- waterfall is drawn in FRONT so the player can stand behind it
  drawWaterfalls(cx, cy);
  // ---- fishing line + bobber
  drawFishing(cx, cy);

  // ---- drifting mist at the map edges
  drawEdgeFog(cx, cy);

  // ---- night overlay
  const nt = nightTint();
  if (nt > 0) { ctx.fillStyle = 'rgba(20,24,70,' + nt + ')'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

  // ---- faint drifting motes (subtle ambience, above the world)
  drawMotes();

  // ---- facing-tile highlight when a tool is selected
  drawTargetHighlight(cx, cy);

  // ---- sleep fade
  if (game.fading > 0) { ctx.fillStyle = 'rgba(0,0,0,' + game.fading + ')'; ctx.fillRect(0, 0, canvas.width, canvas.height); }

  // ---- touch joystick overlay
  drawJoystick();

  updateHUD();
}

function drawJoystick() {
  if (!game.touch.active) return;
  const { ox, oy, x, y } = game.touch;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.arc(ox, oy, 48, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ox, oy, 48, 0, 7); ctx.stroke();
  let dx = x - ox, dy = y - oy; const mag = Math.hypot(dx, dy) || 1; const r = Math.min(mag, 48);
  const tx = ox + dx / mag * r, ty = oy + dy / mag * r;
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(tx, ty, 24, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(120,70,20,0.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tx, ty, 24, 0, 7); ctx.stroke();
  ctx.restore();
}

function objSortY(o) {
  if (o.type === 'house') return (o.y + o.h) * TS;
  if (o.type === 'home') return (o.y + HOME_TIERS[o.tier].h) * TS;
  if (o.type === 'shed') return (o.y + 2) * TS;
  if (o.type === 'store') return (o.y + 3) * TS;
  if (o.type === 'tree') return (o.y + 1) * TS;
  return (o.y + 1) * TS;
}

// ground tile drawing — single-tile source art + deterministic procedural detail
function drawGround(type, x, y, dx, dy) {
  if (type === 'path') {
    // grass underneath, then the path on top, then feather the edges that meet grass
    if (ready(IMG.grass)) ctx.drawImage(IMG.grass, 0, 0, 16, 16, dx, dy, TS, TS);
    else { ctx.fillStyle = '#6cbf4b'; ctx.fillRect(dx, dy, TS, TS); }
    if (ready(IMG.path)) ctx.drawImage(IMG.path, 0, 0, 16, 16, dx, dy, TS, TS);
    else { ctx.fillStyle = '#caa472'; ctx.fillRect(dx, dy, TS, TS); }
    textureDirt(x, y, dx, dy, ['#b7895180', '#9c6f3c80', '#caa06a80']);
    featherPath(x, y, dx, dy);
    return;
  }
  let img = (type === 'water') ? IMG.water : IMG.grass;
  if (ready(img)) ctx.drawImage(img, 0, 0, 16, 16, dx, dy, TS, TS);
  else { ctx.fillStyle = type === 'water' ? '#3aa9e0' : '#6cbf4b'; ctx.fillRect(dx, dy, TS, TS); }
  if (type === 'grass') textureGrass(x, y, dx, dy);
  else if (type === 'water') { textureWater(x, y, dx, dy); featherWater(x, y, dx, dy); }
}

// soften the water/grass boundary: a pale shallows rim + grass tufts overhanging from the land
function featherWater(x, y, dx, dy) {
  const isW = (nx, ny) => { const g = game.ground[ny] && game.ground[ny][nx]; return g === 'water'; };
  const shallow = 'rgba(150,200,212,0.4)';
  const greens = ['#4f9a37', '#5aa84b', '#3f7f2c'];
  const tuft = (px, py, s) => { ctx.fillStyle = greens[Math.floor(tileRand(x, y, s) * greens.length)]; ctx.beginPath(); ctx.arc(px, py, 1.8 + tileRand(x, y, s + 1) * 1.3, 0, 7); ctx.fill(); };
  if (!isW(x, y - 1)) { ctx.fillStyle = shallow; ctx.fillRect(dx, dy, TS, 5); for (let i = 0; i < 4; i++) tuft(dx + 4 + tileRand(x, y, i + 10) * (TS - 8), dy + 1 + tileRand(x, y, i + 11) * 4, i + 12); }
  if (!isW(x, y + 1)) { ctx.fillStyle = shallow; ctx.fillRect(dx, dy + TS - 5, TS, 5); for (let i = 0; i < 4; i++) tuft(dx + 4 + tileRand(x, y, i + 20) * (TS - 8), dy + TS - 1 - tileRand(x, y, i + 21) * 4, i + 22); }
  if (!isW(x - 1, y)) { ctx.fillStyle = shallow; ctx.fillRect(dx, dy, 5, TS); for (let i = 0; i < 4; i++) tuft(dx + 1 + tileRand(x, y, i + 30) * 4, dy + 4 + tileRand(x, y, i + 31) * (TS - 8), i + 32); }
  if (!isW(x + 1, y)) { ctx.fillStyle = shallow; ctx.fillRect(dx + TS - 5, dy, 5, TS); for (let i = 0; i < 4; i++) tuft(dx + TS - 1 - tileRand(x, y, i + 40) * 4, dy + 4 + tileRand(x, y, i + 41) * (TS - 8), i + 42); }
}

// a lily pad floating on the water (walkable — hop across to cross quickly)
function drawLily(x, y, dx, dy) {
  const bob = Math.sin(game.anim * 1.6 + (x * 3 + y)) * 1.5;
  const cxp = dx + TS / 2, cyp = dy + TS / 2 + bob;
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(cxp, cyp + 3, TS * 0.34, TS * 0.2, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#3f8f3a'; ctx.beginPath(); ctx.ellipse(cxp, cyp, TS * 0.36, TS * 0.3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#54a64a'; ctx.beginPath(); ctx.ellipse(cxp, cyp, TS * 0.29, TS * 0.24, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#2f74c0'; ctx.beginPath();   // notch cut toward water colour
  ctx.moveTo(cxp, cyp); ctx.lineTo(cxp + TS * 0.36, cyp - 7); ctx.lineTo(cxp + TS * 0.36, cyp + 7); ctx.closePath(); ctx.fill();
  if (((x * 7 + y * 13) % 4) === 0) {            // some pads bear a flower
    ctx.fillStyle = '#ff9ec4'; ctx.beginPath(); ctx.arc(cxp - 5, cyp - 4, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd14d'; ctx.beginPath(); ctx.arc(cxp - 5, cyp - 4, 1.4, 0, 7); ctx.fill();
  }
}

// soften the path/grass boundary: scatter grass tufts over the path edge wherever
// the neighbouring tile is grass, so paths look worn-in rather than tile-stamped.
function featherPath(x, y, dx, dy) {
  const isPath = (nx, ny) => { const g = game.ground[ny] && game.ground[ny][nx]; return g === 'path'; };
  const greens = ['#4f9a37', '#5aa84b', '#3f7f2c'];
  const tuft = (px, py, s) => {
    ctx.fillStyle = greens[Math.floor(tileRand(x, y, s) * greens.length)];
    ctx.beginPath(); ctx.arc(px, py, 1.8 + tileRand(x, y, s + 1) * 1.4, 0, 7); ctx.fill();
  };
  if (!isPath(x, y - 1)) for (let i = 0; i < 5; i++) tuft(dx + 3 + tileRand(x, y, i + 60) * (TS - 6), dy + 1 + tileRand(x, y, i + 61) * 5, i + 62);
  if (!isPath(x, y + 1)) for (let i = 0; i < 5; i++) tuft(dx + 3 + tileRand(x, y, i + 70) * (TS - 6), dy + TS - 1 - tileRand(x, y, i + 71) * 5, i + 72);
  if (!isPath(x - 1, y)) for (let i = 0; i < 5; i++) tuft(dx + 1 + tileRand(x, y, i + 80) * 5, dy + 3 + tileRand(x, y, i + 81) * (TS - 6), i + 82);
  if (!isPath(x + 1, y)) for (let i = 0; i < 5; i++) tuft(dx + TS - 1 - tileRand(x, y, i + 90) * 5, dy + 3 + tileRand(x, y, i + 91) * (TS - 6), i + 92);
}

// distinguish rivers (downward flow streaks) from ponds (gentle drifting sparkles)
function textureWater(x, y, dx, dy) {
  const t = game.anim, kind = game.waterType[keyName(x, y)];
  if (kind === 'river') {
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const off = ((t * 26 + i * 24 + (x * 7 + y * 13) % 16) % TS);
      ctx.beginPath(); ctx.moveTo(dx + 6 + i * 18, dy + off - 6);
      ctx.lineTo(dx + 6 + i * 18, dy + off + 4); ctx.stroke();
    }
  } else {
    const tw = tileRand(x, y, 3);
    const a = 0.12 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.5 + tw * 6.28));
    ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
    ctx.fillRect(dx + 3 + tw * 8, dy + 4 + tileRand(x, y, 4) * 8, 3, 2);
  }
}

// scatter blades, tufts and faint patches so the repeated grass tile stops looking gridded
function textureGrass(x, y, dx, dy) {
  // faint patch (every ~3rd tile) to break up the repetition
  const p = tileRand(x, y, 1);
  if (p > 0.66) { ctx.fillStyle = 'rgba(60,110,45,0.16)'; ctx.fillRect(dx, dy, TS, TS); }
  else if (p < 0.16) { ctx.fillStyle = 'rgba(150,210,120,0.12)'; ctx.fillRect(dx, dy, TS, TS); }
  const blades = ['#4f9a37', '#7fce5d', '#3f7f2c'];
  const n = 3 + Math.floor(tileRand(x, y, 2) * 3);
  for (let i = 0; i < n; i++) {
    const bx = dx + 4 + tileRand(x, y, i * 3 + 5) * (TS - 8);
    const by = dy + 6 + tileRand(x, y, i * 3 + 6) * (TS - 8);
    const h = 3 + tileRand(x, y, i * 3 + 7) * 4;
    ctx.strokeStyle = blades[Math.floor(tileRand(x, y, i * 3 + 8) * blades.length)];
    ctx.lineWidth = 1.5; ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx + (tileRand(x, y, i + 40) - 0.5) * 3, by - h); ctx.stroke();
  }
  // rare tiny flower
  if (tileRand(x, y, 99) > 0.94) {
    ctx.fillStyle = ['#ffe14d', '#ff8fb0', '#fff'][Math.floor(tileRand(x, y, 98) * 3)];
    const fx = dx + 4 + tileRand(x, y, 97) * (TS - 8), fy = dy + 4 + tileRand(x, y, 96) * (TS - 8);
    ctx.fillRect(fx, fy, 2, 2);
  }
}

function textureDirt(x, y, dx, dy, specks) {
  const n = 4 + Math.floor(tileRand(x, y, 11) * 4);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = specks[Math.floor(tileRand(x, y, i * 2 + 12) * specks.length)];
    const sx = dx + tileRand(x, y, i * 2 + 13) * (TS - 3);
    const sy = dy + tileRand(x, y, i * 2 + 14) * (TS - 3);
    ctx.fillRect(sx, sy, 2, 2);
  }
}

function drawTilled(x, y, dx, dy, wet) {
  // center cell of FarmLand_Tile (3x3 autotile) = the plain dirt middle
  if (IMG.farmland && IMG.farmland.complete) {
    ctx.drawImage(IMG.farmland, 16, 16, 16, 16, dx, dy, TS, TS);
  } else { ctx.fillStyle = '#9a6b43'; ctx.fillRect(dx, dy, TS, TS); }
  // plowed furrows + clods for texture
  ctx.strokeStyle = 'rgba(60,38,18,0.35)'; ctx.lineWidth = 2;
  for (let r = 0; r < 3; r++) {
    const fy = dy + 8 + r * 14;
    ctx.beginPath(); ctx.moveTo(dx + 2, fy); ctx.lineTo(dx + TS - 2, fy); ctx.stroke();
  }
  textureDirt(x, y, dx, dy, ['#5a3a1c66', '#7a5128aa', '#8a6033aa']);
  if (wet) { ctx.fillStyle = 'rgba(40,30,80,0.35)'; ctx.fillRect(dx, dy, TS, TS); }
}

// raised plateau tile, using the 3x3 Cliff_Tile blob autotile (grass top, rocky face)
function drawCliffTile(x, y, dx, dy) {
  if (ready(IMG.cliff)) {
    const [cc, cr] = cliffCell(x, y);
    ctx.drawImage(IMG.cliff, cc * 16, cr * 16, 16, 16, dx, dy, TS, TS);
  } else { ctx.fillStyle = '#7d6b53'; ctx.fillRect(dx, dy, TS, TS); }
}

// wooden bridge plank over the river (Bridge_Wood.png is 144x64; sample a plank cell)
function drawBridge(x, y, dx, dy) {
  if (ready(IMG.bridge)) {
    ctx.drawImage(IMG.bridge, 16, 16, 16, 16, dx, dy, TS, TS);
  } else {
    ctx.fillStyle = '#9c6b3f'; ctx.fillRect(dx, dy, TS, TS);
    ctx.fillStyle = '#7a4f2a'; for (let i = 0; i < TS; i += 6) ctx.fillRect(dx, dy + i, TS, 2);
  }
}

// shallow cobble ford the player can wade across
function drawFord(x, y, dx, dy) {
  ctx.fillStyle = 'rgba(180,220,235,0.45)'; ctx.fillRect(dx, dy, TS, TS); // shallow water sheen
  const stones = ['#9aa0a6', '#b9bec4', '#7c8187', '#cfd3d8'];
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = stones[Math.floor(tileRand(x, y, i * 2 + 30) * stones.length)];
    const sx = dx + 2 + tileRand(x, y, i * 2 + 31) * (TS - 8);
    const sy = dy + 2 + tileRand(x, y, i * 2 + 32) * (TS - 8);
    const r = 3 + tileRand(x, y, i + 33) * 3;
    ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.8, 0, 0, 7); ctx.fill();
  }
}

// falling water, drawn in front of the player so they vanish "behind" the falls
function drawWaterfalls(cx, cy) {
  game.waterfall.forEach(k => {
    const [x, y] = k.split(',').map(Number);
    const dx = x * TS - cx, dy = y * TS - cy;
    // dark recess behind
    ctx.fillStyle = 'rgba(18,30,40,0.55)'; ctx.fillRect(dx, dy, TS, TS);
    // streaks of falling water
    for (let i = 0; i < 4; i++) {
      const lane = dx + 4 + i * 11;
      const off = (game.anim * 90 + i * 13) % TS;
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.55)' : 'rgba(190,225,240,0.7)';
      ctx.lineWidth = 3; ctx.beginPath();
      ctx.moveTo(lane, dy + (off - 14)); ctx.lineTo(lane, dy + off + 6); ctx.stroke();
    }
    // foam where it lands (bottom edge)
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 4; i++) ctx.fillRect(dx + 2 + i * 12, dy + TS - 5 + (i % 2) * 2, 6, 3);
  });
}

function drawFishing(cx, cy) {
  if (!game.fishing.active) return;
  const f = game.fishing;
  const px = game.px - cx + TS / 2, py = game.py - cy + 6;
  const bx = f.tx * TS - cx + TS / 2, by = f.ty * TS - cy + TS / 2;
  const bob = f.state === 'bite' ? Math.sin(game.anim * 18) * 3 : Math.sin(game.anim * 3) * 1.5;
  ctx.strokeStyle = 'rgba(240,240,240,0.85)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(bx, by + bob); ctx.stroke();
  ctx.fillStyle = f.state === 'bite' ? '#ff4d4d' : '#fff';
  ctx.beginPath(); ctx.arc(bx, by + bob, 4, 0, 7); ctx.fill();
  ctx.strokeStyle = '#b33'; ctx.lineWidth = 1; ctx.stroke();
  if (f.state === 'bite') {
    ctx.fillStyle = '#fff'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
    ctx.fillText('!', bx, by - 10); ctx.textAlign = 'left';
  }
}

// occasional fish leaping from ponds/rivers — a little arc with a splash
function drawFishLeaps(cx, cy) {
  game.fishLeaps.forEach(f => {
    const p = f.t / f.dur;
    const baseX = f.x * TS - cx + TS / 2, baseY = f.y * TS - cy + TS / 2;
    const arc = Math.sin(Math.PI * p);
    const fx = baseX + f.dir * (p - 0.5) * TS * 0.7;
    const fy = baseY - arc * TS * 0.95;
    if (p < 0.28 || p > 0.72) {                       // splash rings at entry/exit
      const e = p < 0.28 ? p / 0.28 : (1 - p) / 0.28;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 * (1 - e)) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(baseX, baseY, 5 + e * 16, 3 + e * 4, 0, 0, 7); ctx.stroke();
    }
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(f.dir * (p - 0.5) * 1.5);
    ctx.fillStyle = '#a9c0d2'; ctx.beginPath(); ctx.ellipse(0, 0, 8, 3.5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#7c93a6'; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(-13, -4); ctx.lineTo(-13, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#eef4f8'; ctx.beginPath(); ctx.arc(4, -1, 1.4, 0, 7); ctx.fill();   // eye glint
    ctx.restore();
  });
}

// soft drifting mist that thickens toward the map edges (hides the world beyond)
function drawEdgeFog(cx, cy) {
  const depth = 3.4 * TS;
  const a = 0.72 + Math.sin(game.anim * 0.4) * 0.06;
  const col = (al) => 'rgba(226,231,240,' + al + ')';
  const W = canvas.width, H = canvas.height;
  const strip = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, col(a)); g.addColorStop(1, col(0));
    ctx.fillStyle = g; ctx.fillRect(rx, ry, rw, rh);
  };
  const left = 0 - cx, right = MAP_W * TS - cx, top = 0 - cy, bot = MAP_H * TS - cy;
  if (left + depth > 0)  strip(left, 0, left + depth, 0, left, 0, depth, H);
  if (right - depth < W) strip(right, 0, right - depth, 0, right - depth, 0, depth, H);
  if (top + depth > 0)   strip(0, top, 0, top + depth, 0, top, W, depth);
  if (bot - depth < H)   strip(0, bot, 0, bot - depth, 0, bot - depth, W, depth);
}

function drawFootsteps(cx, cy) {
  game.footsteps.forEach(f => {
    const p = f.t / f.dur, a = (1 - p);
    const x = f.x - cx, y = f.y - cy;
    if (f.type === 'water') {
      ctx.strokeStyle = 'rgba(210,235,250,' + (a * 0.8) + ')'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x, y, 3 + p * 8, 1.5 + p * 3, 0, 0, 7); ctx.stroke();
    } else if (f.type === 'path' || f.type === 'dirt') {
      ctx.fillStyle = 'rgba(150,120,80,' + (a * 0.5) + ')';
      ctx.beginPath(); ctx.ellipse(x, y, 3 + p * 5, 2 + p * 3, 0, 0, 7); ctx.fill();
    } else {  // grass: a couple of flicked blades
      ctx.strokeStyle = 'rgba(70,140,55,' + (a * 0.7) + ')'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x - 4, y - 3 - p * 2);
      ctx.moveTo(x + 2, y); ctx.lineTo(x + 4, y - 3 - p * 2); ctx.stroke();
    }
  });
}

function drawCritters(cx, cy) {
  game.critters.forEach(c => {
    const flap = 0.4 + 0.6 * Math.abs(Math.sin(game.anim * c.flutter + c.phase));
    const x = c.x - cx, y = c.y - cy + Math.sin(game.anim * c.flutter + c.phase) * c.amp;
    if (c.kind === 'butterfly') {
      ctx.fillStyle = c.col;
      ctx.beginPath(); ctx.ellipse(x - 3 * flap, y, 3.2, 4.6 * flap + 1.4, -0.5, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 3 * flap, y, 3.2, 4.6 * flap + 1.4, 0.5, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(40,30,30,0.7)'; ctx.fillRect(x - 0.7, y - 3, 1.4, 6);
    } else if (c.kind === 'bee') {
      ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.4 * flap) + ')';
      ctx.beginPath(); ctx.ellipse(x, y - 2, 2.6 * flap + 0.6, 1.6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = c.col; ctx.beginPath(); ctx.ellipse(x, y, 3.2, 2.4, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#3a2a14'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 1.5, y - 2); ctx.lineTo(x - 1.5, y + 2); ctx.moveTo(x + 1, y - 2); ctx.lineTo(x + 1, y + 2); ctx.stroke();
    } else {  // fly
      ctx.fillStyle = 'rgba(230,235,245,0.35)';
      ctx.beginPath(); ctx.arc(x - 1.6, y - 1, 1.3, 0, 7); ctx.arc(x + 1.6, y - 1, 1.3, 0, 7); ctx.fill();
      ctx.fillStyle = c.col; ctx.beginPath(); ctx.arc(x, y, 1.7, 0, 7); ctx.fill();
    }
  });
}

// shadow direction/length from the time of day (sun east in the morning -> shadow west, etc.)
function sunShadow() {
  const m = game.minutes % (24 * 60);
  if (m < 6 * 60 || m >= 20 * 60) return { sx: 0, len: 0.7, alpha: 0.12 };  // night: faint, round
  const slope = Math.max(-1, Math.min(1, (m - 780) / 420));                  // -1 dawn .. +1 dusk
  return { sx: slope, len: 0.7 + Math.abs(slope) * 1.7, alpha: 0.24 };
}
function drawShadow(fx, fy, w) {
  const s = sunShadow();
  ctx.fillStyle = 'rgba(0,0,0,' + s.alpha + ')';
  ctx.beginPath();
  ctx.ellipse(fx + s.sx * w * s.len * 0.5, fy, w * 0.5 * s.len, w * 0.22, 0, 0, 7);
  ctx.fill();
}

// crops are drawn procedurally so growth always reads clearly (easy to swap for art)
function drawCrop(c, dx, dy) {
  const def = CROPS[c.type];
  const frac = c.stage / (def.stages - 1);
  const cxp = dx + TS / 2;
  const baseY = dy + TS - 4;
  const h = 6 + frac * (TS - 12);
  // stem
  ctx.strokeStyle = def.leaf; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cxp, baseY); ctx.lineTo(cxp, baseY - h); ctx.stroke();
  // leaves
  ctx.fillStyle = def.leaf;
  const lw = 4 + frac * 8;
  ctx.beginPath(); ctx.ellipse(cxp - lw / 2, baseY - h * 0.5, lw / 2, 3, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(cxp + lw / 2, baseY - h * 0.6, lw / 2, 3, 0, 0, 7); ctx.fill();
  // ripe fruit
  if (c.stage >= def.stages - 1) {
    ctx.fillStyle = def.color;
    ctx.beginPath(); ctx.arc(cxp, baseY - h - 2, 6, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke();
  }
}

function drawObject(o, cx, cy) {
  const dx = o.x * TS - cx, dy = o.y * TS - cy;
  const sh = o.shake ? Math.sin(performance.now() / 20) * 3 : 0;
  if (o.shake) o.shake -= 1 / 60;
  switch (o.type) {
    case 'tree':
      drawShadow(dx + TS / 2, dy + TS - 4, TS * 0.95);
      // Oak_Tree.png is 64x80; anchor base to tile, sprite taller than tile
      if (ready(IMG.oakTree)) ctx.drawImage(IMG.oakTree, dx - TS / 2 + sh, dy - TS * 2.6, IMG.oakTree.width * SCALE, IMG.oakTree.height * SCALE);
      else fallbackBox(dx, dy, '#2e7d32');
      break;
    case 'rock':
      drawShadow(dx + TS / 2, dy + TS - 4, TS * 0.6);
      // a rock cell from the decor sheet (7 cols of 16px) -> pick a gray rock
      if (ready(IMG.decor)) ctx.drawImage(IMG.decor, 0, 48, 16, 16, dx + sh, dy, TS, TS);
      else fallbackBox(dx, dy, '#888');
      break;
    case 'sapling': {
      // a young tree that grows over a few days into a choppable oak
      const f = Math.min(1, (o.growth || 0) / SAPLING_DAYS);
      const cxp = dx + TS / 2, baseY = dy + TS - 3, h = 7 + f * 22;
      ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2 + f * 2;
      ctx.beginPath(); ctx.moveTo(cxp, baseY); ctx.lineTo(cxp, baseY - h); ctx.stroke();
      ctx.fillStyle = '#5aa84b';
      ctx.beginPath(); ctx.arc(cxp, baseY - h, 5 + f * 9, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.arc(cxp - 2, baseY - h - 2, 3 + f * 4, 0, 7); ctx.fill();
      break;
    }
    case 'house':
      if (ready(IMG.house)) ctx.drawImage(IMG.house, dx, dy, IMG.house.width * SCALE, IMG.house.height * SCALE);
      else fallbackBox(dx, dy, '#7a4', o.w * TS, o.h * TS);
      break;
    case 'home':
      drawHome(o, dx, dy); break;
    case 'fence': {
      if (ready(IMG.fences)) {
        const [cc, cr] = FENCE_TILES[fenceMask(o.x, o.y)] || [0, 3];
        ctx.drawImage(IMG.fences, cc * 16, cr * 16, 16, 16, dx, dy, TS, TS);
      } else fallbackBox(dx, dy, '#9c6b3f');
      break;
    }
    case 'chest':
      if (ready(IMG.chest)) ctx.drawImage(IMG.chest, 0, 0, 16, 16, dx, dy, TS, TS);
      else fallbackBox(dx, dy, '#b8860b');
      break;
    case 'bin':
      ctx.fillStyle = '#6b4f2a'; ctx.fillRect(dx + 4, dy + 6, TS - 8, TS - 10);
      ctx.fillStyle = '#caa05a'; ctx.fillRect(dx + 4, dy + 4, TS - 8, 6);
      label(dx + TS / 2, dy - 4, 'SHIP'); break;
    case 'bed':
      ctx.fillStyle = '#d35'; ctx.fillRect(dx + 2, dy - TS + 6, TS - 4, TS * 2 - 8);
      ctx.fillStyle = '#fff'; ctx.fillRect(dx + 4, dy - TS + 8, TS - 8, 10);
      label(dx + TS / 2, dy - TS - 2, 'BED'); break;
    case 'shop':
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(dx + TS / 2 - 2, dy, 4, TS);
      ctx.fillStyle = '#caa05a'; ctx.fillRect(dx - 4, dy - 8, TS + 8, 14);
      label(dx + TS / 2, dy - 12, 'SHOP'); break;
    case 'sign':
      ctx.fillStyle = '#6b4226'; ctx.fillRect(dx + TS / 2 - 2, dy + 6, 4, TS - 6);
      ctx.fillStyle = '#caa05a'; ctx.strokeStyle = '#6b3f1d'; ctx.lineWidth = 2;
      ctx.fillRect(dx - 6, dy - 6, TS + 12, 16); ctx.strokeRect(dx - 6, dy - 6, TS + 12, 16);
      label(dx + TS / 2, dy + 6, 'HARVEST HOLLOW'); break;
    case 'signpost': {
      // a post with a pointing board — bright if known, weathered grey if not
      ctx.fillStyle = '#6b4226'; ctx.fillRect(dx + TS / 2 - 3, dy - 4, 6, TS + 4);
      ctx.fillStyle = o.known ? '#caa05a' : '#9a948a';
      ctx.strokeStyle = '#5a3f24'; ctx.lineWidth = 2;
      ctx.fillRect(dx - 10, dy - 18, TS + 20, 16); ctx.strokeRect(dx - 10, dy - 18, TS + 20, 16);
      label(dx + TS / 2, dy - 22, o.known ? o.text.toUpperCase() : '???');
      break;
    }
    case 'jobboard': {
      ctx.fillStyle = '#6b4226'; ctx.fillRect(dx - 2, dy - 4, 5, TS + 4); ctx.fillRect(dx + TS - 3, dy - 4, 5, TS + 4);
      ctx.fillStyle = '#caa05a'; ctx.strokeStyle = '#5a3f24'; ctx.lineWidth = 2;
      ctx.fillRect(dx - 6, dy - 18, TS + 12, 22); ctx.strokeRect(dx - 6, dy - 18, TS + 12, 22);
      ctx.fillStyle = '#fff';                                        // pinned notes
      ctx.fillRect(dx - 2, dy - 15, 8, 9); ctx.fillRect(dx + 8, dy - 14, 8, 8); ctx.fillRect(dx + TS - 8, dy - 15, 7, 9);
      label(dx + TS / 2, dy - 22, 'JOBS'); break;
    }
    case 'reed': {
      ctx.strokeStyle = '#3f7f3a'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const bx = dx + TS / 2 + (i - 1) * 6, sway = Math.sin(game.anim * 1.3 + i + o.x) * 3;
        ctx.beginPath(); ctx.moveTo(bx, dy + TS - 2);
        ctx.quadraticCurveTo(bx + sway, dy + TS - 20, bx + sway, dy + TS - 30); ctx.stroke();
        ctx.fillStyle = '#7a4a26'; ctx.fillRect(bx + sway - 1.5, dy + TS - 34, 3, 9);   // cattail head
      }
      break;
    }
    case 'workbench': {
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(dx + 4, dy + TS * 0.45, TS - 8, TS * 0.5);   // bench top
      ctx.fillStyle = '#6b4226'; ctx.fillRect(dx + 6, dy + TS * 0.7, 5, TS * 0.3); ctx.fillRect(dx + TS - 11, dy + TS * 0.7, 5, TS * 0.3);
      ctx.fillStyle = '#cfd6dd'; ctx.fillRect(dx + 8, dy + TS * 0.4, 6, 5);                   // a saw/tool on it
      ctx.fillStyle = '#9c6b3f'; ctx.fillRect(dx + TS - 16, dy + TS * 0.38, 8, 7);
      label(dx + TS / 2, dy + TS * 0.4 - 2, 'CRAFT'); break;
    }
    case 'shed': {
      const W2 = 2 * TS, H2 = 2 * TS;
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(dx + 4, dy + H2 - 6, W2 - 8, 6);
      ctx.fillStyle = '#b07c3f'; ctx.fillRect(dx + 4, dy + H2 * 0.4, W2 - 8, H2 * 0.6 - 4);   // walls
      ctx.fillStyle = '#7a4a26'; ctx.beginPath();                                              // roof
      ctx.moveTo(dx, dy + H2 * 0.45); ctx.lineTo(dx + W2 / 2, dy + 6); ctx.lineTo(dx + W2, dy + H2 * 0.45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#5a3a1c'; ctx.fillRect(dx + W2 / 2 - 10, dy + H2 - 30, 20, 30);         // door
      label(dx + W2 / 2, dy + 2, 'TOOL SHED'); break;
    }
    case 'kitchen': {
      ctx.fillStyle = '#d8c4a0'; ctx.fillRect(dx + 4, dy + TS * 0.4, TS - 8, TS * 0.55);       // counter
      ctx.fillStyle = '#9c9c9c'; ctx.fillRect(dx + 8, dy + TS * 0.5, 14, 12);                   // stove
      ctx.fillStyle = '#ff9e57'; ctx.fillRect(dx + 11, dy + TS * 0.46, 8, 5);                   // pot/flame
      ctx.fillStyle = '#8fd0f6'; ctx.fillRect(dx + TS - 18, dy + TS * 0.52, 10, 9);             // basin
      label(dx + TS / 2, dy + TS * 0.4 - 2, 'KITCHEN'); break;
    }
    case 'store': {
      const W3 = 3 * TS, H3 = 3 * TS;
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(dx + 4, dy + H3 - 6, W3 - 8, 6);
      ctx.fillStyle = '#c9a46a'; ctx.fillRect(dx + 6, dy + H3 * 0.34, W3 - 12, H3 * 0.66 - 4);  // walls
      ctx.fillStyle = '#7a3f2a'; ctx.fillRect(dx, dy + H3 * 0.3, W3, 12);                        // awning
      ctx.fillStyle = '#e8d2a0'; for (let i = 0; i < 6; i++) ctx.fillRect(dx + i * (W3 / 6), dy + H3 * 0.3, W3 / 12, 12); // stripes
      ctx.fillStyle = '#5a3a1c'; ctx.fillRect(dx + W3 / 2 - 12, dy + H3 - 34, 24, 34);           // door
      ctx.fillStyle = '#8fd0f6'; ctx.fillRect(dx + 14, dy + H3 * 0.5, 16, 14); ctx.fillRect(dx + W3 - 30, dy + H3 * 0.5, 16, 14);
      label(dx + W3 / 2, dy + H3 * 0.3 - 4, 'GENERAL STORE'); break;
    }
    case 'villager': {
      const pdx = dx - (PDRAW - TS) / 2, pdy = dy - (PDRAW - TS);
      drawShadow(dx + TS / 2, dy + TS - 4, TS * 0.6);
      if (ready(IMG.player)) ctx.drawImage(IMG.player, 0, IDLE.down * PF, PF, PF, pdx, pdy, PDRAW, PDRAW);
      else { ctx.fillStyle = o.col || '#caa'; ctx.fillRect(dx + 20, dy + 30, 24, 34); }
      ctx.fillStyle = (o.col || '#caa') + ''; ctx.fillRect(pdx + PF, pdy + PF, PF, PF * 0.6);   // clothing tint
      label(dx + TS / 2, dy - 2, o.name || 'Villager'); break;
    }
    case 'parcel': {
      const bob = Math.sin(game.anim * 3) * 1.5;
      const py0 = dy + TS / 2 - 10 + bob;
      ctx.fillStyle = '#b58a52'; ctx.fillRect(dx + TS / 2 - 12, py0, 24, 20);
      ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 2; ctx.strokeRect(dx + TS / 2 - 12, py0, 24, 20);
      ctx.strokeStyle = '#9c2b2b'; ctx.beginPath();
      ctx.moveTo(dx + TS / 2, py0); ctx.lineTo(dx + TS / 2, py0 + 20);
      ctx.moveTo(dx + TS / 2 - 12, py0 + 7); ctx.lineTo(dx + TS / 2 + 12, py0 + 7); ctx.stroke();
      label(dx + TS / 2, py0 - 6, 'POST');
      break;
    }
    case 'frog': {
      const hop = Math.abs(Math.sin(game.anim * 0.8)) * 2;
      const fx = dx + TS / 2, fy = dy + TS / 2 - hop;
      ctx.fillStyle = '#4faa42'; ctx.beginPath(); ctx.ellipse(fx, fy, 6, 4, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#3f8f3a'; ctx.beginPath(); ctx.arc(fx - 4, fy - 3, 2.2, 0, 7); ctx.arc(fx + 4, fy - 3, 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(fx - 4, fy - 3, 1, 0, 7); ctx.arc(fx + 4, fy - 3, 1, 0, 7); ctx.fill();
      break;
    }
    case 'relic': {
      // a mysterious carved standing stone that pulses faintly
      const pulse = 0.5 + 0.5 * Math.sin(game.anim * 2);
      ctx.fillStyle = '#5b6b7a'; ctx.beginPath();
      ctx.moveTo(dx + 6, dy + TS); ctx.lineTo(dx + 10, dy + 4);
      ctx.lineTo(dx + TS - 10, dy + 4); ctx.lineTo(dx + TS - 6, dy + TS); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(120,200,255,' + (0.35 + 0.5 * pulse) + ')'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(dx + TS / 2, dy + TS / 2, 4, 0, 7); ctx.stroke();
      ctx.fillStyle = 'rgba(150,210,255,' + (0.15 + 0.25 * pulse) + ')';
      ctx.beginPath(); ctx.arc(dx + TS / 2, dy + TS / 2, 12 + pulse * 4, 0, 7); ctx.fill();
      break;
    }
  }
}

// the player's home, drawn differently per upgrade tier (original procedural art for
// the early tiers, the Cute Fantasy house sprite for the top tiers)
function drawHome(o, dx, dy) {
  const tier = o.tier, t = HOME_TIERS[tier];
  const W = t.w * TS, H = t.h * TS;
  const groundY = dy + H;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fillRect(dx + 4, groundY - 6, W - 8, 6);

  if (tier === 0) {
    // Basic Shelter: a worn floor mat, 4 stick posts, and a cloth roof slung overhead.
    ctx.fillStyle = 'rgba(120,90,55,0.35)'; ctx.fillRect(dx + 4, dy + 8, W - 8, H - 12);
    const postTop = (bx, by, h, lean) => {                 // a stick rising from the ground
      ctx.strokeStyle = '#6b4a28'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + lean, by - h); ctx.stroke();
      ctx.strokeStyle = '#8a6038'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + lean, by - h); ctx.stroke();
      return { x: bx + lean, y: by - h };
    };
    const bH = TS * 1.5, fH = TS * 1.05;                   // back posts taller than front
    const blT = postTop(dx + 8, dy + TS - 4, bH, 4);       // back-left
    const brT = postTop(dx + W - 8, dy + TS - 4, bH, -4);  // back-right
    const flT = postTop(dx + 8, groundY - 6, fH, 4);       // front-left
    const frT = postTop(dx + W - 8, groundY - 6, fH, -4);  // front-right
    // cloth roof sheet across the post tops (floats above the floor, doesn't hide fixtures)
    ctx.fillStyle = '#9c8a5a';
    ctx.beginPath(); ctx.moveTo(blT.x, blT.y); ctx.lineTo(brT.x, brT.y);
    ctx.lineTo(frT.x, frT.y + 4); ctx.lineTo(flT.x, flT.y + 4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#6b5a36'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;   // ridge highlight
    ctx.beginPath(); ctx.moveTo((blT.x + flT.x) / 2, (blT.y + flT.y) / 2); ctx.lineTo((brT.x + frT.x) / 2, (brT.y + frT.y) / 2); ctx.stroke();
  } else if (tier === 1 || tier === 2) {
    const col = tier === 1 ? '#c66a4a' : '#3f7a8c';
    ctx.fillStyle = col; ctx.beginPath();
    ctx.moveTo(dx + 2, groundY); ctx.lineTo(dx + W / 2, dy + 4); ctx.lineTo(dx + W - 2, groundY); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 2; ctx.stroke();
  } else if (tier === 3) {
    ctx.fillStyle = '#caa46a'; ctx.fillRect(dx + 6, dy + H * 0.42, W - 12, H * 0.58 - 4);
    ctx.fillStyle = '#8a5a2b'; ctx.beginPath();
    ctx.moveTo(dx + 2, dy + H * 0.46); ctx.lineTo(dx + W / 2, dy + 6); ctx.lineTo(dx + W - 2, dy + H * 0.46); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#5a3a1c'; ctx.fillRect(dx + W / 2 - 9, groundY - 26, 18, 26);
    ctx.fillStyle = '#8fd0f6'; ctx.fillRect(dx + 12, dy + H * 0.55, 12, 12);
  } else {
    if (ready(IMG.house)) {
      const iw = IMG.house.width * SCALE, ih = IMG.house.height * SCALE;
      ctx.drawImage(IMG.house, dx, dy + H - ih, iw, ih);
      if (tier === 5) {
        ctx.drawImage(IMG.house, dx + W - iw, dy + H - ih * 0.86, iw * 0.86, ih * 0.86);
        ctx.fillStyle = '#caa05a'; ctx.fillRect(dx, groundY - 8, W, 8);
      }
    } else fallbackBox(dx, dy, '#7a4', W, H);
  }

  // the usable bed + chest + order catalogue, at their fixture tiles (every tier)
  if (o.bed) drawBedAt(dx + (o.bed.x - o.x) * TS, dy + (o.bed.y - o.y) * TS);
  if (o.chest) drawChestAt(dx + (o.chest.x - o.x) * TS, dy + (o.chest.y - o.y) * TS);
  if (o.catalogue) drawCatalogueAt(dx + (o.catalogue.x - o.x) * TS, dy + (o.catalogue.y - o.y) * TS);

  label(dx + W / 2, dy - 4, t.name.toUpperCase());
}

function drawCatalogueAt(bx, by) {
  ctx.fillStyle = '#6b4226'; ctx.fillRect(bx + TS / 2 - 2, by + 12, 4, TS - 14);   // post
  ctx.fillStyle = '#caa05a'; ctx.fillRect(bx + TS / 2 - 12, by + 4, 24, 15);       // open booklet
  ctx.fillStyle = '#fff'; ctx.fillRect(bx + TS / 2 - 10, by + 6, 9, 11); ctx.fillRect(bx + TS / 2 + 1, by + 6, 9, 11);
  ctx.strokeStyle = '#5a3f24'; ctx.lineWidth = 1; ctx.strokeRect(bx + TS / 2 - 12, by + 4, 24, 15);
  label(bx + TS / 2, by - 2, 'CATALOGUE');
}

function drawBedAt(bx, by) {
  ctx.fillStyle = '#9c6b3f'; ctx.fillRect(bx + 3, by + 5, TS - 6, TS - 8);     // frame
  ctx.fillStyle = '#c97b8a'; ctx.fillRect(bx + 4, by + 9, TS - 8, TS - 13);    // blanket
  ctx.fillStyle = '#fff';    ctx.fillRect(bx + 4, by + 5, TS - 8, 6);          // pillow
  ctx.strokeStyle = '#5a3a1c'; ctx.lineWidth = 1; ctx.strokeRect(bx + 3, by + 5, TS - 6, TS - 8);
}
function drawChestAt(cx2, cy2) {
  if (ready(IMG.chest)) ctx.drawImage(IMG.chest, 0, 0, 16, 16, cx2 + 4, cy2 + 6, TS - 8, TS - 8);
  else {
    ctx.fillStyle = '#8a5a2b'; ctx.fillRect(cx2 + 5, cy2 + 8, TS - 10, TS - 12);
    ctx.fillStyle = '#caa05a'; ctx.fillRect(cx2 + 5, cy2 + 6, TS - 10, 6);
  }
}

function ready(img) { return img && img.complete && img.width; }
function fallbackBox(dx, dy, color, w = TS, h = TS) { ctx.fillStyle = color; ctx.fillRect(dx, dy, w, h); }
function label(x, y, text) {
  ctx.font = '10px monospace'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - text.length * 3 - 2, y - 9, text.length * 6 + 4, 11);
  ctx.fillStyle = '#fff'; ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

function drawPlayer(cx, cy) {
  drawShadow(game.px - cx + TS / 2, game.py - cy + TS - 4, TS * 0.62);   // time-of-day shadow
  const dx = game.px * 1 - cx - (PDRAW - TS) / 2;  // center 96px sprite over the 48px footprint
  const dy = game.py * 1 - cy - (PDRAW - TS);      // feet at footprint bottom
  const set = game.moving ? WALK : IDLE;
  let row = set.down, flip = false;
  if (game.facing === 'up') row = set.up;
  else if (game.facing === 'down') row = set.down;
  else { row = set.side; flip = (game.facing === 'left'); }
  const frame = game.moving ? game.animFrame : 0;

  if (ready(IMG.player)) {
    ctx.save();
    if (flip) { ctx.translate(dx + PDRAW, dy); ctx.scale(-1, 1); ctx.translate(-dx, -dy); }
    ctx.drawImage(IMG.player, frame * PF, row * PF, PF, PF, dx, dy, PDRAW, PDRAW);
    ctx.restore();
  } else {
    ctx.fillStyle = '#39c'; ctx.fillRect(dx + 30, dy + 40, 36, 50);
  }
  if (game.hitFlash > 0) { ctx.fillStyle = 'rgba(255,0,0,0.25)'; ctx.fillRect(dx + 24, dy + 24, 48, 64); }
}

function drawAnimal(a, cx, cy) {
  const img = a.kind === 'cow' ? IMG.cow : a.kind === 'chicken' ? IMG.chicken : IMG.pig;
  const dx = a.x - cx - (PF * SCALE - TS) / 2, dy = a.y - cy - (PF * SCALE - TS);
  if (ready(img)) {
    ctx.save();
    if (a.dir < 0) { ctx.translate(dx + PF * SCALE, dy); ctx.scale(-1, 1); ctx.translate(-dx, -dy); }
    ctx.drawImage(img, a.frame * 32, 0, 32, 32, dx, dy, PF * SCALE, PF * SCALE);
    ctx.restore();
  } else { fallbackBox(dx + 20, dy + 40, a.kind === 'chicken' ? '#fff' : '#ddd'); }
  if (a.produce) label(a.x - cx + TS / 2, dy + 28, a.kind === 'cow' ? 'milk' : 'egg');
}

// a hired worker: the character sprite + a coloured role banner so they read as staff
function drawNPC(e, cx, cy) {
  const dx = e.x - cx - (PDRAW - TS) / 2, dy = e.y - cy - (PDRAW - TS);
  let row = WALK.down, flip = false;
  if (e.dir < 0) { row = WALK.side; flip = true; } else if (Math.abs(e.vx) > Math.abs(e.vy)) { row = WALK.side; }
  if (ready(IMG.player)) {
    ctx.save();
    if (flip) { ctx.translate(dx + PDRAW, dy); ctx.scale(-1, 1); ctx.translate(-dx, -dy); }
    ctx.drawImage(IMG.player, (e.frame % 6) * PF, row * PF, PF, PF, dx, dy, PDRAW, PDRAW);
    ctx.restore();
    // tint overlay clipped to the sprite area, to distinguish from the player
    ctx.fillStyle = e.role === 'farmer' ? 'rgba(90,200,90,0.16)' : 'rgba(90,150,255,0.16)';
    ctx.fillRect(dx + PF, dy + PF, PF, PF * 1.5);
  } else { ctx.fillStyle = e.role === 'farmer' ? '#5a3' : '#36c'; ctx.fillRect(dx + 30, dy + 40, 36, 50); }
  // role banner above their head
  label(e.x - cx + TS / 2, dy + 30, (e.role === 'farmer' ? 'FARMER' : 'RANCHER') + ' L' + e.level);
}

function drawPostman(cx, cy) {
  const p = game.postman;
  const dx = p.x - cx - (PDRAW - TS) / 2, dy = p.y - cy - (PDRAW - TS);
  const flip = p.dir < 0;
  if (ready(IMG.player)) {
    ctx.save();
    if (flip) { ctx.translate(dx + PDRAW, dy); ctx.scale(-1, 1); ctx.translate(-dx, -dy); }
    ctx.drawImage(IMG.player, (p.frame % 6) * PF, WALK.side * PF, PF, PF, dx, dy, PDRAW, PDRAW);
    ctx.restore();
    ctx.fillStyle = 'rgba(70,110,220,0.2)'; ctx.fillRect(dx + PF, dy + PF, PF, PF * 1.5);  // blue post uniform tint
  } else { ctx.fillStyle = '#3a6'; ctx.fillRect(dx + 30, dy + 40, 36, 50); }
  label(p.x - cx + TS / 2, dy + 30, 'POST');
}

function drawSlime(e, cx, cy) {
  const dx = e.x - cx - (PF * SCALE - TS) / 2, dy = e.y - cy - (PF * SCALE - TS);
  if (ready(IMG.slime)) {
    // Slime_Green.png 512x192 -> assume 8 cols x 3 rows of ~64px frames; use row 0
    const fw = 64, fh = 64;
    ctx.drawImage(IMG.slime, (e.frame % 4) * fw, 0, fw, fh, dx, dy + TS, fw * SCALE / 2, fh * SCALE / 2);
  } else { ctx.fillStyle = e.hurt > 0 ? '#fff' : '#6c6'; ctx.beginPath(); ctx.arc(dx + 30, dy + TS + 30, 18, 0, 7); ctx.fill(); }
  if (e.hurt > 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(dx + 8, dy + TS + 6, 44, 40); }
  // hp bar
  ctx.fillStyle = '#000'; ctx.fillRect(dx + 8, dy + TS - 4, 44, 5);
  ctx.fillStyle = '#e44'; ctx.fillRect(dx + 9, dy + TS - 3, 42 * (e.hp / e.maxHp), 3);
}

function drawTargetHighlight(cx, cy) {
  const item = selectedItem();
  if (!item) return;
  if (!(TOOLS.includes(item) || item.startsWith('seed_'))) return;
  const { tx, ty } = facingTile();
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return;
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2;
  ctx.strokeRect(tx * TS - cx + 2, ty * TS - cy + 2, TS - 4, TS - 4);
}

// ----------------------------------------------------------------- HUD (DOM)
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hud = {
  clock: document.getElementById('clock'),
  day: document.getElementById('day'),
  gold: document.getElementById('gold'),
  energyBar: document.getElementById('energyBar'),
  healthBar: document.getElementById('healthBar'),
  hotbar: document.getElementById('hotbar'),
  msg: document.getElementById('msg'),
  dial: document.getElementById('dial'),
  pearls: document.getElementById('pearls'),
  emeralds: document.getElementById('emeralds'),
  minimap: document.getElementById('minimap'),
  farmLv: document.getElementById('farmLv'),
};
const dialCtx = hud.dial ? hud.dial.getContext('2d') : null;
const miniCtx = hud.minimap ? hud.minimap.getContext('2d') : null;
let hotbarBuilt = false;

function buildHotbar() {
  hud.hotbar.innerHTML = '';
  game.hotbar.forEach((item, i) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.dataset.i = i;
    slot.innerHTML =
      '<span class="num">' + ((i + 1) % 10) + '</span>' +
      '<canvas class="ic" width="48" height="48"></canvas>' +
      '<span class="cnt"></span>';
    slot.onclick = () => { game.selected = i; };
    hud.hotbar.appendChild(slot);
    const ic = slot.querySelector('.ic');
    drawItemIcon(ic.getContext('2d'), item);
  });
  hotbarBuilt = true;
}

// hand-drawn original tool/seed icons (no copied art) onto a 48x48 slot canvas
function drawItemIcon(c, item) {
  if (!c) return;
  c.clearRect(0, 0, 48, 48);
  c.imageSmoothingEnabled = false;
  c.lineCap = 'round'; c.lineJoin = 'round';
  if (!item) return;
  const wood = '#8a5a2b', woodHi = '#b07c3f', steel = '#cfd6dd', steelDk = '#8b939c';
  const handle = (x1, y1, x2, y2, w) => { c.strokeStyle = wood; c.lineWidth = w; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.strokeStyle = woodHi; c.lineWidth = Math.max(1, w - 3); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
  switch (item) {
    case 'sword': {
      c.strokeStyle = steel; c.lineWidth = 6; c.beginPath(); c.moveTo(11, 37); c.lineTo(36, 12); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(13, 35); c.lineTo(35, 13); c.stroke();
      c.strokeStyle = '#c9a23a'; c.lineWidth = 5; c.beginPath(); c.moveTo(7, 41); c.lineTo(15, 33); c.stroke(); // guard
      handle(7, 41, 11, 37, 6); break;
    }
    case 'wateringcan': {
      c.fillStyle = '#3f9bd6'; c.strokeStyle = '#23598a'; c.lineWidth = 2;
      c.beginPath(); c.roundRect(13, 20, 20, 18, 4); c.fill(); c.stroke();
      c.fillStyle = '#2d7fb8'; c.beginPath(); c.moveTo(33, 24); c.lineTo(44, 18); c.lineTo(44, 24); c.lineTo(33, 30); c.fill(); // spout
      c.strokeStyle = '#23598a'; c.lineWidth = 3; c.beginPath(); c.arc(23, 19, 7, Math.PI, 0); c.stroke(); // handle
      c.fillStyle = '#9fd2f0'; c.fillRect(15, 22, 5, 12); break;
    }
    case 'hoe': {
      handle(11, 38, 33, 14, 6);
      c.fillStyle = steel; c.strokeStyle = steelDk; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(31, 11); c.lineTo(40, 9); c.lineTo(41, 17); c.lineTo(33, 18); c.fill(); c.stroke(); break;
    }
    case 'pickaxe': {
      handle(24, 40, 24, 12, 6);
      c.strokeStyle = steel; c.lineWidth = 6; c.beginPath(); c.moveTo(9, 17); c.quadraticCurveTo(24, 8, 39, 17); c.stroke();
      c.strokeStyle = steelDk; c.lineWidth = 2; c.beginPath(); c.moveTo(9, 17); c.quadraticCurveTo(24, 10, 39, 17); c.stroke(); break;
    }
    case 'axe': {
      handle(14, 40, 30, 12, 6);
      c.fillStyle = steel; c.strokeStyle = steelDk; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(28, 9); c.quadraticCurveTo(42, 11, 38, 24); c.quadraticCurveTo(31, 20, 26, 15); c.fill(); c.stroke(); break;
    }
    case 'scythe': {
      handle(13, 39, 30, 14, 6);
      c.strokeStyle = steel; c.lineWidth = 5; c.beginPath(); c.arc(30, 16, 16, Math.PI * 1.1, Math.PI * 1.95); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(30, 16, 16, Math.PI * 1.1, Math.PI * 1.95); c.stroke(); break;
    }
    case 'sapling': {
      c.strokeStyle = '#7a5230'; c.lineWidth = 4; c.beginPath(); c.moveTo(24, 40); c.lineTo(24, 22); c.stroke();
      c.fillStyle = '#5aa84b'; c.beginPath(); c.arc(24, 18, 11, 0, 7); c.fill();
      c.fillStyle = '#76c95e'; c.beginPath(); c.arc(20, 16, 5, 0, 7); c.fill();
      break;
    }
    case 'fishingrod': {
      handle(10, 40, 36, 9, 5);                                 // rod
      c.strokeStyle = '#e8eef2'; c.lineWidth = 1.2;             // line
      c.beginPath(); c.moveTo(36, 9); c.lineTo(40, 34); c.stroke();
      c.fillStyle = '#ff4d4d'; c.beginPath(); c.arc(40, 35, 3.5, 0, 7); c.fill(); // bobber
      c.fillStyle = '#fff'; c.fillRect(38.5, 33.5, 3, 1.5);
      break;
    }
    default: {
      if (item.startsWith('seed_')) {
        const t = item.slice(5); const def = CROPS[t] || { color: '#cc8', leaf: '#5a4' };
        c.fillStyle = '#caa05a'; c.strokeStyle = '#7a5a2a'; c.lineWidth = 2;
        c.beginPath(); c.roundRect(14, 11, 20, 26, 3); c.fill(); c.stroke();      // packet
        c.fillStyle = def.leaf; c.fillRect(17, 15, 14, 9);                          // top band
        c.fillStyle = def.color; for (let s = 0; s < 4; s++) { c.beginPath(); c.arc(20 + (s % 2) * 8, 28 + Math.floor(s / 2) * 6, 2.4, 0, 7); c.fill(); }
      } else {
        c.fillStyle = '#caa05a'; c.font = '11px monospace'; c.textAlign = 'center';
        c.fillText((TOOL_LABEL[item] || item).slice(0, 6), 24, 27);
      }
    }
  }
}

function fmtClock() {
  let m = game.minutes % (24 * 60);
  let h = Math.floor(m / 60), mm = m % 60;
  mm = Math.floor(mm / 10) * 10;                  // 10-min ticks like the reference
  const ap = h >= 12 && h < 24 ? 'pm' : 'am';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return h12 + ':' + String(mm).padStart(2, '0') + ' ' + ap;
}

// circular day/night dial: sky color shifts with time, sun/moon arc across the top
function drawDial() {
  if (!dialCtx) return;
  const W = hud.dial.width, H = hud.dial.height, cx = W / 2, cy = H / 2, r = W / 2 - 3;
  dialCtx.clearRect(0, 0, W, H);
  const nt = nightTint();
  // sky gradient (day -> dusk -> night)
  const g = dialCtx.createLinearGradient(0, 0, 0, H);
  if (nt < 0.18) { g.addColorStop(0, '#8fd0f6'); g.addColorStop(1, '#cfeeff'); }
  else if (nt < 0.45) { g.addColorStop(0, '#f0a661'); g.addColorStop(1, '#ffd9a0'); }
  else { g.addColorStop(0, '#1d2350'); g.addColorStop(1, '#3a4a86'); }
  dialCtx.save();
  dialCtx.beginPath(); dialCtx.arc(cx, cy, r, 0, 7); dialCtx.closePath(); dialCtx.clip();
  dialCtx.fillStyle = g; dialCtx.fillRect(0, 0, W, H);
  // ground arc at the bottom
  dialCtx.fillStyle = nt > 0.45 ? '#243a22' : '#3f7a36'; dialCtx.fillRect(0, cy + r * 0.45, W, H);
  // sun/moon position: 6:00 -> left, 2:00am -> right, travelling over the top
  const t = Math.max(0, Math.min(1, (game.minutes - DAY_START) / (DAY_END - DAY_START)));
  const ang = Math.PI - t * Math.PI;             // PI (left) -> 0 (right)
  const ox = cx + Math.cos(ang) * r * 0.8, oy = (cy + r * 0.32) - Math.sin(ang) * r * 0.85;
  if (nt < 0.4) { dialCtx.fillStyle = '#ffe27a'; dialCtx.beginPath(); dialCtx.arc(ox, oy, 6, 0, 7); dialCtx.fill();
    dialCtx.strokeStyle = 'rgba(255,240,150,.5)'; dialCtx.lineWidth = 3; dialCtx.beginPath(); dialCtx.arc(ox, oy, 9, 0, 7); dialCtx.stroke(); }
  else { dialCtx.fillStyle = '#eef2ff'; dialCtx.beginPath(); dialCtx.arc(ox, oy, 6, 0, 7); dialCtx.fill();
    dialCtx.fillStyle = g; dialCtx.beginPath(); dialCtx.arc(ox + 3, oy - 2, 5, 0, 7); dialCtx.fill(); }
  dialCtx.restore();
  // wood rim
  dialCtx.strokeStyle = '#6b3f1d'; dialCtx.lineWidth = 4; dialCtx.beginPath(); dialCtx.arc(cx, cy, r, 0, 7); dialCtx.stroke();
  dialCtx.strokeStyle = '#caa05a'; dialCtx.lineWidth = 1.5; dialCtx.beginPath(); dialCtx.arc(cx, cy, r - 2, 0, 7); dialCtx.stroke();
}

function updateHUD() {
  if (!hotbarBuilt) buildHotbar();
  hud.clock.textContent = fmtClock();
  hud.day.textContent = WEEKDAYS[(game.day - 1) % 7] + '. ' + game.day;
  hud.gold.textContent = game.gold.toLocaleString();
  if (hud.pearls) hud.pearls.textContent = game.pearls;
  if (hud.emeralds) hud.emeralds.textContent = game.emeralds;
  if (hud.farmLv) hud.farmLv.textContent = 'Farm Lv ' + farmLevel();
  hud.energyBar.style.height = Math.max(0, game.energy / game.maxEnergy * 100) + '%';
  hud.healthBar.style.height = Math.max(0, game.health / game.maxHealth * 100) + '%';
  drawDial();
  drawMinimap();
  // hotbar slots
  [...hud.hotbar.children].forEach((slot, i) => {
    const item = game.hotbar[i];
    slot.classList.toggle('sel', i === game.selected);
    const cnt = slot.querySelector('.cnt');
    if (item && item.startsWith('seed_')) { const t = item.slice(5); cnt.textContent = (game.seeds[t] || 0); }
    else if (item === 'sapling') { cnt.textContent = (game.bag.sapling || 0); }
    else cnt.textContent = '';
  });
  hud.msg.textContent = game.messageTime > 0 ? game.message : '';
}

// scaled top-down minimap of the whole world + player + landmarks
function drawMinimap() {
  if (!miniCtx) return;
  const W = hud.minimap.width, H = hud.minimap.height;
  const sx = W / MAP_W, sy = H / MAP_H;
  miniCtx.clearRect(0, 0, W, H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const k = keyName(x, y);
      let c;
      if (!game.explored.has(k)) {
        c = '#2a2533';                                   // fog of war — undiscovered
      } else {
        c = '#4f9a3c';                                   // grass
        const g = game.ground[y][x];
        if (g === 'water') c = game.waterType[k] === 'river' ? '#3f8fd0' : '#2f74c0';
        else if (g === 'path') c = '#c2a06a';
        if (game.cliff.has(k)) c = '#8a7a5c';
        if (game.bridges.has(k) || game.fords.has(k)) c = '#b98a4a';
        if (game.tilled.has(k)) c = '#7a5128';
      }
      miniCtx.fillStyle = c;
      miniCtx.fillRect(x * sx, y * sy, Math.ceil(sx), Math.ceil(sy));
    }
  }
  // landmarks (only once discovered)
  const dot = (x, y, col, r = 2) => {
    if (!game.explored.has(keyName(x, y))) return;
    miniCtx.fillStyle = col; miniCtx.beginPath();
    miniCtx.arc((x + 0.5) * sx, (y + 0.5) * sy, r, 0, 7); miniCtx.fill();
  };
  game.objects.forEach(o => {
    if (o.type === 'home') dot(o.x + 1, o.y + 1, '#ffcf5a', 2.5);
    else if (o.type === 'shop') dot(o.x, o.y, '#ff8f3a');
    else if (o.type === 'bin') dot(o.x, o.y, '#caa05a');
    else if (o.type === 'relic' && game.secretFound) dot(o.x, o.y, '#7fdfff', 2.5);
  });
  // player
  const px = (game.px / TS + 0.5) * sx, py = (game.py / TS + 0.5) * sy;
  miniCtx.fillStyle = '#fff'; miniCtx.strokeStyle = '#000'; miniCtx.lineWidth = 1;
  miniCtx.beginPath(); miniCtx.arc(px, py, 2.6, 0, 7); miniCtx.fill(); miniCtx.stroke();
}

// ---- build menu (home upgrades) ----
function openBuildMenu() {
  const panel = document.getElementById('buildMenu'); if (!panel) return;
  game.buildMenuOpen = true; game.paused = true;
  renderBuildMenu(); panel.style.display = 'block';
}
function closeBuildMenu() {
  const panel = document.getElementById('buildMenu'); if (!panel) return;
  game.buildMenuOpen = false; game.paused = false; panel.style.display = 'none';
}
function renderBuildMenu() {
  const body = document.getElementById('bmBody'); if (!body) return;
  const h = homeObj(); const cur = HOME_TIERS[h.tier]; const next = HOME_TIERS[h.tier + 1];
  const upBtn = document.getElementById('bmUpgrade');
  if (!next) {
    body.innerHTML = '<p>Your home is a fully-built <b>Ranch</b> — the top tier!</p>';
    if (upBtn) upBtn.style.display = 'none';
    return;
  }
  const rows = Object.entries(next.cost).map(([k, v]) => {
    const have = haveAmount(k); const ok = have >= v;
    const nm = { coins: 'Coins', pearls: 'Pearls', emeralds: 'Emeralds', wood: 'Wood', stone: 'Stone' }[k] || k;
    return '<div class="bmcost ' + (ok ? 'ok' : 'no') + '">' + nm + ': ' + have + ' / ' + v + '</div>';
  }).join('');
  body.innerHTML =
    '<p>Current: <b>' + cur.name + '</b></p>' +
    '<p>Upgrade to: <b>' + next.name + '</b></p>' +
    '<div class="bmcosts">' + rows + '</div>';
  if (upBtn) { upBtn.style.display = ''; upBtn.disabled = !canAfford(next.cost); }
}

// ---- hire / manage workers menu ----
function openHireMenu() {
  const p = document.getElementById('hireMenu'); if (!p) return;
  game.hireMenuOpen = true; game.paused = true; renderHireMenu(); p.style.display = 'flex';
}
function closeHireMenu() {
  const p = document.getElementById('hireMenu'); if (!p) return;
  game.hireMenuOpen = false; game.paused = false; p.style.display = 'none';
}
function renderHireMenu() {
  const body = document.getElementById('hmBody'); if (!body) return;
  const lv = farmLevel();
  let html = '<p class="hmlv">Farm Level <b>' + lv + '</b> &middot; <span class="coinc">' + game.gold.toLocaleString() + ' coins</span></p>';
  // current staff
  html += '<h3>Your workers</h3>';
  if (!game.employees.length) html += '<p class="dim">None yet. Hire someone below.</p>';
  game.employees.forEach(e => {
    const maxed = e.level >= e.cap;
    const cost = empUpgradeCost(e);
    html += '<div class="hmrow"><span>' + ROLE_INFO[e.role].name + ' (' + e.tier + ') &middot; Lv ' + e.level + '/' + e.cap + '</span>'
      + '<span class="hmbtns">'
      + '<button data-up="' + e.id + '"' + (maxed ? ' disabled title="maxed for this tier"' : '') + '>' + (maxed ? 'Max' : 'Train ' + cost) + '</button>'
      + '<button class="danger" data-dis="' + e.id + '">Dismiss</button>'
      + '</span></div>';
  });
  // candidates
  html += '<h3>Available from the towns</h3>';
  HIRE_POOL.forEach((c, i) => {
    const locked = lv < c.minFarmLv;
    html += '<div class="hmrow' + (locked ? ' locked' : '') + '"><span>' + c.tier + ' — ' + ROLE_INFO[c.role].desc
      + ' <span class="dim">(max Lv ' + c.cap + ')</span></span>'
      + '<span class="hmbtns">'
      + (locked ? '<span class="dim">Farm Lv ' + c.minFarmLv + '</span>'
                : '<button data-hire="' + i + '">Hire &middot; ' + c.hire + ' ' + CUR_NAME[c.cur] + '</button>')
      + '</span></div>';
  });
  body.innerHTML = html;
  body.querySelectorAll('[data-hire]').forEach(b => b.addEventListener('click', () => { if (hireCandidate(+b.dataset.hire)) renderHireMenu(); }));
  body.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', () => { if (upgradeEmployee(+b.dataset.up)) renderHireMenu(); }));
  body.querySelectorAll('[data-dis]').forEach(b => b.addEventListener('click', () => { dismissEmployee(+b.dataset.dis); renderHireMenu(); }));
}

// ---- mail-order catalogue menu ----
function openCatalogue() {
  const p = document.getElementById('catMenu'); if (!p) return;
  game.catalogueOpen = true; game.paused = true; renderCatalogue(); p.style.display = 'flex';
}
function closeCatalogue() {
  const p = document.getElementById('catMenu'); if (!p) return;
  game.catalogueOpen = false; game.paused = false; p.style.display = 'none';
}
function renderCatalogue() {
  const body = document.getElementById('catBody'); if (!body) return;
  const pend = game.pendingOrders.reduce((n, o) => n + o.qty, 0);
  let html = '<p class="hmlv">Coins: <b class="coinc">' + game.gold.toLocaleString() + '</b>'
    + ' &middot; next post in <b>' + daysUntilPost() + '</b> day(s)</p>';
  html += '<p class="dim">Order now — the postman delivers to your tent on the next Wednesday.</p>';
  CATALOGUE.forEach((it, i) => {
    const afford = game.gold >= it.price;
    html += '<div class="hmrow"><span>' + it.name + ' <span class="dim">' + it.price + ' coins</span></span>'
      + '<span class="hmbtns"><button data-order="' + i + '"' + (afford ? '' : ' disabled') + '>Order</button></span></div>';
  });
  if (pend) {
    html += '<h3>On its way</h3>';
    html += game.pendingOrders.map(o => '<div class="hmrow"><span>' + o.name + ' &times; ' + o.qty + '</span></div>').join('');
  }
  body.innerHTML = html;
  body.querySelectorAll('[data-order]').forEach(b => b.addEventListener('click', () => { if (orderItem(+b.dataset.order)) renderCatalogue(); }));
}

// ---- crafting menu ----
function openCraftMenu() {
  const p = document.getElementById('craftMenu'); if (!p) return;
  game.craftMenuOpen = true; game.paused = true; renderCraftMenu(); p.style.display = 'flex';
}
function closeCraftMenu() {
  const p = document.getElementById('craftMenu'); if (!p) return;
  game.craftMenuOpen = false; game.paused = false; p.style.display = 'none';
}
function renderCraftMenu() {
  const body = document.getElementById('crBody'); if (!body) return;
  const matName = { wood: 'Wood', stone: 'Stone', coins: 'Coins' };
  let html = '<p class="hmlv">Wood: <b>' + (game.bag.wood || 0) + '</b> &middot; Stone: <b>' + (game.bag.stone || 0) + '</b> &middot; Coins: <b class="coinc">' + game.gold.toLocaleString() + '</b></p>';
  ['carpentry', 'toolsmithing'].forEach(area => {
    const learned = skillLearned(area);
    html += '<h3>' + area.charAt(0).toUpperCase() + area.slice(1)
      + (learned ? ' <span class="dim">(self-taught — no fee)</span>' : ' <span class="dim">(crafter does it for a fee)</span>') + '</h3>';
    const recs = CRAFT_RECIPES.filter(r => r.area === area);
    recs.forEach(r => {
      const matStr = Object.entries(r.mats).map(([k, v]) => v + ' ' + (matName[k] || k)).join(', ');
      const fee = recipeFee(r);
      const lvl = r.tool ? ' <span class="dim">(Lv ' + (game.toolLevel[r.tool] || 1) + '/' + TOOL_MAX + ')</span>' : '';
      let right;
      if (!recipeAvailable(r)) {
        right = '<span class="dim">' + (r.needsShed && !game.shedBuilt ? 'needs Shed' : (r.tool ? 'maxed' : 'done')) + '</span>';
      } else {
        right = '<button data-craft="' + r.id + '"' + (canCraft(r) ? '' : ' disabled') + '>Craft</button>';
      }
      html += '<div class="hmrow"><span>' + r.name + lvl + '<br><span class="dim">' + matStr + (fee ? ' + ' + fee + ' coins fee' : '') + '</span></span>'
        + '<span class="hmbtns">' + right + '</span></div>';
    });
  });
  body.innerHTML = html;
  body.querySelectorAll('[data-craft]').forEach(b => b.addEventListener('click', () => { if (craftRecipe(b.dataset.craft)) renderCraftMenu(); }));
}

// ---- kitchen (artisan processing) menu ----
function openKitchenMenu() {
  const p = document.getElementById('kitchenMenu'); if (!p) return;
  game.kitchenMenuOpen = true; game.paused = true; renderKitchenMenu(); p.style.display = 'flex';
}
function closeKitchenMenu() {
  const p = document.getElementById('kitchenMenu'); if (!p) return;
  game.kitchenMenuOpen = false; game.paused = false; p.style.display = 'none';
}
function renderKitchenMenu() {
  const body = document.getElementById('kitBody'); if (!body) return;
  let html = '<p class="dim">Turn raw goods into artisan products worth far more at market.</p>';
  ARTISAN.forEach((a, i) => {
    const have = game.bag[a.in] || 0;
    html += '<div class="hmrow"><span>' + a.in.charAt(0).toUpperCase() + a.in.slice(1) + ' &rarr; <b>' + a.out + '</b>'
      + ' <span class="dim">(' + a.sell + ' coins · you have ' + have + ')</span></span>'
      + '<span class="hmbtns"><button data-make="' + i + '"' + (have > 0 ? '' : ' disabled') + '>Make</button></span></div>';
  });
  body.innerHTML = html;
  body.querySelectorAll('[data-make]').forEach(b => b.addEventListener('click', () => { if (processItem(+b.dataset.make)) renderKitchenMenu(); }));
}

// ---- village general store (instant buy/sell, better prices than home) ----
const STORE_SELL_MULT = 1.15;
function storeSellAll() {
  let total = 0, count = 0;
  for (const it in game.bag) {
    if (SELLABLE[it]) { total += Math.round(SELLABLE[it] * STORE_SELL_MULT) * game.bag[it]; count += game.bag[it]; delete game.bag[it]; }
  }
  game.gold += total; game.farmXP += total;
  toast(count ? 'Sold ' + count + ' goods for ' + total + ' coins (town price).' : 'Nothing to sell.', 4);
}
function storeBuySeed(idx) {
  const it = CATALOGUE[idx]; if (!it) return false;
  const price = modePrice(it.price);
  if (game.gold < price) { toast('Not enough coins for ' + it.name + '.'); return false; }
  game.gold -= price; game.seeds[it.key] = (game.seeds[it.key] || 0) + 1;
  toast('Bought ' + it.name + '.', 3); return true;
}
function openStoreMenu() {
  const p = document.getElementById('storeMenu'); if (!p) return;
  game.storeMenuOpen = true; game.paused = true; renderStoreMenu(); p.style.display = 'flex';
}
function closeStoreMenu() {
  const p = document.getElementById('storeMenu'); if (!p) return;
  game.storeMenuOpen = false; game.paused = false; p.style.display = 'none';
}
function renderStoreMenu() {
  const body = document.getElementById('stBody'); if (!body) return;
  let html = '<p class="hmlv">Coins: <b class="coinc">' + game.gold.toLocaleString() + '</b></p>';
  html += '<h3>Buy seeds (delivered now)</h3>';
  CATALOGUE.forEach((it, i) => {
    html += '<div class="hmrow"><span>' + it.name + ' <span class="dim">' + it.price + ' coins</span></span>'
      + '<span class="hmbtns"><button data-buy="' + i + '"' + (game.gold >= it.price ? '' : ' disabled') + '>Buy</button></span></div>';
  });
  html += '<h3>Sell</h3><div class="hmrow"><span>Sell all goods <span class="dim">(+15% vs home bin)</span></span>'
    + '<span class="hmbtns"><button data-sellall="1">Sell all</button></span></div>';
  body.innerHTML = html;
  body.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => { if (storeBuySeed(+b.dataset.buy)) renderStoreMenu(); }));
  body.querySelectorAll('[data-sellall]').forEach(b => b.addEventListener('click', () => { storeSellAll(); renderStoreMenu(); }));
}

// ---- pause / options menu ----
function togglePauseMenu() {
  if (!game.started) return;                 // ignore before the game has started
  if (game.buildMenuOpen) return;
  game.pauseMenuOpen ? closePauseMenu() : openPauseMenu();
}
function openPauseMenu() {
  const p = document.getElementById('pauseMenu'); if (!p) return;
  game.pauseMenuOpen = true; game.paused = true;
  const opt = document.getElementById('pmOptions'); if (opt) opt.style.display = 'none';
  p.style.display = 'flex';
}
function closePauseMenu() {
  const p = document.getElementById('pauseMenu'); if (!p) return;
  game.pauseMenuOpen = false; game.paused = false; p.style.display = 'none';
}
function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  } catch (e) { /* not supported */ }
}
function resetSave() {
  try { localStorage.removeItem('harvest_hollow_save'); } catch (e) {}
  location.reload();
}
function setMode(m) {
  game.mode = (m === 'explorer') ? 'explorer' : 'adventurer';
  const ea = document.getElementById('modeAdv'), ee = document.getElementById('modeExp');
  if (ea) ea.classList.toggle('sel', !isExplorer());
  if (ee) ee.classList.toggle('sel', isExplorer());
}
function toggleMode() {
  setMode(isExplorer() ? 'adventurer' : 'explorer');
  toast('Mode: ' + (isExplorer() ? 'Explorer — faster, cheaper, more loot' : 'Adventurer — normal'), 5);
  saveGame();
}
// fetch the latest version (refresh the service worker cache) WITHOUT wiping the save
function updateGame() {
  saveGame();                       // keep all current progress (lives in localStorage)
  toast('Updating to the latest version — your save is kept...', 4);
  try {
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (!reg) { location.reload(); return; }
        let done = false;
        const go = () => { if (!done) { done = true; location.reload(); } };
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (nw) nw.addEventListener('statechange', () => { if (nw.state === 'installed' || nw.state === 'activated') go(); });
        });
        reg.update().catch(() => {});
        setTimeout(go, 2000);       // fallback if already up to date / no SW change
      }).catch(() => location.reload());
    } else location.reload();
  } catch (e) { location.reload(); }
}
function bindPauseMenu() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) { el.addEventListener('click', fn); } };
  on('pauseBtn', togglePauseMenu);
  on('pmResume', closePauseMenu);
  on('pmOptionsBtn', () => { const o = document.getElementById('pmOptions'); if (o) o.style.display = (o.style.display === 'none' ? 'block' : 'none'); });
  on('pmMinimap', () => document.body.classList.toggle('hidemap'));
  on('pmFullscreen', toggleFullscreen);
  on('pmMode', toggleMode);
  on('pmUpdate', updateGame);
  on('modeAdv', () => setMode('adventurer'));   // loading-screen mode picker
  on('modeExp', () => setMode('explorer'));
  on('pmSave', () => { saveGame(); toast('Game saved.'); closePauseMenu(); });
  on('pmReset', () => { if (window.confirm('Start over? This erases your saved game.')) resetSave(); });
}

// ---- intro loading screen ----
let loaderReady = null, gameRestored = false;
function startLoaderAnim() {
  const bar = document.getElementById('loadBar');
  if (bar) { bar.style.width = '8%'; setTimeout(() => { bar.style.width = '88%'; }, 60); }
}
function finishLoader(restored) {
  gameRestored = restored;
  const bar = document.getElementById('loadBar'); if (bar) bar.style.width = '100%';
  const play = document.getElementById('playBtn'); const tip = document.getElementById('loadTip');
  if (tip) tip.textContent = 'Ready!';
  if (play) { play.style.display = 'inline-block'; play.addEventListener('click', startGameLoop); }
}
function startGameLoop() {
  if (game.started) return;
  game.started = true;
  const loader = document.getElementById('loader'); if (loader) loader.style.display = 'none';
  if (!gameRestored) {
    toast('Welcome to Harvest Hollow. You came chasing a rumor of Sandy Cove — a place that hides from those who simply look. Tend the land, explore, and the way will show itself...', 11);
  }
  requestAnimationFrame(loop);
}

// ----------------------------------------------------------------- BOOT
function resize() {
  // fill the visible viewport (use the dynamic viewport so the mobile URL bar
  // doesn't push the canvas off-centre); cap only so desktop isn't enormous
  const vw = Math.round((window.visualViewport && window.visualViewport.width) || window.innerWidth);
  const vh = Math.round((window.visualViewport && window.visualViewport.height) || window.innerHeight);
  canvas.width = Math.min(vw, 1600);
  canvas.height = Math.min(vh, 1000);
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);

let last = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0);
  last = t;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function bindBuildMenu() {
  const up = document.getElementById('bmUpgrade'), cl = document.getElementById('bmClose');
  if (up) up.addEventListener('click', () => { if (upgradeHome()) renderBuildMenu(); });
  if (cl) cl.addEventListener('click', closeBuildMenu);
  const hc = document.getElementById('hmClose');
  if (hc) hc.addEventListener('click', closeHireMenu);
  const cc = document.getElementById('catClose');
  if (cc) cc.addEventListener('click', closeCatalogue);
  const rc = document.getElementById('crClose');
  if (rc) rc.addEventListener('click', closeCraftMenu);
  const kc = document.getElementById('kitClose');
  if (kc) kc.addEventListener('click', closeKitchenMenu);
  const sc = document.getElementById('stClose');
  if (sc) sc.addEventListener('click', closeStoreMenu);
}

async function boot() {
  resize();
  startLoaderAnim();
  await loadAssets();
  genWorld();
  const restored = loadGame();   // restore if a save exists
  buildHotbar();
  bindBuildMenu();
  bindPauseMenu();
  render();                      // draw one frame behind the loader so it's ready
  finishLoader(restored);        // reveal the Play button; the loop starts on click
}

// expose a tiny API for headless logic testing (Node) without touching the DOM
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CROPS, game, advanceDay, fmtClockTest: fmtClock,
                     genWorld, update, render, doAction, mulberry32,
                     fenceMask, FENCE_TILES, startFishing, catchFish, tryInteract,
                     POND_FISH, RIVER_FISH, keyName,
                     HOME_TIERS, upgradeHome, canAfford, homeObj,
                     plantSapling, SAPLING_DAYS,
                     farmLevel, HIRE_POOL, hireCandidate, upgradeEmployee, dismissEmployee,
                     applyEmployees, empUpgradeCost, TS, SCALE, markExplored, updateFishLeaps,
                     CATALOGUE, orderItem, deliverPost, collectMail, isPostDay, daysUntilPost,
                     CRAFT_RECIPES, craftRecipe, canCraft, skillLearned, recipeFee, recipeAvailable,
                     toolPower, TOOL_MAX, LEARN_THRESHOLD,
                     ARTISAN, processItem, genVillage, travelTo, storeBuySeed, storeSellAll,
                     setMode, isExplorer, modeSpeed, priceMult, lootMult, MAP_W };
}

boot();

})();
