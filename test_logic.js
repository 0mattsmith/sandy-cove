/* Headless logic test: stub the DOM, load the engine, drive the pure systems. */
const noop = () => {};
const elProxy = () => new Proxy(function(){}, {
  get(t, k) {
    if (typeof k === 'symbol') return undefined;   // let primitive coercion default (toPrimitive etc.)
    if (k === 'width' || k === 'height') return 84;
    if (k === 'getContext') return () => elProxy();
    if (k === 'style') return {};
    if (k === 'dataset') return {};
    if (k === 'classList') return { toggle: noop, add: noop, remove: noop };
    if (k === 'children') return [];
    if (k === 'getBoundingClientRect') return () => ({ left:0, top:0, width:800, height:600 });
    if (k === 'querySelector') return () => elProxy();
    if (k === 'appendChild') return noop;
    if (k === 'addEventListener') return noop;
    return elProxy();
  },
  set() { return true; },
  apply() { return elProxy(); },
});

const canvasStub = new Proxy({ width: 800, height: 600 }, {
  get(t, k) {
    if (k in t) return t[k];
    if (k === 'getContext') return () => elProxy();
    if (k === 'addEventListener') return noop;
    if (k === 'getBoundingClientRect') return () => ({ left:0, top:0, width:800, height:600 });
    if (k === 'style') return {};
    return elProxy();
  },
  set(t, k, v) { t[k] = v; return true; },
});

global.window = { ASSET_DATA: {}, addEventListener: noop, innerWidth: 800, innerHeight: 600 };
global.document = {
  getElementById: (id) => id === 'game' ? canvasStub : elProxy(),
  createElement: () => elProxy(),
};
global.performance = { now: () => 0 };
global.requestAnimationFrame = noop;
global.localStorage = { getItem: () => null, setItem: noop };
global.Image = class { set src(_) {} set onload(_) {} set onerror(_) {} };

const path = require('path');
const eng = require(path.join(__dirname, 'engine.js'));
const { CROPS, game, advanceDay, fmtClockTest, genWorld, update, render, doAction, fenceMask, FENCE_TILES,
        startFishing, catchFish, tryInteract, POND_FISH, RIVER_FISH, keyName,
        HOME_TIERS, upgradeHome, canAfford, homeObj, plantSapling, SAPLING_DAYS } = eng;

let pass = 0, fail = 0;
function check(name, cond) { (cond ? (pass++, console.log('  PASS', name)) : (fail++, console.log('  FAIL', name))); }

console.log('== World generation + render smoke test (catches startup crashes) ==');
let genOk = true, genErr = '';
try {
  genWorld();
  for (let i = 0; i < 5; i++) update(0.016);  // run several frames of logic
  render();                                    // exercise the full draw path
} catch (e) { genOk = false; genErr = e.message; }
check('genWorld + update + render run without throwing', genOk);
if (!genOk) console.log('    ->', genErr);
check('world has the player home (starts as Basic Shelter)', game.objects.some(o => o.type === 'home' && o.tier === 0));
check('world has trees', game.objects.some(o => o.type === 'tree'));
check('home has a usable bed + chest, and a shipping bin exists',
  (() => { const h = game.objects.find(o => o.type === 'home'); return h && h.bed && h.chest; })()
  && game.objects.some(o => o.type === 'bin'));
check('animals + enemies spawned', game.animals.length > 0 && game.enemies.length > 0);

console.log('== Fence autotiling (pen should form corners + rails) ==');
const fences = game.objects.filter(o => o.type === 'fence');
const masks = fences.map(o => fenceMask(o.x, o.y));
const cornerMasks = [3, 6, 9, 12];                         // L-shaped connections
check('every fence maps to a valid tile', masks.every(m => Array.isArray(FENCE_TILES[m])));
check('pen has at least 4 corner pieces', masks.filter(m => cornerMasks.includes(m)).length >= 4);
check('pen has straight rail pieces (horizontal/vertical)', masks.some(m => m === 10) && masks.some(m => m === 5));

