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
        HOME_TIERS, upgradeHome, canAfford, homeObj, plantSapling, SAPLING_DAYS,
        farmLevel, HIRE_POOL, hireCandidate, upgradeEmployee, dismissEmployee, applyEmployees,
        TS, markExplored,
        CATALOGUE, orderItem, deliverPost, collectMail, isPostDay, daysUntilPost,
        CRAFT_RECIPES, craftRecipe, canCraft, skillLearned, recipeFee, recipeAvailable, toolPower } = eng;

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
game.px = (hh.x + ht.w / 2) * TS; game.py = (hh.y + ht.h / 2) * TS;  // stand on the home
update(0.016);
check('walking up to the home shows the greeting once', game.homeIntroShown === true);
// moving away and back should not repeat it
game.px = 30 * TS; game.py = 28 * TS; update(0.016);
game.px = (hh.x + ht.w / 2) * TS; game.py = (hh.y + ht.h / 2) * TS; update(0.016);
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

console.log('== Farm level + hiring economy ==');
game.farmXP = 0;    check('farm starts at level 1', farmLevel() === 1);
game.farmXP = 1300; check('shipping raises the farm level', farmLevel() >= 3);
check('job board exists in the world', game.objects.some(o => o.type === 'jobboard'));
const curs = HIRE_POOL.map(c => c.cur);
check('hire tiers escalate Coins -> Pearls -> Emeralds',
  curs.includes('coins') && curs.includes('pearls') && curs.includes('emeralds'));

game.employees = []; game.npcId = 0;
game.farmXP = 1300; game.gold = 1000; game.pearls = 0; game.emeralds = 0;
const coinIdx = HIRE_POOL.findIndex(c => c.cur === 'coins');
const goldBefore = game.gold;
check('can hire a coins-tier worker', hireCandidate(coinIdx) === true && game.employees.length === 1);
check('hiring a coins-tier worker spends coins', game.gold < goldBefore);

const pearlIdx = HIRE_POOL.findIndex(c => c.cur === 'pearls');
game.farmXP = 0;
check('higher tier is locked at low farm level', hireCandidate(pearlIdx) === false);
game.farmXP = 7000; game.pearls = 50;
const pearlsBefore = game.pearls;
check('pearl-tier hire unlocks once the farm is bigger', hireCandidate(pearlIdx) === true);
check('pearl-tier hire spends Pearls, not Coins', game.pearls < pearlsBefore);

const emp = game.employees[0]; emp.level = 1; emp.cap = 3; game.gold = 100000;
upgradeEmployee(emp.id); upgradeEmployee(emp.id);
check('a worker trains up to its cap', emp.level === emp.cap);
check('cannot train past the cap (must replace)', upgradeEmployee(emp.id) === false && emp.level === emp.cap);
const beforeDismiss = game.employees.length;
dismissEmployee(emp.id);
check('dismissing removes the worker', game.employees.length === beforeDismiss - 1);

console.log('== Employee daily effects ==');
game.employees = [{ id: 99, role: 'farmer', tier: 'Farmhand', level: 1, cap: 3, upBase: 150, x:0,y:0,vx:0,vy:0,t:0,frame:0,animTime:0,dir:1 }];
game.crops = { '5,5': { type: 'parsnip', stage: 0, growth: 0, wateredToday: false } };
game.watered = new Set();
applyEmployees();
check('a Farmer waters your crops each morning', game.crops['5,5'].wateredToday === true);
game.employees = [{ id: 98, role: 'rancher', tier: 'Ranch Hand', level: 1, cap: 3, upBase: 150, x:0,y:0,vx:0,vy:0,t:0,frame:0,animTime:0,dir:1 }];
game.animals.forEach(a => { a.produce = true; }); game.bag = {};
applyEmployees();
check('a Rancher gathers produce each morning', ((game.bag.milk || 0) + (game.bag.egg || 0)) > 0);

console.log('== Camera / fog of war / leaping fish ==');
game.paused = false; game.sleeping = false; game.buildMenuOpen = false; game.hireMenuOpen = false;
game.explored = new Set();
game.px = 20 * TS; game.py = 18 * TS;
markExplored();
check('player tile is revealed on the minimap', game.explored.has('20,18'));
check('far-off tiles stay hidden (fog of war)', !game.explored.has('38,1'));
// force a fish leap to spawn over water
game.fishLeaps = []; game.leapTimer = 0;
update(0.02);
check('fish occasionally leap from the water', game.fishLeaps.length >= 1);

