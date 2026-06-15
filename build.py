#!/usr/bin/env python3
"""Bundle the Cute Fantasy PNGs (base64) + engine.js into one standalone HTML."""
import base64, os, json

ROOT = '/sessions/serene-upbeat-ramanujan/mnt/outputs'
ASSETS = os.path.join(ROOT, 'assets_raw', 'Cute_Fantasy_Free')

# game-key -> relative path in the asset pack
MAP = {
    'player':   'Player/Player.png',
    'actions':  'Player/Player_Actions.png',
    'cow':      'Animals/Cow/Cow.png',
    'chicken':  'Animals/Chicken/Chicken.png',
    'pig':      'Animals/Pig/Pig.png',
    'sheep':    'Animals/Sheep/Sheep.png',
    'grass':    'Tiles/Grass_Middle.png',
    'water':    'Tiles/Water_Middle.png',
    'path':     'Tiles/Path_Middle.png',
    'farmland': 'Tiles/FarmLand_Tile.png',
    'cliff':    'Tiles/Cliff_Tile.png',
    'bridge':   'Outdoor decoration/Bridge_Wood.png',
    'oakTree':  'Outdoor decoration/Oak_Tree.png',
    'fences':   'Outdoor decoration/Fences.png',
    'chest':    'Outdoor decoration/Chest.png',
    'house':    'Outdoor decoration/House_1_Wood_Base_Blue.png',
    'decor':    'Outdoor decoration/Outdoor_Decor_Free.png',
    'slime':    'Enemies/Slime_Green.png',
    'skeleton': 'Enemies/Skeleton.png',
}

def datauri(path):
    with open(path, 'rb') as f:
        return 'data:image/png;base64,' + base64.b64encode(f.read()).decode('ascii')

asset_data = {}
for key, rel in MAP.items():
    p = os.path.join(ASSETS, rel)
    if os.path.exists(p):
        asset_data[key] = datauri(p)
    else:
        print('MISSING', rel)

with open(os.path.join(ROOT, 'engine.js'), 'r') as f:
    engine = f.read()

