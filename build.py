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
  #wrap { position: relative; width: 100vw; height: 100vh; height: 100dvh; display: flex;
    align-items: center; justify-content: center; overflow: hidden; }
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
  #goldBox { display: flex; align-items: center; gap: 14px; padding: 6px 16px 8px; }
  #goldBox .cur { display: flex; align-items: center; gap: 6px; }
  #goldBox .gem { width: 18px; height: 18px; }
  #goldBox .coin { width: 20px; height: 20px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffe98a, #d6a01e 70%, #9c6f10);
    border: 2px solid #7a5410; box-shadow: inset -1px -1px 0 #00000033; }
  #goldBox .pearl { border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffffff, #d8e6f0 60%, #9fb6c8);
    border: 1px solid #8aa0b2; }
  #goldBox .emerald { transform: rotate(45deg);
    background: radial-gradient(circle at 35% 30%, #8effc0, #1faa5e 65%, #0c7a3e);
    border: 1px solid #0a5e2f; }
  #goldBox span { font-size: 20px; color: #4a2c12; }
  #gold { font-size: 22px; }

  /* ---- minimap (top-left) ---- */
  #mapBox { position: absolute; top: 14px; left: 14px; padding: 6px; }
  #minimap { width: 176px; height: 136px; image-rendering: pixelated; display: block;
    border: 2px solid #6b3f1d; border-radius: 4px; }
  #mapBox .cap { font-size: 11px; color: #4a2c12; text-align: center; margin-top: 2px; }
  body.hidemap #mapBox { display: none; }

  /* ---- build menu (home upgrades) ---- */
  #buildMenu { display: none; position: absolute; top: 50%; left: 50%;
    transform: translate(-50%, -50%); width: min(340px, 86vw); padding: 16px 18px 14px;
    z-index: 20; text-align: center; }
  #buildMenu h2 { margin: 0 0 8px; color: #4a2c12; text-shadow: 0 1px 0 #f3d8a8; font-size: 20px; }
  #buildMenu p { margin: 4px 0; color: #4a2c12; }
  .bmcosts { margin: 10px auto; display: inline-block; text-align: left; }
  .bmcost { font-size: 14px; padding: 1px 0; }
  .bmcost.ok { color: #1c7a3a; } .bmcost.no { color: #b23a2a; }
  #buildMenu .btns { display: flex; gap: 10px; justify-content: center; margin-top: 12px; }
  #buildMenu button { font-family: inherit; font-weight: bold; font-size: 15px; cursor: pointer;
    padding: 8px 16px; border-radius: 8px; border: 2px solid #6b3f1d; color: #4a2c12;
    background: linear-gradient(#f0d3a0, #d2a262); }
  #buildMenu button:disabled { opacity: .5; cursor: not-allowed; }
  #buildMenu button:active:not(:disabled) { transform: scale(.96); }

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

  #help { position: absolute; top: 196px; left: 14px; padding: 9px 13px; font-size: 12px;
    line-height: 1.5; max-width: 200px; color: #4a2c12; }
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
    /* top-right status cluster, smaller */
    #top { top: 8px; right: 8px; gap: 5px; }
    #dayBox { font-size: 16px; padding: 3px 10px 4px; min-width: 0; }
    #clockBox { padding: 5px 7px 4px; }
    #dial { width: 50px; height: 50px; }
    #clock { font-size: 13px; }
    #goldBox { gap: 9px; padding: 4px 10px 5px; }
    #goldBox span { font-size: 15px; } #gold { font-size: 16px; }
    #goldBox .gem { width: 14px; height: 14px; } #goldBox .coin { width: 15px; height: 15px; }

    /* minimap, smaller, top-left */
    #mapBox { top: 8px; left: 8px; padding: 4px; }
    #minimap { width: 104px; height: 80px; }
    #mapBox .cap { font-size: 9px; }

    /* vertical bars */
    #bars { right: 8px; bottom: 150px; gap: 6px; }
    .vbar { height: 118px; width: 18px; padding: 3px; }

    /* hotbar fits 10 slots across a phone */
    #hotbar { gap: 2px; padding: 4px; max-width: 99vw; overflow-x: auto; touch-action: pan-x; bottom: 8px; }
    .slot { width: 34px; height: 34px; border-radius: 5px; }
    .slot .ic { width: 28px; height: 28px; }
    .slot .num { font-size: 8px; } .slot .cnt { font-size: 10px; }

    /* touch buttons + message */
    #touchUI { right: 10px; bottom: 150px; gap: 9px; }
    .tbtn { width: 64px; height: 64px; font-size: 16px; } #btnA { width: 74px; height: 74px; font-size: 18px; }
    #msg { font-size: 13px; bottom: 78px; padding: 5px 12px; }
    #buildMenu { width: min(320px, 90vw); }
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
    <div id="goldBox" class="wood">
      <div class="cur"><span class="coin"></span><span id="gold" class="emboss">150</span></div>
      <div class="cur"><span class="gem pearl"></span><span id="pearls" class="emboss">0</span></div>
      <div class="cur"><span class="gem emerald"></span><span id="emeralds" class="emboss">0</span></div>
    </div>
  </div>

  <div id="mapBox" class="wood">
    <canvas id="minimap" width="176" height="136"></canvas>
    <div class="cap">Harvest Hollow &nbsp;·&nbsp; M to toggle</div>
  </div>

  <div id="buildMenu" class="wood">
    <h2>Build &amp; Upgrade Home</h2>
    <div id="bmBody"></div>
    <div class="btns">
      <button id="bmUpgrade">Upgrade</button>
      <button id="bmClose">Close</button>
    </div>
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
    <b>Upgrade home</b> use it (Use/E)<br/>
    <b>Minimap</b> M &middot; <b>Pause</b> Esc
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