console.log('== Pond edges, lily pads, pond life ==');
check('pond has lily pads', game.lilypads.size > 0);
const lpk = [...game.lilypads][0];
const [lx, ly] = lpk.split(',').map(Number);
check('lily pads sit on water', game.ground[ly][lx] === 'water');
check('lily pads are walkable (can hop across)', !game.solid.has(lpk));
check('pond life: reeds and a frog exist', game.objects.some(o => o.type === 'reed') && game.objects.some(o => o.type === 'frog'));
check('rivers have bank plants (several reeds placed)', game.objects.filter(o => o.type === 'reed').length >= 6);

console.log('== No ranch shop; mail-order catalogue + Wednesday post ==');
check('no shop on the ranch', !game.objects.some(o => o.type === 'shop'));
check('home has an order catalogue fixture', !!homeObj().catalogue);
check('post day is Wednesday (day 3, 10, ...)', isPostDay(3) && isPostDay(10) && !isPostDay(4));

game.pendingOrders = []; game.mail = []; game.postman = null;
game.objects = game.objects.filter(o => o.type !== 'parcel');
game.gold = 1000; game.seeds = { parsnip: 0, carrot: 0, potato: 0, pumpkin: 0 };
const goldBeforeOrder = game.gold;
orderItem(0); orderItem(0);   // order 2 of the first catalogue item (parsnip seeds)
check('ordering queues items and charges coins', game.pendingOrders.length === 1 && game.pendingOrders[0].qty === 2 && game.gold < goldBeforeOrder);
// jump to the next post day and deliver
game.day = 2; advanceDay();   // -> day 3 = Wednesday
check('Wednesday delivery clears orders into the mail', game.pendingOrders.length === 0 && game.mail.length === 1);
check('a parcel is left by the tent', game.objects.some(o => o.type === 'parcel'));
check('the postman arrives on post day', game.postman !== null);
const parcel = game.objects.find(o => o.type === 'parcel');
collectMail();
check('collecting the parcel delivers the seeds', game.seeds.parsnip === 2);
check('parcel is removed after collection', !game.objects.some(o => o.type === 'parcel'));

console.log('== Crafting: pay a crafter until you learn the skill ==');
game.shedBuilt = false; game.skills = { carpentry: 0, toolsmithing: 0 };
game.toolLevel = { axe: 1, pickaxe: 1, wateringcan: 1, hoe: 1 };
game.objects = game.objects.filter(o => o.type !== 'shed');
game.bag = {}; game.gold = 0;
const shedR = CRAFT_RECIPES.find(r => r.id === 'shed');
const axeR = CRAFT_RECIPES.find(r => r.id === 'axe');
check('cannot build the shed without materials', canCraft(shedR) === false);
check('tool upgrades are locked until the shed is built', recipeAvailable(axeR) === false);
game.bag = { wood: 200, stone: 200 }; game.gold = 5000;
check('shed becomes affordable with materials', canCraft(shedR) === true);
craftRecipe('shed');
check('shed is built', game.shedBuilt === true && game.objects.some(o => o.type === 'shed'));
check('toolsmithing unlocks after the shed', recipeAvailable(axeR) === true);
check('crafter charges a fee before the skill is learned', recipeFee(axeR) === axeR.fee && !skillLearned('toolsmithing'));
const goldBeforeUp = game.gold;
craftRecipe('axe');
check('axe upgraded a level', game.toolLevel.axe === 2);
check('paid the crafter fee (coins beyond materials)', game.gold === goldBeforeUp - axeR.fee);
check('upgraded axe hits harder', toolPower('tree') === 2);
craftRecipe('pickaxe'); craftRecipe('can');   // reach the learn threshold
check('toolsmithing learned after enough crafting', skillLearned('toolsmithing') === true);
check('once self-taught, no more crafter fee', recipeFee(axeR) === 0);

console.log('== Ambient motes ==');
game.paused = false; game.sleeping = false; game.buildMenuOpen = false; game.hireMenuOpen = false;
game.catalogueOpen = false; game.craftMenuOpen = false; game.motes = [];
update(0.02);
check('faint drifting motes are present', game.motes.length > 0);

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
