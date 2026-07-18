/* ==========================================================
   mc-game.js — MONSTER CATAPULT 本体ロジック
   ========================================================== */
(function(){
  'use strict';

  // ---------- 安全なローカル保存 ----------
  const Storage = {
    get(key, fallback){
      try{ const v = localStorage.getItem(key); return v===null ? fallback : JSON.parse(v); }
      catch(e){ return fallback; }
    },
    set(key, value){ try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){} }
  };

  // ---------- 定数 ----------
  const WORLDS = [
    { id:1, name:'火山の丘' },
    { id:2, name:'氷結の山脈' },
  ];
  const STAGES_PER_WORLD = 10;
  const TOTAL_STAGES = WORLDS.length * STAGES_PER_WORLD;
  const LEVEL_MAX = 5;
  const BASE_THRESHOLD = 2.3;

  function worldForStage(n){ return Math.ceil(n / STAGES_PER_WORLD); }
  function localStageInfo(n){
    const worldIndex = worldForStage(n);
    const localN = ((n-1) % STAGES_PER_WORLD) + 1;
    return { worldIndex, localN };
  }

  const MONSTER_DEFS = {
    slime:    {name:'スライム',        emoji:'🟢', color:'#7bd66b', special:'split',   specialText:'着弾すると3体に分裂し、周囲へ被害を広げる',
               radius:11, density:0.0016, restitution:0.30, friction:0.5,
               basePower:2, baseWeight:2, ownedDefault:true,  unlockCost:0,   levelBase:120},
    dragon:   {name:'ファイアドラゴン', emoji:'🐉', color:'#e0533f', special:'explode', specialText:'着弾で爆発し、範囲内の敵を一掃する',
               radius:13, density:0.0026, restitution:0.22, friction:0.5,
               basePower:4, baseWeight:3, ownedDefault:true,  unlockCost:0,   levelBase:220},
    icegolem: {name:'アイスゴーレム',   emoji:'❄️', color:'#5fc7e0', special:'freeze',  specialText:'着弾で周囲の敵を凍結させ、動きを止める',
               radius:12, density:0.0022, restitution:0.20, friction:0.5,
               basePower:3, baseWeight:4, ownedDefault:true,  unlockCost:0,   levelBase:220},
    spikeball:{name:'スパイクボール',   emoji:'🟣', color:'#b06bd6', special:'bounce',  specialText:'弾みやすく、何度も跳ねて多段ヒットしやすい',
               radius:9,  density:0.0012, restitution:0.72, friction:0.35,
               basePower:3, baseWeight:2, ownedDefault:true,  unlockCost:0,   levelBase:150},
    skeleton: {name:'スケルトンナイト', emoji:'💀', color:'#c9c3b0', special:'heavy',   specialText:'質量が大きく、構造物を力任せに突き崩す',
               radius:12, density:0.0045, restitution:0.12, friction:0.6,
               basePower:3, baseWeight:5, ownedDefault:false, unlockCost:600, levelBase:260},
    centaur:  {name:'ウィンドケンタウルス', emoji:'🏹', color:'#4fa8e0', special:'pierce', specialText:'飛行中に浮力がかかり、伸びのある低伸弾道で貫通する',
               radius:9,  density:0.0020, restitution:0.20, friction:0.4,
               basePower:2, baseWeight:2, ownedDefault:false, unlockCost:900, levelBase:300},
  };
  const MONSTER_ORDER = ['slime','dragon','icegolem','spikeball','skeleton','centaur'];

  const MISSION_POOL = [
    {id:'kill_total_5', text:'モンスターを合計5体撃破する',            target:5,   track:'anyKill',      reward:100},
    {id:'kill_fire_3',  text:'ファイアドラゴンで敵を3体撃破する',      target:3,   track:'type:dragon',   reward:120},
    {id:'explode_2',    text:'爆発で敵を2体撃破する',                  target:2,   track:'explosionKill', reward:120},
    {id:'clear_stage_2',text:'ステージを2回クリアする',                target:2,   track:'stageClear',    reward:150},
    {id:'combo_1',      text:'1ターンで敵を2体同時に撃破する',        target:1,   track:'combo',         reward:100},
    {id:'leftover_1',   text:'弾を1発以上残してステージをクリアする',  target:1,   track:'leftover',      reward:100},
  ];

  // ---------- 画像アセット差し込み口（未設定なら自動的にCanvas/絵文字描画にフォールバック） ----------
  // 実際のイラスト素材が用意できたら、下のパスにファイル名を設定するだけで自動的に使用されます。
  const IMAGE_ASSETS = {
    // ステージ背景：ステージ番号の範囲ごとに切り替わります（stageBackgroundKey関数で対応付け）
    backgrounds: {
      meadow:  'bg-meadow.jpg',   // ステージ1〜2：緑の草原
      forest:  'bg-forest.jpg',   // ステージ3〜4：森の小川
      cave:    'bg-cave.jpg',     // ステージ6〜7：水晶の洞窟
      snow:    'bg-snow.jpg',     // ステージ8〜9：雪山の村
      volcano: 'bg-volcano.jpg',  // ボスステージ（5・10）専用：溶岩の渓谷
    },
    // 砦ブロックのテクスチャ：背景と同じテーマ区分で切り替わります
    blocks: {
      meadow:  'block-meadow.jpg',
      forest:  'block-forest.jpg',
      cave:    'block-cave.jpg',
      snow:    'block-snow.jpg',
      volcano: 'block-volcano.jpg',
    },
    enemy: null,         // 敵アイコン（推奨: 64x64, png/透過）
    monsters: {          // 各モンスターの立ち絵/アイコン（推奨: 240x240, png/透過）
      slime:'monster-slime.png', dragon:'monster-dragon.png', icegolem:null,
      spikeball:'monster-spikeball.png', skeleton:null, centaur:null,
    },
  };
  function stageBackgroundKey(stageN){
    const { worldIndex, localN } = localStageInfo(stageN);
    if(localN % 5 === 0) return 'volcano'; // ボスステージは共通の溶岩アリーナ
    const forward = worldIndex % 2 === 1;   // ワールドごとに巡回順を変えて変化をつける
    const cycle = forward
      ? ['meadow','meadow','forest','forest','cave','cave','snow','snow']
      : ['snow','snow','cave','cave','forest','forest','meadow','meadow'];
    const nonBossOrder = [1,2,3,4,6,7,8,9];
    const idx = nonBossOrder.indexOf(localN);
    return cycle[idx] || 'meadow';
  }
  const loadedImages = { monsters:{}, backgrounds:{}, blocks:{} };
  function preloadImages(){
    const tryLoad = (key, path, target)=>{
      if(!path) return;
      const img = new Image();
      img.onload = ()=>{ target[key] = img; };
      img.onerror = ()=>{ /* 読み込み失敗時は既存のCanvas/絵文字描画のまま */ };
      img.src = path;
    };
    Object.keys(IMAGE_ASSETS.backgrounds).forEach(k=> tryLoad(k, IMAGE_ASSETS.backgrounds[k], loadedImages.backgrounds));
    Object.keys(IMAGE_ASSETS.blocks).forEach(k=> tryLoad(k, IMAGE_ASSETS.blocks[k], loadedImages.blocks));
    tryLoad('enemy', IMAGE_ASSETS.enemy, loadedImages);
    MONSTER_ORDER.forEach(k=> tryLoad(k, IMAGE_ASSETS.monsters[k], loadedImages.monsters));
  }
  // DOM側（モンスターカード等）で画像を使う場合のCSS背景ヘルパー
  function monsterIconStyle(key){
    const path = IMAGE_ASSETS.monsters[key];
    return path ? `background-image:url('${path}'); background-size:145%; background-position:center;` : '';
  }

  const ANCHOR = {x:66, y:300};
  const GROUND_Y = 392;
  const MAX_PULL = 78;
  const LAUNCH_SCALE = 0.17;
  const TURN_DURATION = 3400;
  const W = 390, H = 460;
  const BLOCK_W = 34, BLOCK_H = 34, BLOCK_GAP = 4;
  const FORT_RIGHT_EDGE = W - 46;

  // ---------- プレイヤー永続状態 ----------
  function defaultState(){
    const monsters = {};
    MONSTER_ORDER.forEach(k=>{
      monsters[k] = { owned: MONSTER_DEFS[k].ownedDefault, level: MONSTER_DEFS[k].ownedDefault ? 1 : 0 };
    });
    return { gold: 300, monsters, stages: {}, totalScore: 0, sfxOn: true };
  }
  let state = Object.assign(defaultState(), Storage.get('mc_state', {}));
  // 深いマージ漏れ対策（旧セーブに新モンスターが無い場合を補完）
  MONSTER_ORDER.forEach(k=>{ if(!state.monsters[k]) state.monsters[k] = { owned: MONSTER_DEFS[k].ownedDefault, level: MONSTER_DEFS[k].ownedDefault?1:0 }; });
  function saveState(){ Storage.set('mc_state', state); }

  function levelUpCost(key){
    const lv = state.monsters[key].level || 0;
    return Math.round(MONSTER_DEFS[key].levelBase * Math.pow(1.55, Math.max(0,lv-1)));
  }
  function levelMult(key){
    if(!key) return 1;
    const lv = state.monsters[key] ? (state.monsters[key].level||1) : 1;
    return 1 + (lv-1)*0.15;
  }

  // ---------- ミッション ----------
  function todayKey(){ return new Date().toDateString(); }
  function seedFromDate(){
    const d = new Date();
    return d.getFullYear()*372 + (d.getMonth()+1)*31 + d.getDate();
  }
  function pickTodayMissionIds(){
    const seed = seedFromDate();
    const pool = MISSION_POOL.map((m,i)=>i);
    // シンプルな決定的シャッフル
    for(let i=pool.length-1;i>0;i--){
      const j = (seed * (i+7) + i*13) % (i+1);
      [pool[i],pool[j]] = [pool[j],pool[i]];
    }
    return pool.slice(0,3).map(i=>MISSION_POOL[i].id);
  }
  let missionState = Storage.get('mc_missions', null);
  if(!missionState || missionState.dateKey !== todayKey()){
    missionState = { dateKey: todayKey(), items: pickTodayMissionIds().map(id=>({id, progress:0, claimed:false})) };
    Storage.set('mc_missions', missionState);
  }
  function bumpMissionTrack(track, amount){
    let changed = false;
    missionState.items.forEach(item=>{
      const def = MISSION_POOL.find(m=>m.id===item.id);
      if(def && def.track===track && item.progress < def.target){
        item.progress = Math.min(def.target, item.progress + amount);
        changed = true;
      }
    });
    if(changed){ Storage.set('mc_missions', missionState); refreshMissionDot(); if(!screens.missions.classList.contains('hidden')) renderMissions(); }
  }
  function refreshMissionDot(){
    const claimable = missionState.items.some(it=>{
      const def = MISSION_POOL.find(m=>m.id===it.id);
      return def && it.progress>=def.target && !it.claimed;
    });
    document.getElementById('missionDot').classList.toggle('hidden', !claimable);
  }

  // ---------- DOM ----------
  const el = id => document.getElementById(id);
  const screens = {
    splash: el('screen-splash'), map: el('screen-map'), monsters: el('screen-monsters'), shop: el('screen-shop'),
    missions: el('screen-missions'), ranking: el('screen-ranking'), game: el('screen-game'),
  };
  const topbar = el('topbar'), bottomNav = el('bottomNav');
  const goldTopEl = el('goldTop');
  const overlayEl = el('overlay'), overlayTitleEl = el('overlayTitle'), overlayStarsEl = el('overlayStars');
  const overlayScoreEl = el('overlayScore'), overlayGoldEl = el('overlayGold'), overlayTextEl = el('overlayText');
  const overlayPrimaryEl = el('overlayPrimaryBtn'), overlaySecondaryEl = el('overlaySecondaryBtn');

  function refreshTopbar(){
    goldTopEl.textContent = state.gold;
    const btn = el('soundToggleBtn');
    if(btn){
      btn.textContent = state.sfxOn !== false ? '🔊' : '🔇';
      btn.classList.toggle('muted', state.sfxOn === false);
    }
  }
  el('soundToggleBtn').addEventListener('click', ()=>{
    state.sfxOn = state.sfxOn === false ? true : false;
    saveState(); refreshTopbar();
    if(state.sfxOn) SFX.click();
  });

  function showScreen(name){
    Object.keys(screens).forEach(k=> screens[k].classList.toggle('hidden', k!==name));
    const chromeless = (name==='game' || name==='splash');
    topbar.classList.toggle('hidden', chromeless);
    bottomNav.classList.toggle('hidden', chromeless);
    document.querySelectorAll('.nav-item').forEach(n=> n.classList.toggle('active', n.dataset.nav===name));
    if(name==='map'){ mapWorldView = worldForStage(unlockedUpTo()); renderMap(); }
    if(name==='monsters') renderMonsters();
    if(name==='shop') renderShop();
    if(name==='missions') renderMissions();
    if(name==='ranking'){ el('myTotalScore').textContent = state.totalScore; loadRanking(); }
    if(name==='splash'){ el('splashHighScore').textContent = state.totalScore; el('splashGold').textContent = state.gold; }
    refreshTopbar();
  }
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click', ()=>{ SFX.click(); showScreen(item.dataset.nav); });
  });
  el('splashPlayBtn').addEventListener('click', ()=>{ SFX.unlock(); showScreen('map'); });
  el('worldPrevBtn').addEventListener('click', ()=>{
    if(mapWorldView>1){ mapWorldView--; renderMap(); }
  });
  el('worldNextBtn').addEventListener('click', ()=>{
    if(mapWorldView<WORLDS.length){ mapWorldView++; renderMap(); }
  });
  (function setSplashIcon(){
    const img = new Image();
    img.onload = ()=>{ el('splashIcon').style.backgroundImage = `url('icon-192.png')`; el('splashIcon').textContent=''; };
    img.onerror = ()=>{ /* 画像未取得ならデフォルト絵文字のまま */ };
    img.src = 'icon-192.png';
  })();

  // ---------- ワールドマップ ----------
  let mapWorldView = 1;
  function unlockedUpTo(){
    let n = 1;
    while(n < TOTAL_STAGES && state.stages[n] && state.stages[n].cleared) n++;
    return n;
  }
  function renderMap(){
    const wrap = el('mapScroll');
    wrap.style.position = 'relative';
    const pathEl = el('mapPath');
    const unlocked = unlockedUpTo();
    mapWorldView = Math.min(Math.max(mapWorldView, 1), WORLDS.length);
    const world = WORLDS[mapWorldView-1];
    el('worldLabelText').textContent = `WORLD ${world.id}・${world.name}`;
    el('worldPrevBtn').classList.toggle('disabled', mapWorldView<=1);
    el('worldNextBtn').classList.toggle('disabled', mapWorldView>=WORLDS.length);

    const pts = [];
    let html = '';
    for(let i=0;i<STAGES_PER_WORLD;i++){
      const n = (mapWorldView-1)*STAGES_PER_WORLD + i + 1;
      const local = i+1;
      const topPct = 90 - i*7.6;
      const xPct = 50 + Math.sin(i*1.15)*28;
      pts.push([xPct, topPct]);
      const st = state.stages[n];
      const locked = n > unlocked;
      const current = n === unlocked && !(st && st.cleared);
      const stars = st ? st.stars : 0;
      const starStr = '★★★'.slice(0,stars) + '☆☆☆'.slice(0, 3-stars);
      html += `<div class="stage-node ${locked?'locked':''} ${current?'current':''}" data-stage="${n}"
                 style="left:${xPct}%; top:${topPct}%;">
                 ${local%5===0?'<div class="boss-badge">BOSS</div>':''}
                 ${locked ? '<div class="lock-icon">🔒</div>' : `<div class="num">${local}</div><div class="stars">${starStr}</div>`}
               </div>`;
    }
    const svgPoints = pts.map(p=>p[0]+','+p[1]).join(' ');
    pathEl.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;">
      <polyline points="${svgPoints}" fill="none" stroke="#4a3320" stroke-width="1.2" stroke-dasharray="2,2"/>
    </svg>` + html;
    pathEl.querySelectorAll('.stage-node').forEach(node=>{
      node.addEventListener('click', ()=>{
        const n = parseInt(node.dataset.stage, 10);
        if(n <= unlocked) enterStage(n);
      });
    });
  }

  // ---------- モンスターカード共通描画 ----------
  function buildMonsterCard(key, mode){
    const def = MONSTER_DEFS[key];
    const info = state.monsters[key];
    const owned = info.owned;
    const level = info.level || 0;
    const powerPct = Math.min(100, ((def.basePower + (level-1)*0.6) / 6) * 100);
    const weightPct = Math.min(100, (def.baseWeight/6)*100);

    let actionHtml = '';
    if(mode==='shop'){
      if(!owned){
        actionHtml = `<div class="m-action"><button class="btn" data-buy="${key}">解放する</button><div class="cost">${def.unlockCost}G</div></div>`;
      } else if(level>=LEVEL_MAX){
        actionHtml = `<div class="m-action"><button class="btn btn-ghost" disabled>MAX Lv</button></div>`;
      } else {
        actionHtml = `<div class="m-action"><button class="btn" data-levelup="${key}">強化する</button><div class="cost">${levelUpCost(key)}G</div></div>`;
      }
    }

    const hasImg = owned && IMAGE_ASSETS.monsters[key];
    const iconStyle = `background:${def.color}33;border:1px solid ${def.color};` + (hasImg ? monsterIconStyle(key) : '');
    return `<div class="monster-card ${owned?'':'locked'}">
      <div class="m-icon" style="${iconStyle}">${hasImg?'':(owned?def.emoji:'🔒')}</div>
      <div class="m-body">
        <div class="m-head"><span class="m-name">${def.name}</span><span class="m-lv">${owned?('Lv.'+level):'未解放'}</span></div>
        <div class="m-special">${def.specialText}</div>
        <div class="stat-row"><span class="stat-label">パワー</span><div class="stat-bar"><div class="stat-bar-fill power" style="width:${powerPct}%"></div></div></div>
        <div class="stat-row"><span class="stat-label">重さ</span><div class="stat-bar"><div class="stat-bar-fill weight" style="width:${weightPct}%"></div></div></div>
      </div>
      ${actionHtml}
    </div>`;
  }

  function renderMonsters(){
    el('monsterList').innerHTML = MONSTER_ORDER.map(k=> buildMonsterCard(k,'view')).join('');
  }

  function renderShop(){
    const wrap = el('shopList');
    wrap.innerHTML = MONSTER_ORDER.map(k=> buildMonsterCard(k,'shop')).join('');
    wrap.querySelectorAll('[data-buy]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const key = btn.dataset.buy;
        const cost = MONSTER_DEFS[key].unlockCost;
        if(state.gold < cost) return;
        state.gold -= cost;
        state.monsters[key].owned = true;
        state.monsters[key].level = 1;
        saveState(); renderShop(); refreshTopbar();
        SFX.buy();
      });
    });
    wrap.querySelectorAll('[data-levelup]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const key = btn.dataset.levelup;
        const cost = levelUpCost(key);
        if(state.gold < cost) return;
        state.gold -= cost;
        state.monsters[key].level = Math.min(LEVEL_MAX, (state.monsters[key].level||1) + 1);
        saveState(); renderShop(); refreshTopbar();
        SFX.buy();
      });
    });
  }

  // ---------- ミッション画面 ----------
  function renderMissions(){
    const wrap = el('missionList');
    wrap.innerHTML = missionState.items.map(item=>{
      const def = MISSION_POOL.find(m=>m.id===item.id);
      const pct = Math.min(100, Math.round((item.progress/def.target)*100));
      const done = item.progress >= def.target;
      const claimBtn = item.claimed
        ? `<span class="count">受取済み</span>`
        : done
          ? `<button class="btn claim-btn" data-claim="${item.id}">受け取る</button>`
          : `<span class="count">${item.progress}/${def.target}</span>`;
      return `<div class="mission-card ${done?'done':''}">
        <div class="mission-text"><span>${def.text}</span><span class="mission-reward">+${def.reward}G</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="mission-foot">${claimBtn}</div>
      </div>`;
    }).join('');
    wrap.querySelectorAll('[data-claim]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const id = btn.dataset.claim;
        const item = missionState.items.find(i=>i.id===id);
        const def = MISSION_POOL.find(m=>m.id===id);
        if(!item || item.claimed) return;
        item.claimed = true;
        state.gold += def.reward;
        saveState(); Storage.set('mc_missions', missionState);
        refreshTopbar(); refreshMissionDot(); renderMissions();
        SFX.buy();
      });
    });
    refreshMissionDot();
  }

  // ---------- ランキング ----------
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function loadRanking(){
    const listEl = el('rankingList');
    listEl.innerHTML = '<li class="dim">読み込み中…</li>';
    if(window.CatapultFirebase && window.CatapultFirebase.fetchTopScores){
      window.CatapultFirebase.fetchTopScores(list=>{
        if(!list || !list.length){ listEl.innerHTML = '<li class="dim">まだ記録がありません</li>'; return; }
        listEl.innerHTML = list.map((r,i)=>`<li><span class="rank">${i+1}</span><span>${escapeHtml(r.name)}</span><span>${r.score}</span></li>`).join('');
      }, ()=>{ listEl.innerHTML = '<li class="dim">取得に失敗しました</li>'; });
    } else {
      listEl.innerHTML = '<li class="dim">Firebase未設定です（mc-firebase.js にプロジェクト情報を設定してください）</li>';
    }
  }
  el('refreshRankingBtn').addEventListener('click', loadRanking);
  el('submitScoreBtn').addEventListener('click', ()=>{
    const name = (el('nameInput').value || '冒険者').trim().slice(0,12) || '冒険者';
    if(window.CatapultFirebase && window.CatapultFirebase.submitScore){
      window.CatapultFirebase.submitScore(name, state.totalScore, ()=> loadRanking(), ()=>{});
    }
  });

  // ==========================================================
  //  ゲーム本体（物理演算パート）
  // ==========================================================
  const { Engine, World, Bodies, Body, Composite, Events, Vector } = Matter;
  // ---------- 効果音（Web Audio APIでコード生成、追加ファイル不要） ----------
  const SFX = (function(){
    let ctx = null;
    function getCtx(){
      if(!ctx){
        try{ ctx = new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ return null; }
      }
      if(ctx && ctx.state==='suspended') ctx.resume().catch(()=>{});
      return ctx;
    }
    function isOn(){ return state.sfxOn !== false; }
    function tone(freq, duration, type, startGain, freqEnd){
      if(!isOn()) return;
      const c = getCtx(); if(!c) return;
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, c.currentTime);
      if(freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd,1), c.currentTime+duration);
      gain.gain.setValueAtTime(startGain||0.15, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime+duration);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(); osc.stop(c.currentTime+duration);
    }
    function noiseBurst(duration, startGain, filterFreq){
      if(!isOn()) return;
      const c = getCtx(); if(!c) return;
      const n = Math.floor(c.sampleRate*duration);
      const buffer = c.createBuffer(1, n, c.sampleRate);
      const data = buffer.getChannelData(0);
      for(let i=0;i<n;i++) data[i] = (Math.random()*2-1) * Math.pow(1-i/n, 2);
      const src = c.createBufferSource(); src.buffer = buffer;
      const filter = c.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value = filterFreq||800;
      const gain = c.createGain();
      gain.gain.setValueAtTime(startGain||0.3, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime+duration);
      src.connect(filter); filter.connect(gain); gain.connect(c.destination);
      src.start(); src.stop(c.currentTime+duration);
    }
    return {
      unlock(){ getCtx(); },
      launch(){ tone(180,0.22,'sawtooth',0.10,420); },
      hit(){ tone(320,0.08,'square',0.12,120); },
      kill(){ tone(660,0.12,'triangle',0.15,880); },
      bossKill(){ tone(220,0.5,'sawtooth',0.18,660); setTimeout(()=>tone(440,0.4,'triangle',0.16,880),120); },
      explosion(){ noiseBurst(0.4,0.32,500); tone(90,0.35,'sine',0.18,40); },
      split(){ tone(520,0.1,'sine',0.12,760); },
      freeze(){ tone(900,0.2,'sine',0.09,1400); },
      barrel(){ noiseBurst(0.3,0.28,700); },
      clear(){ [523,659,784,1046].forEach((f,i)=> setTimeout(()=> tone(f,0.25,'triangle',0.14), i*90)); },
      fail(){ tone(220,0.5,'sawtooth',0.14,90); },
      click(){ tone(700,0.05,'sine',0.07); },
      buy(){ tone(880,0.09,'sine',0.1,1200); },
    };
  })();

  const canvas = el('game');
  const ctx = canvas.getContext('2d');
  // 高解像度端末（Retina等）対応：内部の描画バッファをdevicePixelRatio倍に拡大し、
  // 描画座標はそのまま(390x460)使えるようctx.scaleで補正する。
  // これをしないと、iPhone等の高DPI端末でCanvas全体（背景・砦・モンスター含む）がぼやけて表示される。
  (function setupHiDPICanvas(){
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = 390 * dpr;
    canvas.height = 460 * dpr;
    ctx.scale(dpr, dpr);
  })();

  let engine, world;
  let blocks = [], enemiesArr = [], fragments = [], freezeTimers = [], barrels = [];
  let current = null;
  let ammoQueue = [], queueIndex = 0;
  let stageScore = 0, currentStage = 1, totalEnemiesThisStage = 0;
  let inGame = false, stageOver = false;
  let dragging = false, dragPoint = null;
  let trajectoryHint = true;
  let turnTimer = 0, speedMul = 1;
  let toRemove = [], particles = [], explosions = [];
  let gameClock = 0;
  let killsThisTurn = 0;
  let shakeAmount = 0;
  let trailPoints = [];
  let debris = [];
  function triggerShake(amount){ shakeAmount = Math.max(shakeAmount, amount); }
  function spawnDebris(x,y,color,count){
    for(let i=0;i<count;i++){
      const ang = Math.random()*Math.PI*2;
      const spd = 1.5+Math.random()*3.5;
      debris.push({
        x,y, vx:Math.cos(ang)*spd, vy:Math.sin(ang)*spd-1.5,
        t:0, life:500+Math.random()*300, color, size:2+Math.random()*3,
        rot: Math.random()*Math.PI*2, vrot:(Math.random()-0.5)*0.3,
      });
    }
  }

  function isBossStage(n){ return localStageInfo(n).localN % 5 === 0; }
  function bossHpForStage(n){
    const { worldIndex, localN } = localStageInfo(n);
    const base = localN >= 10 ? 7 : 4;
    return base + (worldIndex-1)*3;
  }

  function stageParams(n){
    const { worldIndex, localN } = localStageInfo(n);
    const worldBonus = worldIndex - 1; // ワールドが進むごとに難易度の底上げ
    const capped = Math.min(localN, 4) + worldBonus;
    const boss = localN % 5 === 0;
    return {
      rows: 2+capped + (boss?1:0),
      baseCount: Math.min(3+capped + (boss?1:0), 6), // 城壁がカタパルト側までせり出さないよう上限
      enemyHp: (localN>=7 ? 2 : 1) + worldBonus,
      ammoLen: Math.max(3, 4+Math.min(localN,5)) + (boss?2:0) + worldBonus,
      threshBonus: Math.min(localN,10)*0.035 + worldBonus*0.05,
      isBoss: boss,
      barrelCount: (localN<3 ? 0 : (boss ? 2 : 1)) + Math.min(worldBonus,1),
    };
  }
  function rowBlocksX(count){
    const arr=[]; for(let i=0;i<count;i++) arr.push(FORT_RIGHT_EDGE - i*(BLOCK_W+BLOCK_GAP)); return arr;
  }

  let castleDecor = null; // 旗の描画用に、塔の最上段ブロックを保持

  function buildFortress(sp, stageN){
    castleDecor = { flags: [] };
    const baseY = GROUND_Y - BLOCK_H/2 - 2;
    const wallCount = sp.baseCount;             // 城壁の横幅（ブロック数）
    const wallRows = 2;                          // 城壁の厚み（段数）
    const towerRows = Math.min(sp.rows, 4);       // 塔が城壁の上にさらに積む段数（画面上部にはみ出さないよう上限あり）
    const xs = rowBlocksX(wallCount);
    const leftX = Math.min.apply(null, xs);
    const rightX = Math.max.apply(null, xs);

    // ① 城壁（横方向に2段）
    for(let r=0; r<wallRows; r++){
      const y = baseY - r*(BLOCK_H+BLOCK_GAP);
      xs.forEach(x=> addBlock(x,y,BLOCK_W,BLOCK_H));
    }
    const wallTopY = baseY - (wallRows-1)*(BLOCK_H+BLOCK_GAP);

    // ② 城壁の上の胸壁（凹凸）。1つおきに小さいブロックを乗せる（隙間には敵を立たせる）
    for(let i=0;i<xs.length;i+=2){
      addBlock(xs[i], wallTopY-(BLOCK_H+BLOCK_GAP)/2-7, 16, 14, true);
    }

    // ③ 両端の塔（城壁より高く積み上げる）
    function buildTower(x, extraRows){
      let topBlock = null;
      for(let r=wallRows; r<wallRows+extraRows; r++){
        const y = baseY - r*(BLOCK_H+BLOCK_GAP);
        topBlock = addBlock(x,y,BLOCK_W,BLOCK_H);
      }
      const topY = baseY - (wallRows+extraRows-1)*(BLOCK_H+BLOCK_GAP);
      return {topBlock, topY};
    }
    const leftTower = buildTower(leftX, towerRows);
    const rightTower = buildTower(rightX, towerRows);
    castleDecor.flags.push(leftTower.topBlock, rightTower.topBlock);
    castleDecor.gate = {x:(leftX+rightX)/2, y:baseY+BLOCK_H/2+2};

    // ④ ボスステージ：中央にひときわ高い主塔（キープ）
    let keep = null, keepX = null;
    if(sp.isBoss){
      keepX = (leftX+rightX)/2;
      keep = buildTower(keepX, Math.min(towerRows+1, 5));
      castleDecor.flags.push(keep.topBlock);
    }

    // ---------- 敵配置（すべて構造物の"上"、隣接ブロックと重ならない位置） ----------
    if(sp.isBoss){
      addBoss(keepX, keep.topY-BLOCK_H/2-26, bossHpForStage(stageN));
      addEnemy(leftX, leftTower.topY-BLOCK_H/2-16, sp.enemyHp);
      addEnemy(rightX, rightTower.topY-BLOCK_H/2-16, sp.enemyHp);
    } else {
      addEnemy(leftX, leftTower.topY-BLOCK_H/2-16, sp.enemyHp);
      addEnemy(rightX, rightTower.topY-BLOCK_H/2-16, sp.enemyHp);
    }
    // 城壁の上（胸壁の隙間＝奇数インデックス）に立つ雑魚。
    // 両端の塔・中央キープの柱が通る位置（leftX/rightX/keepX付近）は必ず除外する。
    const excludeXs = [leftX, rightX];
    if(sp.isBoss) excludeXs.push(keepX);
    const wallEnemyCount = Math.max(1, Math.min(4, sp.rows-1));
    const oddSlots = [];
    for(let i=1;i<xs.length;i+=2){
      const tooClose = excludeXs.some(ex=> Math.abs(xs[i]-ex) < BLOCK_W);
      if(!tooClose) oddSlots.push(xs[i]);
    }
    for(let i=0;i<wallEnemyCount && i<oddSlots.length;i++){
      const idx = Math.floor(i*(oddSlots.length/wallEnemyCount));
      addEnemy(oddSlots[idx], wallTopY-BLOCK_H/2-15, sp.enemyHp);
    }

    // 爆発樽の配置（ステージ3以降。城壁とカタパルトの間の安全な範囲内にのみ設置）
    const barrelSpacing = 30;
    const barrelZoneRight = leftX - BLOCK_W/2 - 14;
    const barrelZoneLeft = 112;
    const maxBarrelsFit = Math.max(0, Math.floor((barrelZoneRight - barrelZoneLeft) / barrelSpacing) + 1);
    const actualBarrelCount = Math.min(sp.barrelCount, maxBarrelsFit);
    for(let i=0;i<actualBarrelCount;i++){
      addBarrel(barrelZoneRight - i*barrelSpacing, GROUND_Y-16);
    }
  }

  function addBlock(x,y,w,h,isCrenel){
    const b = Bodies.rectangle(x,y,w,h,{density:isCrenel?0.0008:0.0015, friction:0.6, restitution:0.05, label:'block'});
    b.blockW=w; b.blockH=h; b.isCrenel=!!isCrenel;
    blocks.push(b); World.add(world,b);
    return b;
  }
  function addEnemy(x,y,hp){
    const e = Bodies.circle(x,y,12,{density:0.002, friction:0.5, restitution:0.15, label:'enemy', frictionAir:0.01});
    e.baseFrictionAir=0.01; e.hp=hp; e.maxHp=hp; e.hitFlash=0; e.isBoss=false;
    enemiesArr.push(e); World.add(world,e);
  }
  function addBoss(x,y,hp){
    const e = Bodies.circle(x,y,21,{density:0.0035, friction:0.5, restitution:0.1, label:'enemy', frictionAir:0.01});
    e.baseFrictionAir=0.01; e.hp=hp; e.maxHp=hp; e.hitFlash=0; e.isBoss=true;
    enemiesArr.push(e); World.add(world,e);
  }
  function addBarrel(x,y){
    const b = Bodies.rectangle(x,y,22,26,{density:0.0012, friction:0.6, restitution:0.1, label:'barrel'});
    b.exploded=false;
    barrels.push(b); World.add(world,b);
  }

  function buildAmmoQueue(n){
    const sp = stageParams(n);
    const pool = MONSTER_ORDER.filter(k=> state.monsters[k].owned);
    const queue = [];
    for(let i=0;i<sp.ammoLen;i++) queue.push(pool[Math.floor(Math.random()*pool.length)]);
    return queue;
  }

  function enterStage(n){
    currentStage = n;
    engine = Engine.create();
    engine.gravity.y = 1;
    world = engine.world;
    blocks=[]; enemiesArr=[]; fragments=[]; freezeTimers=[]; barrels=[]; castleDecor=null;
    toRemove=[]; particles=[]; explosions=[]; debris=[]; trailPoints=[]; shakeAmount=0;
    gameClock=0; killsThisTurn=0; stageScore=0; stageOver=false;
    dragging=false; dragPoint=null; speedMul=1; el('speedBtn').textContent='x1';
    buildGroundDecor();

    const ground = Bodies.rectangle(W/2, GROUND_Y+15, W+40, 30, {isStatic:true, label:'ground', friction:0.9});
    World.add(world, ground);

    const sp = stageParams(n);
    buildFortress(sp, n);
    totalEnemiesThisStage = enemiesArr.length;

    ammoQueue = buildAmmoQueue(n);
    queueIndex = 0;
    current = null;

    Events.on(engine, 'collisionStart', onCollisionStart);

    inGame = true;
    spawnNext();
    updateHUD();
    renderQueue();
    showScreen('game');
  }

  function spawnNext(){
    if(queueIndex >= ammoQueue.length){ current=null; return; }
    const type = ammoQueue[queueIndex];
    const def = MONSTER_DEFS[type];
    const body = Bodies.circle(ANCHOR.x, ANCHOR.y, def.radius, {
      density:def.density, friction:def.friction, restitution:def.restitution, isStatic:true, label:'proj_'+type
    });
    World.add(world, body);
    current = { body, type, launched:false, hasSplit:false, exploded:false };
  }

  function onCollisionStart(evt){
    for(const pair of evt.pairs){ handlePair(pair.bodyA, pair.bodyB); handlePair(pair.bodyB, pair.bodyA); }
  }

  function handlePair(a, b){
    if(stageOver) return;
    if(a.label==='enemy' && enemiesArr.includes(a)){
      const relSpeed = Vector.magnitude(Vector.sub(a.velocity, b.velocity));
      const mult = levelMult(current ? current.type : null);
      const required = BASE_THRESHOLD * (1 + stageParams(currentStage).threshBonus);
      if(relSpeed*mult > required && b.label!=='ground'){
        damageEnemy(a, 1, 'proj');
      }
    }
    if(a.label==='barrel' && barrels.includes(a) && !a.exploded){
      const relSpeed = Vector.magnitude(Vector.sub(a.velocity, b.velocity));
      if(relSpeed > 1.0 && b.label!=='ground'){
        explodeBarrel(a);
      }
    }
    if(!current) return;
    if(a===current.body && a.label==='proj_slime' && !current.hasSplit && b.label!=='proj_slime'){
      current.hasSplit = true; splitSlime(a);
    }
    if(a===current.body && a.label==='proj_dragon' && !current.exploded && b.label!=='proj_dragon'){
      current.exploded = true; explodeAt(a.position);
    }
    if(a===current.body && a.label==='proj_icegolem' && !current.exploded && b.label!=='proj_icegolem'){
      current.exploded = true; freezeAt(a.position);
    }
  }

  function damageEnemy(body, amount, source){
    body.hp -= amount;
    if(body.hp <= 0){
      killEnemy(body, source);
    } else {
      body.hitFlash = 1.0;
      pushParticle(body.position.x, body.position.y-14, body.isBoss?`HIT ${body.hp}/${body.maxHp}`:'HIT', '#ffb057');
      spawnDebris(body.position.x, body.position.y, '#ffb057', 4);
      triggerShake(3);
      SFX.hit();
    }
  }

  function killEnemy(body, source){
    toRemove.push(body);
    const idx = enemiesArr.indexOf(body);
    if(idx>=0) enemiesArr.splice(idx,1);
    const points = body.isBoss ? body.maxHp*150 : 100;
    stageScore += points;
    killsThisTurn++;
    bumpMissionTrack('anyKill', 1);
    if(current) bumpMissionTrack('type:'+current.type, 1);
    if(source==='explosion') bumpMissionTrack('explosionKill', 1);
    pushParticle(body.position.x, body.position.y, (body.isBoss?'BOSS撃破 +':'+')+points, body.isBoss?'#ffd35e':'#f0c04a');
    spawnDebris(body.position.x, body.position.y, body.isBoss?'#c68aff':'#c9453a', body.isBoss?16:8);
    triggerShake(body.isBoss?16:6);
    if(body.isBoss){
      explosions.push({x:body.position.x, y:body.position.y, t:0});
      SFX.bossKill();
    } else {
      SFX.kill();
    }
    updateHUD();
    if(enemiesArr.length===0 && !stageOver){ endStage(true); }
  }


  function explodeBarrel(barrel){
    barrel.exploded = true;
    const idx = barrels.indexOf(barrel);
    if(idx>=0) barrels.splice(idx,1);
    toRemove.push(barrel);
    const pos = {x:barrel.position.x, y:barrel.position.y};
    const RADIUS=64, FORCE=0.04, KILL_RADIUS=40;
    [...blocks, ...enemiesArr, ...fragments].forEach(body=>{
      const d = Vector.magnitude(Vector.sub(body.position, pos));
      if(d < RADIUS){
        const dir = Vector.normalise(Vector.sub(body.position, pos));
        const power = (1-d/RADIUS) * FORCE;
        Body.applyForce(body, body.position, {x:dir.x*power, y:dir.y*power-power*0.25});
      }
    });
    [...enemiesArr].forEach(e=>{
      const d = Vector.magnitude(Vector.sub(e.position, pos));
      if(d < KILL_RADIUS) damageEnemy(e, e.isBoss?2:e.hp, 'explosion');
    });
    pushParticle(pos.x, pos.y-10, '誘爆!', '#ff8a3d');
    explosions.push({x:pos.x, y:pos.y, t:0});
    spawnDebris(pos.x, pos.y, '#ff8a3d', 14);
    triggerShake(12);
    SFX.barrel();
    // 連鎖：範囲内の他の樽も誘爆させる
    [...barrels].forEach(other=>{
      if(other.exploded) return;
      const d = Vector.magnitude(Vector.sub(other.position, pos));
      if(d < RADIUS) explodeBarrel(other);
    });
  }

  function splitSlime(body){
    const pos = {x:body.position.x, y:body.position.y};
    const vel = body.velocity;
    toRemove.push(body);
    [-0.5,0,0.5].forEach(da=>{
      const speed = Vector.magnitude(vel)*0.6 || 3;
      const baseAngle = Math.atan2(vel.y, vel.x) + da;
      const frag = Bodies.circle(pos.x, pos.y-4, 6, {density:0.001, friction:0.5, restitution:0.35, label:'frag'});
      Body.setVelocity(frag, {x:Math.cos(baseAngle)*speed, y:Math.sin(baseAngle)*speed-1});
      World.add(world, frag); fragments.push(frag);
    });
    pushParticle(pos.x, pos.y-14, '分裂!', '#7bd66b');
    spawnDebris(pos.x, pos.y, '#7bd66b', 6);
    SFX.split();
  }

  function explodeAt(pos){
    const RADIUS=78, FORCE=0.045, KILL_RADIUS=48;
    [...blocks, ...enemiesArr, ...fragments].forEach(body=>{
      const d = Vector.magnitude(Vector.sub(body.position, pos));
      if(d<RADIUS){
        const dir = Vector.normalise(Vector.sub(body.position, pos));
        const power = (1-d/RADIUS)*FORCE;
        Body.applyForce(body, body.position, {x:dir.x*power, y:dir.y*power-power*0.3});
      }
    });
    [...enemiesArr].forEach(e=>{
      const d = Vector.magnitude(Vector.sub(e.position, pos));
      if(d<KILL_RADIUS) damageEnemy(e, e.isBoss?3:e.hp, 'explosion');
    });
    pushParticle(pos.x, pos.y-10, '爆発!', '#ff8a3d');
    explosions.push({x:pos.x, y:pos.y, t:0});
    spawnDebris(pos.x, pos.y, '#ff8a3d', 16);
    triggerShake(14);
    SFX.explosion();
  }

  function freezeAt(pos){
    const RADIUS=68;
    enemiesArr.forEach(e=>{
      const d = Vector.magnitude(Vector.sub(e.position, pos));
      if(d<RADIUS){ e.frictionAir=0.9; freezeTimers.push({body:e, until: gameClock+2200}); }
    });
    pushParticle(pos.x, pos.y-10, '凍結!', '#5fc7e0');
    SFX.freeze();
  }

  function pushParticle(x,y,text,color){ particles.push({x,y,text,color,t:0,life:800}); }

  function updateHUD(){
    el('ammoVal').textContent = Math.max(0, ammoQueue.length - queueIndex - (current && current.launched ? 1 : 0));
    el('enemyVal').textContent = enemiesArr.length + '/' + totalEnemiesThisStage;
    el('scoreVal').textContent = stageScore;
    el('stageLabel').textContent = localStageInfo(currentStage).localN;
    const st = state.stages[currentStage];
    const stars = st ? st.stars : 0;
    el('stageStarsHud').textContent = '★★★'.slice(0,stars) + '☆☆☆'.slice(0,3-stars);
  }

  function renderQueue(){
    const wrap = el('queueTray');
    const counts = {};
    const order = [];
    for(let i=queueIndex;i<ammoQueue.length;i++){
      const t = ammoQueue[i];
      if(!counts[t]){ counts[t]=0; order.push(t); }
      counts[t]++;
    }
    wrap.innerHTML = order.map(t=>{
      const def = MONSTER_DEFS[t];
      const hasImg = !!IMAGE_ASSETS.monsters[t];
      const style = hasImg ? monsterIconStyle(t) : '';
      return `<div class="next-chip" style="${style}">${hasImg?'':def.emoji}<span class="qty">x${counts[t]}</span></div>`;
    }).join('');
  }

  function endStage(cleared){
    stageOver = true;
    inGame = false;
    state.totalScore += stageScore;
    if(cleared) SFX.clear(); else SFX.fail();

    if(cleared){
      const leftover = Math.max(0, ammoQueue.length - queueIndex - 1);
      const stars = leftover >= Math.ceil(ammoQueue.length*0.4) ? 3 : (leftover>=1 ? 2 : 1);
      const goldReward = 80 + currentStage*20 + stars*40;
      state.gold += goldReward;
      const prevStars = state.stages[currentStage] ? state.stages[currentStage].stars : 0;
      state.stages[currentStage] = { cleared:true, stars: Math.max(prevStars, stars) };
      bumpMissionTrack('stageClear', 1);
      if(leftover>=1) bumpMissionTrack('leftover', 1);
      if(killsThisTurn>=2) bumpMissionTrack('combo', 1);
      saveState();

      overlayTitleEl.textContent = 'ステージクリア！';
      overlayTitleEl.className = 'win';
      overlayStarsEl.innerHTML = '<span class="'+(stars>=1?'lit':'')+'">★</span><span class="'+(stars>=2?'lit':'')+'">★</span><span class="'+(stars>=3?'lit':'')+'">★</span>';
      overlayScoreEl.textContent = stageScore;
      overlayGoldEl.textContent = goldReward;
      const { worldIndex, localN } = localStageInfo(currentStage);
      const isWorldEnd = localN === STAGES_PER_WORLD;
      const isFinalStage = currentStage >= TOTAL_STAGES;
      if(isFinalStage){
        overlayTextEl.textContent = `全${WORLDS.length}ワールド・${TOTAL_STAGES}ステージを制圧した！お見事！`;
      } else if(isWorldEnd){
        const nextWorld = WORLDS[worldIndex]; // 0-indexed配列なのでworldIndexが次のワールド
        overlayTextEl.textContent = `ワールド${worldIndex}「${WORLDS[worldIndex-1].name}」制覇！新たなワールド「${nextWorld.name}」が解放された！`;
      } else {
        overlayTextEl.textContent = '砦を制圧した。次のステージへ進もう。';
      }

      if(currentStage < TOTAL_STAGES){
        overlayPrimaryEl.textContent = '▶ 次のステージへ';
        overlayPrimaryEl.onclick = ()=>{ closeOverlay(); enterStage(currentStage+1); };
        overlaySecondaryEl.classList.remove('hidden');
      } else {
        overlayPrimaryEl.textContent = '🗺️ ワールドマップへ';
        overlayPrimaryEl.onclick = ()=>{ closeOverlay(); showScreen('map'); };
        overlaySecondaryEl.classList.add('hidden');
      }
      overlaySecondaryEl.textContent = '🗺️ マップに戻る';
      overlaySecondaryEl.onclick = ()=>{ closeOverlay(); showScreen('map'); };
    } else {
      const goldReward = Math.round(stageScore*0.3);
      state.gold += goldReward;
      saveState();

      overlayTitleEl.textContent = '弾切れ…';
      overlayTitleEl.className = 'lose';
      overlayStarsEl.innerHTML = '';
      overlayScoreEl.textContent = stageScore;
      overlayGoldEl.textContent = goldReward;
      overlayTextEl.textContent = '砦の敵を全て倒しきれなかった。編成を見直して再挑戦しよう。';
      overlayPrimaryEl.textContent = '🔄 もう一度挑戦';
      overlayPrimaryEl.onclick = ()=>{ closeOverlay(); enterStage(currentStage); };
      overlaySecondaryEl.classList.remove('hidden');
      overlaySecondaryEl.textContent = '🗺️ マップに戻る';
      overlaySecondaryEl.onclick = ()=>{ closeOverlay(); showScreen('map'); };
    }
    if(engine) Events.off(engine, 'collisionStart', onCollisionStart);
    overlayEl.classList.remove('hidden');
  }
  function closeOverlay(){ overlayEl.classList.add('hidden'); }

  el('pauseBtn').addEventListener('click', ()=>{
    inGame = false;
    if(engine) Events.off(engine, 'collisionStart', onCollisionStart);
    showScreen('map');
  });

  const speedBtnEl = el('speedBtn');
  speedBtnEl.addEventListener('click', ()=>{ speedMul = speedMul===1?2:1; speedBtnEl.textContent='x'+speedMul; });
  el('skipBtn').addEventListener('click', ()=>{ if(current && current.launched) forceNextTurn(); });
  const hintBtnEl = el('hintBtn');
  hintBtnEl.classList.add('active');
  hintBtnEl.addEventListener('click', ()=>{
    trajectoryHint = !trajectoryHint;
    hintBtnEl.classList.toggle('active', trajectoryHint);
  });

  function computeTrajectoryPreview(dx, dy){
    const pts = [];
    let vx = dx*LAUNCH_SCALE, vy = dy*LAUNCH_SCALE;
    let x = ANCHOR.x, y = ANCHOR.y;
    const gravStep = engine ? engine.gravity.y * engine.gravity.scale : 0.001;
    for(let i=0;i<70;i++){
      vy += gravStep;
      x += vx; y += vy;
      if(i%3===0) pts.push({x,y});
      if(y > GROUND_Y || x > W+20) break;
    }
    return pts;
  }

  function forceNextTurn(){
    if(current && current.body) toRemove.push(current.body);
    if(killsThisTurn>=2) bumpMissionTrack('combo', 1);
    killsThisTurn = 0;
    queueIndex++;
    current = null;
    trailPoints = [];
    if(queueIndex >= ammoQueue.length){ if(!stageOver) endStage(false); }
    else spawnNext();
    updateHUD(); renderQueue();
  }

  // ---------- 入力 ----------
  function canvasPointFromEvent(e){
    const rect = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return { x: cx*(W/rect.width), y: cy*(H/rect.height) };
  }
  function onDown(e){
    if(!inGame || stageOver || !current || current.launched) return;
    const p = canvasPointFromEvent(e);
    if(Math.hypot(p.x-current.body.position.x, p.y-current.body.position.y) < 42){
      dragging = true; dragPoint = p; e.preventDefault();
    }
  }
  function onMove(e){
    if(!dragging) return;
    const p = canvasPointFromEvent(e);
    let dx=p.x-ANCHOR.x, dy=p.y-ANCHOR.y;
    const dist = Math.hypot(dx,dy);
    if(dist>MAX_PULL){ dx=dx/dist*MAX_PULL; dy=dy/dist*MAX_PULL; }
    dragPoint = {x:ANCHOR.x+dx, y:ANCHOR.y+dy};
    Body.setPosition(current.body, dragPoint);
    e.preventDefault();
  }
  function onUp(){
    if(!dragging) return;
    dragging = false;
    const dx = ANCHOR.x-dragPoint.x, dy = ANCHOR.y-dragPoint.y;
    const dist = Math.hypot(dx,dy);
    if(dist>14){
      Body.setStatic(current.body, false);
      Body.setVelocity(current.body, {x:dx*LAUNCH_SCALE, y:dy*LAUNCH_SCALE});
      current.launched = true; turnTimer = TURN_DURATION;
      SFX.launch();
    } else {
      Body.setPosition(current.body, ANCHOR);
    }
    dragPoint = null; updateHUD();
  }
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, {passive:false});
  canvas.addEventListener('touchmove', onMove, {passive:false});
  canvas.addEventListener('touchend', onUp);

  // ---------- メインループ ----------
  let lastTs = null;
  function loop(ts){
    if(lastTs===null) lastTs = ts;
    const dt = Math.min(ts-lastTs, 33);
    lastTs = ts;
    if(inGame && !stageOver){
      for(let i=0;i<speedMul;i++) Engine.update(engine, 16.666);
      update(dt*speedMul);
    }
    if(inGame) render();
    requestAnimationFrame(loop);
  }

  function update(dt){
    gameClock += dt;
    if(toRemove.length){
      toRemove.forEach(b=>{ try{ World.remove(world,b); }catch(e){} });
      fragments = fragments.filter(f=>!toRemove.includes(f));
      toRemove = [];
    }
    fragments = fragments.filter(f=>{
      if(f.position.y>H+80 || f.position.x>W+120){ World.remove(world,f); return false; }
      return true;
    });

    if(current && current.launched && current.type==='centaur'){
      const g = engine.gravity;
      const lift = current.body.mass * g.y * g.scale * 0.5;
      Body.applyForce(current.body, current.body.position, {x:0, y:-lift});
    }

    for(let i=freezeTimers.length-1;i>=0;i--){
      if(gameClock >= freezeTimers[i].until){
        freezeTimers[i].body.frictionAir = freezeTimers[i].body.baseFrictionAir;
        freezeTimers.splice(i,1);
      }
    }

    enemiesArr.forEach(e=>{ if(e.hitFlash>0) e.hitFlash = Math.max(0, e.hitFlash - dt/300); });

    shakeAmount = Math.max(0, shakeAmount - dt*0.045);

    for(let i=debris.length-1;i>=0;i--){
      const d = debris[i];
      d.t += dt;
      d.x += d.vx; d.y += d.vy; d.vy += 0.15; d.rot += d.vrot;
      if(d.t > d.life) debris.splice(i,1);
    }

    if(current && current.launched){
      trailPoints.push({x:current.body.position.x, y:current.body.position.y, t:0});
      if(trailPoints.length>14) trailPoints.shift();
    }
    trailPoints.forEach(p=> p.t+=dt);
    trailPoints = trailPoints.filter(p=> p.t<260);

    if(current && current.launched){
      turnTimer -= dt;
      const p = current.body.position;
      const offscreen = p.y>H+100 || p.x>W+140 || p.x<-140 || p.y<-220;
      const stillExists = Composite.get(world, current.body.id, 'body');
      if(turnTimer<=0 || offscreen || !stillExists){
        if(stillExists) World.remove(world, current.body);
        if(killsThisTurn>=2) bumpMissionTrack('combo', 1);
        killsThisTurn = 0;
        queueIndex++;
        current = null;
        trailPoints = [];
        if(queueIndex >= ammoQueue.length){ if(!stageOver) endStage(false); }
        else spawnNext();
        renderQueue();
      }
    }

    for(let i=particles.length-1;i>=0;i--){ particles[i].t+=dt; if(particles[i].t>particles[i].life) particles.splice(i,1); }
    for(let i=explosions.length-1;i>=0;i--){ explosions[i].t+=dt; if(explosions[i].t>500) explosions.splice(i,1); }
    updateHUD();
  }

  function drawRectBody(b,color){
    ctx.save();
    ctx.translate(b.position.x, b.position.y);
    ctx.rotate(b.angle);
    const blockImg = loadedImages.blocks[stageBackgroundKey(currentStage)];
    if(blockImg){
      ctx.drawImage(blockImg, -b.blockW/2,-b.blockH/2,b.blockW,b.blockH);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(-b.blockW/2,-b.blockH/2,b.blockW,b.blockH);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth=1;
    ctx.strokeRect(-b.blockW/2,-b.blockH/2,b.blockW,b.blockH);
    ctx.restore();
  }

  const groundColors = {
    meadow:{a:'#3a3018', b:'#181405'}, forest:{a:'#1c3018', b:'#0a1206'},
    cave:{a:'#141a2c', b:'#050810'},   snow:{a:'#c8dcf0', b:'#7a94b8'},
    volcano:{a:'#4a1408', b:'#180402'},
  };
  let groundDecor = null;
  function buildGroundDecor(){
    groundDecor = [];
    for(let i=0;i<22;i++){
      groundDecor.push({
        x: Math.random()*W, y: GROUND_Y + 6 + Math.random()*(H-GROUND_Y-10),
        type: Math.random()<0.55 ? 'rock' : 'grass',
        s: 0.7+Math.random()*0.8,
      });
    }
  }

  function drawFallbackSky(){
    const g = ctx.createLinearGradient(0,0,0,GROUND_Y);
    g.addColorStop(0,'#3a4678'); g.addColorStop(1,'#a8909a');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,GROUND_Y);
    // 太陽のグロー
    const sx=300, sy=70;
    [ [140,0.04],[100,0.06],[60,0.10],[30,0.16] ].forEach(([r,a])=>{
      ctx.beginPath(); ctx.fillStyle = `rgba(255,220,160,${a})`;
      ctx.arc(sx,sy,r,0,Math.PI*2); ctx.fill();
    });
    // 雲
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    [[90,90,1.0],[230,50,0.7],[150,140,0.5]].forEach(([cx,cy,s])=>{
      [[0,0,26],[20,4,20],[-18,6,18],[8,-10,16]].forEach(([dx,dy,r])=>{
        ctx.beginPath(); ctx.arc(cx+dx*s,cy+dy*s,r*s,0,Math.PI*2); ctx.fill();
      });
    });
  }

  function render(){
    ctx.clearRect(0,0,W,H);
    ctx.save();
    if(shakeAmount>0.3){
      const sx=(Math.random()-0.5)*shakeAmount, sy=(Math.random()-0.5)*shakeAmount;
      ctx.translate(sx,sy);
    }
    const bgImg = loadedImages.backgrounds[stageBackgroundKey(currentStage)];
    if(bgImg){
      ctx.drawImage(bgImg, 0, 0, W, H);
      ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(0,0,W,H); // 手前の要素を見やすくする薄暗め
    } else {
      drawFallbackSky();
    }

    if(!groundDecor) buildGroundDecor();

    const g = ctx.createLinearGradient(0,GROUND_Y,0,H);
    const gc = groundColors[stageBackgroundKey(currentStage)] || {a:'#3a2416', b:'#150d08'};
    g.addColorStop(0,gc.a); g.addColorStop(1,gc.b);
    ctx.fillStyle = g; ctx.fillRect(0,GROUND_Y,W,H-GROUND_Y);
    ctx.strokeStyle = 'rgba(255,200,150,0.35)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(0,GROUND_Y); ctx.lineTo(W,GROUND_Y); ctx.stroke();
    // 地面のディテール（岩・草）
    groundDecor.forEach(d=>{
      if(d.type==='rock'){
        ctx.beginPath(); ctx.fillStyle='rgba(0,0,0,0.28)';
        ctx.ellipse(d.x,d.y,4*d.s,2.4*d.s,0,0,Math.PI*2); ctx.fill();
      } else {
        ctx.strokeStyle='rgba(110,160,90,0.55)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(d.x,d.y); ctx.lineTo(d.x-3*d.s,d.y-9*d.s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(d.x,d.y); ctx.lineTo(d.x+3*d.s,d.y-8*d.s); ctx.stroke();
      }
    });

    // カタパルト（拡大・存在感）
    const ax=ANCHOR.x, ay=ANCHOR.y, baseY=GROUND_Y+2;
    ctx.lineCap='round';
    ctx.strokeStyle = '#503a22'; ctx.lineWidth=9;
    ctx.beginPath(); ctx.moveTo(ax-30,baseY); ctx.lineTo(ax,ay); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax+30,baseY); ctx.lineTo(ax,ay); ctx.stroke();
    ctx.strokeStyle = '#78552f'; ctx.lineWidth=4;
    ctx.beginPath(); ctx.moveTo(ax-30,baseY); ctx.lineTo(ax,ay); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax+30,baseY); ctx.lineTo(ax,ay); ctx.stroke();
    ctx.beginPath(); ctx.fillStyle='#3c2a1a'; ctx.ellipse(ax,baseY+2,16,8,0,0,Math.PI*2); ctx.fill();

    if(dragging && current && dragPoint){
      ctx.strokeStyle='#f0c04a'; ctx.lineWidth=2; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.moveTo(ax-30,baseY-4); ctx.lineTo(dragPoint.x,dragPoint.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax+30,baseY-4); ctx.lineTo(dragPoint.x,dragPoint.y); ctx.stroke();
      ctx.setLineDash([]);
      const dx=ANCHOR.x-dragPoint.x, dy=ANCHOR.y-dragPoint.y;
      if(trajectoryHint){
        const pts = computeTrajectoryPreview(dx,dy);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        pts.forEach((p,i)=>{
          const r = Math.max(1, 3 - i*0.03);
          ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
        });
      } else {
        ctx.strokeStyle='rgba(255,138,61,0.6)'; ctx.lineWidth=2;
        ctx.beginPath(); ctx.moveTo(dragPoint.x,dragPoint.y); ctx.lineTo(dragPoint.x+dx*1.6, dragPoint.y+dy*1.6); ctx.stroke();
      }
    }

    if(castleDecor && castleDecor.gate){
      const gx=castleDecor.gate.x, gy=castleDecor.gate.y;
      ctx.fillStyle = 'rgba(10,6,4,0.75)';
      ctx.beginPath();
      ctx.moveTo(gx-15, gy);
      ctx.lineTo(gx-15, gy-26);
      ctx.arc(gx, gy-26, 15, Math.PI, 0);
      ctx.lineTo(gx+15, gy);
      ctx.closePath(); ctx.fill();
    }

    blocks.forEach(b=> drawRectBody(b, b.isCrenel ? '#6b5546' : '#5a4536'));

    // 旗（塔の最上段ブロックに追従して描く。ブロックが崩れると一緒に傾く）
    if(castleDecor && castleDecor.flags){
      castleDecor.flags.forEach(fb=>{
        if(!fb || !blocks.includes(fb)) return;
        ctx.save();
        ctx.translate(fb.position.x, fb.position.y);
        ctx.rotate(fb.angle);
        ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(0,-BLOCK_H/2); ctx.lineTo(0,-BLOCK_H/2-20); ctx.stroke();
        ctx.fillStyle = '#e2483a';
        ctx.beginPath();
        ctx.moveTo(0,-BLOCK_H/2-20);
        ctx.lineTo(16,-BLOCK_H/2-16);
        ctx.lineTo(0,-BLOCK_H/2-11);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      });
    }

    barrels.forEach(b=>{
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = '#6b4526';
      ctx.fillRect(-11,-13,22,26);
      ctx.strokeStyle = '#2a1a0e'; ctx.lineWidth=2;
      ctx.strokeRect(-11,-13,22,26);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(-11,-4); ctx.lineTo(11,-4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-11,5); ctx.lineTo(11,5); ctx.stroke();
      ctx.font='13px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillStyle='#ff6a3d';
      ctx.fillText('⚠', 0, -1);
      ctx.restore();
    });

    enemiesArr.forEach(e=>{
      const frozen = e.frictionAir>0.5;
      const rad = e.isBoss ? 21 : 12;
      if(e.isBoss){
        ctx.beginPath();
        ctx.fillStyle = 'rgba(198,138,255,0.25)';
        ctx.arc(e.position.x,e.position.y,rad+8,0,Math.PI*2); ctx.fill();
      }
      if(loadedImages.enemy){
        ctx.save();
        ctx.translate(e.position.x, e.position.y);
        if(frozen){ ctx.filter = 'hue-rotate(160deg) saturate(1.3)'; }
        const d = rad*2;
        ctx.drawImage(loadedImages.enemy, -rad, -rad, d, d);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.fillStyle = frozen ? '#7fb8e0' : (e.isBoss ? '#7a3fc4' : (e.hp<e.maxHp ? '#e07a5a' : '#c9453a'));
        ctx.arc(e.position.x,e.position.y,rad,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle= e.isBoss ? '#ffd35e' : '#000a'; ctx.lineWidth=e.isBoss?3:2; ctx.stroke();
        ctx.font=(e.isBoss?'24px':'15px')+' serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle='#fff';
        ctx.fillText(frozen?'🥶':(e.isBoss?'👑':'👹'), e.position.x, e.position.y+1);
      }
      if(e.hitFlash>0){
        ctx.beginPath(); ctx.strokeStyle=`rgba(255,255,255,${e.hitFlash})`; ctx.lineWidth=2;
        ctx.arc(e.position.x,e.position.y,rad+5,0,Math.PI*2); ctx.stroke();
      }
      if(e.maxHp>1){
        const bw = e.isBoss ? 44 : 24;
        const by = e.position.y + rad + (e.isBoss?10:9);
        ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.fillRect(e.position.x-bw/2, by-3, bw, 6);
        ctx.fillStyle= e.isBoss ? '#c68aff' : '#7bd66b';
        ctx.fillRect(e.position.x-bw/2, by-3, bw*Math.max(0,e.hp/e.maxHp), 6);
        if(e.isBoss){
          ctx.font='9px "Courier New",monospace'; ctx.fillStyle='#fff'; ctx.textAlign='center';
          ctx.fillText(e.hp+'/'+e.maxHp, e.position.x, by+11);
        }
      }
    });

    fragments.forEach(f=>{ ctx.beginPath(); ctx.fillStyle='#7bd66b'; ctx.arc(f.position.x,f.position.y,6,0,Math.PI*2); ctx.fill(); });

    if(current){
      const def = MONSTER_DEFS[current.type];
      trailPoints.forEach((p,i)=>{
        const a = Math.max(0, 1 - p.t/260) * 0.35;
        const r = 3 + (i/trailPoints.length)*4;
        ctx.beginPath(); ctx.fillStyle = def.color; ctx.globalAlpha = a;
        ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
        ctx.globalAlpha = 1;
      });
      const img = loadedImages.monsters[current.type];
      if(img){
        const vr = def.radius * 1.9; // 見た目は当たり判定より大きく表示
        ctx.save();
        ctx.translate(current.body.position.x, current.body.position.y);
        ctx.rotate(current.body.angle);
        ctx.drawImage(img, -vr, -vr, vr*2, vr*2);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.fillStyle=def.color;
        ctx.arc(current.body.position.x, current.body.position.y, def.radius, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle='#000a'; ctx.lineWidth=1; ctx.stroke();
        ctx.save();
        ctx.translate(current.body.position.x, current.body.position.y);
        ctx.rotate(current.body.angle);
        ctx.font='13px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(def.emoji, 0, 1);
        ctx.restore();
      }
    }

    explosions.forEach(ex=>{
      const p = ex.t/500;
      ctx.beginPath(); ctx.strokeStyle=`rgba(255,138,61,${1-p})`; ctx.lineWidth=3;
      ctx.arc(ex.x,ex.y,20+p*60,0,Math.PI*2); ctx.stroke();
    });

    particles.forEach(p=>{
      const a = 1-p.t/p.life;
      ctx.globalAlpha = Math.max(0,a);
      ctx.font='11px "Courier New",monospace'; ctx.textAlign='center';
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y - p.t/40);
      ctx.globalAlpha = 1;
    });

    debris.forEach(d=>{
      const a = Math.max(0, 1 - d.t/d.life);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.fillStyle = d.color;
      ctx.fillRect(-d.size/2,-d.size/2,d.size,d.size);
      ctx.restore();
    });

    ctx.restore(); // シェイク用のtranslateを解除
  }

  // ---------- 起動 ----------
  preloadImages();
  el('overlayPrimaryBtn'); // no-op ref warm-up
  refreshTopbar();
  refreshMissionDot();
  showScreen('splash');
  if(typeof Matter === 'undefined'){
    alert('物理エンジン(Matter.js)の読み込みに失敗しました。通信環境を確認してください。');
  } else {
    requestAnimationFrame(loop);
  }
})();