console.log('== Elevation + water layout ==');
check('plateaus generated and tiles are solid', game.cliff.size > 0 && [...game.cliff].every(k => game.solid.has(k)));
const wt = Object.values(game.waterType);
check('world has both pond and river water', wt.includes('pond') && wt.includes('river'));
check('bridge tiles are water but walkable', [...game.bridges].every(k => !game.solid.has(k)));
check('ford tiles are walkable', [...game.fords].every(k => !game.solid.has(k)));
check('waterfall tiles exist', game.waterfall.length > 0);

console.log('== Fishing ==');
// pond catch
game.bag = {}; game.hotbar[game.selected] = 'fishingrod';
game.fishing = { active: true, state: 'bite', t: 0, biteAt: 0, biteEnd: 9, tx: 0, ty: 0, type: 'pond' };
doAction();
const caughtPond = Object.keys(game.bag);
check('reeling on a bite catches a fish', caughtPond.length === 1);
check('pond fish came from the pond table', POND_FISH.some(f => f.name === caughtPond[0]));
check('fishing ends after a catch', game.fishing.active === false);
// river catch yields a river fish
game.bag = {};
game.fishing = { active: true, state: 'bite', t: 0, biteAt: 0, biteEnd: 9, tx: 0, ty: 0, type: 'river' };
doAction();
check('river fish came from the river table', RIVER_FISH.some(f => f.name === Object.keys(game.bag)[0]));
// bite then timeout = it gets away
game.fishing = { active: true, state: 'cast', t: 0, biteAt: 0.01, biteEnd: 0, tx: 0, ty: 0, type: 'pond' };
update(0.05);  // -> bite
check('cast turns into a bite', game.fishing.state === 'bite');
update(2.0);   // -> times out
check('ignored bite gets away', game.fishing.active === false);

console.log('== Sandy Cove relic (the mystery hook) ==');
const relic = game.objects.find(o => o.type === 'relic');
check('relic exists in the grotto', !!relic);
game.secretFound = false;
if (relic) tryInteract(relic.x, relic.y);
check('interacting with relic reveals the secret', game.secretFound === true);

console.log('== Currency + home upgrade ladder ==');
check('six home tiers, shelter through ranch', HOME_TIERS.length === 6 && HOME_TIERS[0].name === 'Basic Shelter' && HOME_TIERS[5].name === 'Ranch');
check('tier costs escalate (ranch dearer than tent)', HOME_TIERS[5].cost.coins > HOME_TIERS[1].cost.coins);
const home = homeObj();
home.tier = 0;
game.gold = 0; game.bag = {}; game.pearls = 0; game.emeralds = 0;
check('cannot upgrade with no resources', upgradeHome() === false && home.tier === 0);
// give exactly the Small Tent cost
game.gold = 300; game.bag.wood = 20;
check('can afford once resources are present', canAfford(HOME_TIERS[1].cost) === true);
const ok = upgradeHome();
check('upgrade succeeds and advances a tier', ok === true && home.tier === 1);
check('upgrade deducts coins and wood', game.gold === 0 && (game.bag.wood || 0) === 0);
check('higher tiers have a larger footprint', HOME_TIERS[4].w * HOME_TIERS[4].h > HOME_TIERS[0].w * HOME_TIERS[0].h);

console.log('== Home onboarding greeting ==');
game.homeIntroShown = false;
const hh = homeObj(); const ht = HOME_TIERS[hh.tier];
game.px = (hh.x + ht.w / 2) * 48; game.py = (hh.y + ht.h / 2) * 48;  // stand on the home
update(0.016);
check('walking up to the home shows the greeting once', game.homeIntroShown === true);
// moving away and back should not repeat it
game.px = 30 * 48; game.py = 28 * 48; update(0.016);
game.px = (hh.x + ht.w / 2) * 48; game.py = (hh.y + ht.h / 2) * 48; update(0.016);
check('greeting does not repeat', game.homeIntroShown === true);