html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<title>Sandy Cove</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #1b1d2a; overflow: hidden;
    font-family: 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif; color: #fff;
    touch-action: none; -webkit-user-select: none; user-select: none;
    -webkit-tap-highlight-color: transparent; }
  canvas#game { touch-action: none; }
  #wrap { position: relative; width: 100vw; height: 100vh; display: flex;
    align-items: center; justify-content: center; }
  canvas#game { image-rendering: pixelated; image-rendering: crisp-edges;
    background: #6cbf4b; box-shadow: 0 0 0 2px #000, 0 12px 40px rgba(0,0,0,.5); }

  /* ---- shared wood panel look (original art, drawn with CSS) ---- */
  .wood { background:
      repeating-linear-gradient(90deg, rgba(0,0,0,.05) 0 6px, rgba(255,255,255,.04) 6px 12px),
      linear-gradient(#d7a866, #b7833f);
    border: 3px solid #6b3f1d; border-radius: 12px;
    box-shadow: inset 0 0 0 2px #ecc488, inset 0 0 14px rgba(120,70,20,.4), 0 4px 0 #5a3517, 0 8px 18px rgba(0,0,0,.45);
  }
  .emboss { color: #4a2c12; text-shadow: 0 1px 0 #f3d8a8; font-weight: bold; }

  /* ---- top-right status cluster ---- */
  #top { position: absolute; top: 14px; right: 14px; display: flex; flex-direction: column;
    align-items: flex-end; gap: 8px; pointer-events: none; }
  #dayBox { padding: 6px 18px 8px; font-size: 26px; letter-spacing: 1px; text-align: center; min-width: 120px; }
  #clockBox { display: flex; flex-direction: column; align-items: center; padding: 8px 10px 6px; gap: 2px; }
  #dial { width: 84px; height: 84px; }
  #clock { font-size: 20px; }
  #goldBox { display: flex; align-items: center; gap: 10px; padding: 6px 16px 8px; }
  #goldBox .coin { width: 20px; height: 20px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffe98a, #d6a01e 70%, #9c6f10);
    border: 2px solid #7a5410; box-shadow: inset -1px -1px 0 #00000033; }
  #gold { font-size: 24px; color: #6b3f12; }

  /* ---- right-edge vertical energy/health bars ---- */
  #bars { position: absolute; right: 16px; bottom: 96px; display: flex; gap: 8px; align-items: flex-end; }
  .vbar { width: 26px; height: 200px; padding: 4px; display: flex; align-items: flex-end; }
  .vbar > i { display: block; width: 100%; border-radius: 4px; transition: height .25s;
    box-shadow: inset 0 0 0 1px rgba(0,0,0,.25); }
  #energyBar { background: linear-gradient(#caf06a, #5fae35); }
  #healthBar { background: linear-gradient(#ff8a8a, #d12f2f); }

  /* ---- hotbar ---- */
  #hotbar { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%);
    display: flex; gap: 5px; padding: 7px; }
  .slot { position: relative; width: 58px; height: 58px; cursor: pointer; user-select: none;
    background: linear-gradient(#f0d3a0, #d2a262);
    border: 2px solid #8a5a2b; border-radius: 6px;
    box-shadow: inset 1.5px 1.5px 0 rgba(255,255,255,.55), inset -1.5px -1.5px 0 rgba(90,40,10,.4);
    display: flex; align-items: center; justify-content: center; }
  .slot.sel { border-color: #e4382b;
    box-shadow: 0 0 0 2px #e4382b, 0 0 12px rgba(228,56,43,.7), inset 1.5px 1.5px 0 rgba(255,255,255,.5); }
  .slot .num { position: absolute; top: 1px; left: 4px; font-size: 11px; color: #6b3f12; font-weight: bold; text-shadow: 0 1px 0 #f3d8a8; }
  .slot .ic { width: 48px; height: 48px; image-rendering: pixelated; }
  .slot .cnt { position: absolute; bottom: 0px; right: 5px; font-size: 13px; color: #4a2c12; font-weight: bold; text-shadow: 0 1px 0 #f3d8a8; }

  #msg { position: absolute; bottom: 86px; left: 50%; transform: translateX(-50%);
    padding: 7px 18px; font-size: 15px; pointer-events: none;
    max-width: min(620px, 80vw); text-align: center; line-height: 1.35; }
  #msg.wood { color: #4a2c12; text-shadow: 0 1px 0 #f3d8a8; }
  #msg:empty { display: none; }

  #help { position: absolute; top: 14px; left: 14px; padding: 9px 13px; font-size: 12px;
    line-height: 1.55; max-width: 232px; color: #4a2c12; }
  #help b { color: #7a3f12; }

  /* ---- on-screen touch buttons (hidden until a touch is detected) ---- */
  #touchUI { position: absolute; right: 18px; bottom: 96px; display: none;
    flex-direction: column; gap: 12px; align-items: center; }
  body.touch #touchUI { display: flex; }
  body.touch #help { display: none; }            /* free up space on phones */
  .tbtn { width: 74px; height: 74px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; font-size: 20px; color: #4a2c12; cursor: pointer;
    touch-action: none; }
  .tbtn:active { transform: scale(.94); filter: brightness(1.08); }
  #btnA { width: 86px; height: 86px; font-size: 22px; }

  /* ---- phone-sized layout tweaks ---- */
  @media (max-width: 760px), (pointer: coarse) {
    #hotbar { gap: 3px; padding: 5px; max-width: 96vw; overflow-x: auto; touch-action: pan-x; }
    .slot { width: 46px; height: 46px; }
    .slot .ic { width: 38px; height: 38px; }
    #dayBox { font-size: 20px; padding: 4px 12px 6px; }
    #dial { width: 64px; height: 64px; }
    #clock { font-size: 16px; }
    #gold { font-size: 18px; }
    #goldBox { padding: 4px 12px 6px; }
    #bars { bottom: 200px; }
    .vbar { height: 150px; width: 22px; }
  }
</style>
</head>
<body>
<div id="wrap">
  <canvas id="game"></canvas>

  <div id="top">
    <div id="dayBox" class="wood emboss"><span id="day">Mon. 1</span></div>
    <div id="clockBox" class="wood">
      <canvas id="dial" width="84" height="84"></canvas>
      <span id="clock" class="emboss">6:00 am</span>
    </div>
    <div id="goldBox" class="wood"><span class="coin"></span><span id="gold" class="emboss">150</span></div>
  </div>

  <div id="bars">
    <div class="vbar wood"><i id="energyBar" style="height:100%"></i></div>
    <div class="vbar wood"><i id="healthBar" style="height:100%"></i></div>
  </div>

  <div id="help" class="wood">
    <b style="font-size:13px">Goal:</b> find your way to <b>Sandy Cove</b><br/>
    <hr style="border:none;border-top:1px solid #8a5a2b66;margin:4px 0"/>
    <b>Move</b> WASD / Arrows<br/>
    <b>Use tool / interact</b> Space, E, or Click<br/>
    <b>Select tool</b> 1-9 keys<br/>
    <b>Buy seeds</b> B (near SHOP)<br/>
    <b>Sleep</b> use BED &middot; <b>Ship</b> use SHIP bin<br/>
    <b>Pause</b> Esc
  </div>

  <div id="touchUI">
    <div id="btnB" class="tbtn wood emboss">Buy</div>
    <div id="btnA" class="tbtn wood emboss">Use</div>
  </div>

  <div id="hotbar" class="wood"></div>
  <div id="msg" class="wood"></div>
</div>
<script>
window.ASSET_DATA = __ASSET_DATA__;
</script>
<script>
__ENGINE__
</script>
</body>
</html>
"""

html = html.replace('__ASSET_DATA__', json.dumps(asset_data))
html = html.replace('__ENGINE__', engine)

out = os.path.join(ROOT, 'Harvest_Hollow.html')
with open(out, 'w') as f:
    f.write(html)
# GitHub Pages serves index.html at the site root — emit that too
with open(os.path.join(ROOT, 'index.html'), 'w') as f:
    f.write(html)
print('WROTE', out, 'and index.html', round(len(html) / 1024), 'KB,', len(asset_data), 'assets')
