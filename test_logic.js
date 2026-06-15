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
        startFishing, catchFish, tryInteract, POND_FISH, RIVER_FISH, keyName } = eng;

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
check('world has a house object', game.objects.some(o => o.type === 'house'));
check('world has trees', game.objects.some(o => o.type === 'tree'));
check('world has a bed and shipping bin', game.objects.some(o => o.type === 'bed') && game.objects.some(o => o.type === 'bin'));
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