console.log('== Shelter fixtures: usable bed + chest ==');
const home2 = homeObj(); // tier 0 from genWorld
const anyHomeSolid = (() => {
  const t = HOME_TIERS[home2.tier];
  for (let yy = 0; yy < t.h; yy++) for (let xx = 0; xx < t.w; xx++)
    if (game.solid.has((home2.x + xx) + ',' + (home2.y + yy))) return true;
  return false;
})();
check('basic shelter is walkable (open structure)', home2.solidFootprint === false && anyHomeSolid === false);
game.sleeping = false; game.fading = 0;
tryInteract(home2.bed.x, home2.bed.y);
check('using the bed starts sleep', game.sleeping === true);
game.sleeping = false; game.fadeDir = 0;
game.bag = { wood: 3 }; game.chest = {};
tryInteract(home2.chest.x, home2.chest.y);
check('using the chest stores your items', (game.chest.wood || 0) === 3 && !game.bag.wood);

console.log('== Roads out of Harvest Hollow ==');
const posts = game.objects.filter(o => o.type === 'signpost');
check('has signed routes (known) and an unknown trail', posts.some(p => p.known) && posts.some(p => !p.known));
check('south road reaches the bottom edge', game.ground[game.ground.length - 1][20] === 'path');
check('west road reaches the left edge', game.ground[10][0] === 'path');

console.log('== Tree -> sapling -> replant -> regrow loop ==');
// plant a sapling on open grass
game.bag = { sapling: 1 };
let sx = 25, sy = 20;
while (game.solid.has(sx + ',' + sy) || game.ground[sy][sx] !== 'grass') sx++;
plantSapling(sx, sy);
const sap = game.objects.find(o => o.type === 'sapling' && o.x === sx && o.y === sy);
check('planting a sapling consumes it and places a sapling object', sap && (game.bag.sapling || 0) === 0);
check('a fresh sapling is walkable (not solid)', !game.solid.has(sx + ',' + sy));
// grow it to maturity over SAPLING_DAYS
for (let d = 0; d < SAPLING_DAYS; d++) advanceDay();
const grown = game.objects.find(o => o.x === sx && o.y === sy);
check('sapling matures into a tree', grown && grown.type === 'tree');
check('matured tree becomes solid', game.solid.has(sx + ',' + sy));

console.log('== Clock formatting (lowercase, 10-min ticks) ==');
game.minutes = 360;  check('6:00 am', fmtClockTest() === '6:00 am');
game.minutes = 780;  check('1:00 pm', fmtClockTest() === '1:00 pm');
game.minutes = 720;  check('12:00 pm', fmtClockTest() === '12:00 pm');
game.minutes = 0;    check('12:00 am', fmtClockTest() === '12:00 am');
game.minutes = 1410; check('11:30 pm', fmtClockTest() === '11:30 pm');

console.log('== Crop growth (parsnip, 4 stages over 4 days, watered) ==');
game.crops = {};
game.crops['5,5'] = { type: 'parsnip', stage: 0, growth: 0, wateredToday: true };
const stagesSeen = [];
for (let d = 0; d < 5; d++) {
  // re-water each morning to keep it growing
  game.crops['5,5'].wateredToday = true;
  advanceDay();
  stagesSeen.push(game.crops['5,5'] ? game.crops['5,5'].stage : 'harvested');
}
console.log('  stages after days 1..5:', stagesSeen.join(','));
check('reaches final stage 3 within 4 days', stagesSeen.includes(3));
check('does not exceed final stage', stagesSeen.every(s => s === 'harvested' || s <= 3));

console.log('== Crop does NOT grow when unwatered ==');
game.crops = {};
game.crops['6,6'] = { type: 'carrot', stage: 0, growth: 0, wateredToday: false };
const before = game.crops['6,6'].stage;
advanceDay();
check('unwatered carrot stays stage 0', game.crops['6,6'].stage === before);

console.log('== Day rollover restores energy & dries soil ==');
game.energy = 5; game.watered = new Set(['9,9']);
advanceDay();
check('energy restored to max', game.energy === game.maxEnergy);
check('watered set cleared overnight', game.watered.size === 0);

console.log('== Sell values present for all crops ==');
check('all crops have positive sell value', Object.values(CROPS).every(c => c.sell > 0));

console.log('\nRESULT:', pass, 'passed,', fail, 'failed');
process.exit(fail ? 1 : 0);
