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
  const TOTAL_STAGES = 10;
  const LEVEL_MAX = 5;
  const BASE_THRESHOLD = 2.3;

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
  // 例）background: 'assets/bg-volcano.jpg', monsters:{ slime:'assets/monster-slime.png', ... }
  const IMAGE_ASSETS = {
    background: null,   // ステージ背景（推奨: 390x460以上, jpg/png）
    block: null,         // 砦ブロックのテクスチャ（推奨: 正方形, png）
    enemy: null,         // 敵アイコン（推奨: 64x64, png/透過）
    monsters: {          // 各モンスターの立ち絵/アイコン（推奨: 128x128, png/透過）
      slime:null, dragon:null, icegolem:null, spikeball:null, skeleton:null, centaur:null,
    },
  };
  const loadedImages = { monsters:{} };
  function preloadImages(){
    const tryLoad = (key, path, target)=>{
      if(!path) return;
      const img = new Image();
      img.onload = ()=>{ target[key] = img; };
      img.onerror = ()=>{ /* 読み込み失敗時は既存のCanvas/絵文字描画のまま */ };
      img.src = path;
    };
    tryLoad('background', IMAGE_ASSETS.background, loadedImages);
    tryLoad('block', IMAGE_ASSETS.block, loadedImages);
    tryLoad('enemy', IMAGE_ASSETS.enemy, loadedImages);
    MONSTER_ORDER.forEach(k=> tryLoad(k, IMAGE_ASSETS.monsters[k], loadedImages.monsters));
  }
  // DOM側（モンスターカード等）で画像を使う場合のCSS背景ヘルパー
  function monsterIconStyle(key){
    const path = IMAGE_ASSETS.monsters[key];
    return path ? `background-image:url('${path}'); background-size:cover; background-position:center;` : '';
  }

  const ANCHOR = {x:60, y:360};
  const GROUND_Y = 440;
  const MAX_PULL = 78;
  const LAUNCH_SCALE = 0.17;
  const TURN_DURATION = 3400;
  const W = 390, H = 460;

  // ---------- プレイヤー永続状態 ----------
  function defaultState(){
    const monsters = {};
    MONSTER_ORDER.forEach(k=>{
      monsters[k] = { owned: MONSTER_DEFS[k].ownedDefault, level: MONSTER_DEFS[k].ownedDefault ? 1 : 0 };
    });
    return { gold: 300, monsters, stages: {}, totalScore: 0 };
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

  function refreshTopbar(){ goldTopEl.textContent = state.gold; }

  function showScreen(name){
    Object.keys(screens).forEach(k=> screens[k].classList.toggle('hidden', k!==name));
    const chromeless = (name==='game' || name==='splash');
    topbar.classList.toggle('hidden', chromeless);
    bottomNav.classList.toggle('hidden', chromeless);
    document.querySelectorAll('.nav-item').forEach(n=> n.classList.toggle('active', n.dataset.nav===name));
    if(name==='map') renderMap();
    if(name==='monsters') renderMonsters();
    if(name==='shop') renderShop();
    if(name==='missions') renderMissions();
    if(name==='ranking'){ el('myTotalScore').textContent = state.totalScore; loadRanking(); }
    if(name==='splash'){ el('splashHighScore').textContent = state.totalScore; el('splashGold').textContent = state.gold; }
    refreshTopbar();
  }
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click', ()=> showScreen(item.dataset.nav));
  });
  el('splashPlayBtn').addEventListener('click', ()=> showScreen('map'));
  (function setSplashIcon(){
    const img = new Image();
    img.onload = ()=>{ el('splashIcon').style.backgroundImage = `url('icons/icon-192.png')`; el('splashIcon').textContent=''; };
    img.onerror = ()=>{ /* 画像未取得ならデフォルト絵文字のまま */ };
    img.src = 'icons/icon-192.png';
  })();

  // ---------- ワールドマップ ----------
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
    const pts = [];
    let html = '';
    for(let i=0;i<TOTAL_STAGES;i++){
      const n = i+1;
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
                 ${n%5===0?'<div class="boss-badge">BOSS</div>':''}
                 ${locked ? '<div class="lock-icon">🔒</div>' : `<div class="num">${n}</div><div class="stars">${starStr}</div>`}
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
  const canvas = el('game');
  const ctx = canvas.getContext('2d');

  let engine, world;
  let blocks = [], enemiesArr = [], fragments = [], freezeTimers = [];
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

  function stageParams(n){
    const capped = Math.min(n, 4);
    return {
      rows: 2+capped,
      baseCount: 3+capped,
      enemyHp: n>=7 ? 2 : 1,
      ammoLen: Math.max(3, 4+Math.min(n,5)),
      threshBonus: Math.min(n,10)*0.035,
    };
  }
  function rowBlocksX(count){
    const arr=[]; for(let i=0;i<count;i++) arr.push(349 - i*30); return arr;
  }

  function buildFortress(sp){
    const rowsData = [];
    for(let r=0;r<sp.rows;r++){
      const count = sp.baseCount - r;
      if(count<1) break;
      const y = 400 - r*28;
      const xs = rowBlocksX(count);
      const h = (r===sp.rows-1) ? 24 : 28;
      xs.forEach(x=> addBlock(x,y,26,h));
      rowsData.push({r,y,xs,count});
    }
    const top = rowsData[rowsData.length-1];
    const apexX = (top.xs[0]+top.xs[top.xs.length-1])/2;
    addEnemy(apexX, top.y-21, sp.enemyHp);

    const bottom = rowsData[0];
    addEnemy(Math.min.apply(null,bottom.xs)-25, 408, sp.enemyHp);
    addEnemy(Math.max.apply(null,bottom.xs)+25, 408, sp.enemyHp);

    for(let r=1;r<=sp.rows-2;r++){
      const row = rowsData[r];
      const cx = row.xs.reduce((a,b)=>a+b,0)/row.xs.length;
      addEnemy(cx, row.y-4, sp.enemyHp);
    }
  }

  function addBlock(x,y,w,h){
    const b = Bodies.rectangle(x,y,w,h,{density:0.0015, friction:0.6, restitution:0.05, label:'block'});
    b.blockW=w; b.blockH=h;
    blocks.push(b); World.add(world,b);
  }
  function addEnemy(x,y,hp){
    const e = Bodies.circle(x,y,9,{density:0.002, friction:0.5, restitution:0.15, label:'enemy', frictionAir:0.01});
    e.baseFrictionAir=0.01; e.hp=hp; e.maxHp=hp; e.hitFlash=0;
    enemiesArr.push(e); World.add(world,e);
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
    blocks=[]; enemiesArr=[]; fragments=[]; freezeTimers=[];
    toRemove=[]; particles=[]; explosions=[];
    gameClock=0; killsThisTurn=0; stageScore=0; stageOver=false;
    dragging=false; dragPoint=null; speedMul=1; el('speedBtn').textContent='x1';

    const ground = Bodies.rectangle(W/2, GROUND_Y+15, W+40, 30, {isStatic:true, label:'ground', friction:0.9});
    World.add(world, ground);

    const sp = stageParams(n);
    buildFortress(sp);
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
      pushParticle(body.position.x, body.position.y-14, 'HIT', '#ffb057');
    }
  }

  function killEnemy(body, source){
    toRemove.push(body);
    const idx = enemiesArr.indexOf(body);
    if(idx>=0) enemiesArr.splice(idx,1);
    const points = 100;
    stageScore += points;
    killsThisTurn++;
    bumpMissionTrack('anyKill', 1);
    if(current) bumpMissionTrack('type:'+current.type, 1);
    if(source==='explosion') bumpMissionTrack('explosionKill', 1);
    pushParticle(body.position.x, body.position.y, '+'+points, '#f0c04a');
    updateHUD();
    if(enemiesArr.length===0 && !stageOver){ endStage(true); }
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
      if(d<KILL_RADIUS) damageEnemy(e, e.hp, 'explosion');
    });
    pushParticle(pos.x, pos.y-10, '爆発!', '#ff8a3d');
    explosions.push({x:pos.x, y:pos.y, t:0});
  }

  function freezeAt(pos){
    const RADIUS=68;
    enemiesArr.forEach(e=>{
      const d = Vector.magnitude(Vector.sub(e.position, pos));
      if(d<RADIUS){ e.frictionAir=0.9; freezeTimers.push({body:e, until: gameClock+2200}); }
    });
    pushParticle(pos.x, pos.y-10, '凍結!', '#5fc7e0');
  }

  function pushParticle(x,y,text,color){ particles.push({x,y,text,color,t:0,life:800}); }

  function updateHUD(){
    el('ammoVal').textContent = Math.max(0, ammoQueue.length - queueIndex - (current && current.launched ? 1 : 0));
    el('enemyVal').textContent = enemiesArr.length + '/' + totalEnemiesThisStage;
    el('scoreVal').textContent = stageScore;
    el('stageLabel').textContent = currentStage;
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
      overlayTextEl.textContent = currentStage>=TOTAL_STAGES ? `全${TOTAL_STAGES}ステージを制圧した！お見事！` : '砦を制圧した。次のステージへ進もう。';

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

    if(current && current.launched){
      turnTimer -= dt;
      const offscreen = current.body.position.y>H+100 || current.body.position.x>W+140;
      const stillExists = Composite.get(world, current.body.id, 'body');
      if(turnTimer<=0 || offscreen || !stillExists){
        if(stillExists) World.remove(world, current.body);
        if(killsThisTurn>=2) bumpMissionTrack('combo', 1);
        killsThisTurn = 0;
        queueIndex++;
        current = null;
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
    if(loadedImages.block){
      ctx.drawImage(loadedImages.block, -b.blockW/2,-b.blockH/2,b.blockW,b.blockH);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(-b.blockW/2,-b.blockH/2,b.blockW,b.blockH);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth=1;
    ctx.strokeRect(-b.blockW/2,-b.blockH/2,b.blockW,b.blockH);
    ctx.restore();
  }

  function render(){
    ctx.clearRect(0,0,W,H);
    if(loadedImages.background){
      ctx.drawImage(loadedImages.background, 0, 0, W, H);
    } else {
      ctx.fillStyle = '#0d0906'; ctx.fillRect(0,0,W,H);
    }

    const g = ctx.createLinearGradient(0,GROUND_Y,0,H);
    g.addColorStop(0,'#3a2416'); g.addColorStop(1,'#150d08');
    ctx.fillStyle = g; ctx.fillRect(0,GROUND_Y,W,H-GROUND_Y);
    ctx.strokeStyle = 'rgba(255,122,61,0.25)';
    ctx.beginPath(); ctx.moveTo(0,GROUND_Y); ctx.lineTo(W,GROUND_Y); ctx.stroke();

    ctx.strokeStyle = '#6b4a30'; ctx.lineWidth=5; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(38,GROUND_Y); ctx.lineTo(ANCHOR.x,ANCHOR.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(82,GROUND_Y); ctx.lineTo(ANCHOR.x,ANCHOR.y); ctx.stroke();

    if(dragging && current && dragPoint){
      ctx.strokeStyle='#f0c04a'; ctx.lineWidth=2; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.moveTo(38,GROUND_Y-4); ctx.lineTo(dragPoint.x,dragPoint.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(82,GROUND_Y-4); ctx.lineTo(dragPoint.x,dragPoint.y); ctx.stroke();
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

    blocks.forEach(b=> drawRectBody(b, '#5a4536'));

    enemiesArr.forEach(e=>{
      const frozen = e.frictionAir>0.5;
      if(loadedImages.enemy){
        ctx.save();
        ctx.translate(e.position.x, e.position.y);
        if(frozen){ ctx.filter = 'hue-rotate(160deg) saturate(1.3)'; }
        ctx.drawImage(loadedImages.enemy, -12, -12, 24, 24);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.fillStyle = frozen ? '#7fb8e0' : (e.hp<e.maxHp ? '#e07a5a' : '#c9453a');
        ctx.arc(e.position.x,e.position.y,9,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='#000a'; ctx.lineWidth=1; ctx.stroke();
        ctx.font='11px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillStyle='#fff';
        ctx.fillText(frozen?'🥶':'👹', e.position.x, e.position.y+1);
      }
      if(e.hitFlash>0){
        ctx.beginPath(); ctx.strokeStyle=`rgba(255,255,255,${e.hitFlash})`; ctx.lineWidth=2;
        ctx.arc(e.position.x,e.position.y,13,0,Math.PI*2); ctx.stroke();
      }
      if(e.maxHp>1){
        ctx.font='8px "Courier New",monospace'; ctx.fillStyle='#fff'; ctx.textAlign='center';
        ctx.fillText(e.hp+'/'+e.maxHp, e.position.x, e.position.y+16);
      }
    });

    fragments.forEach(f=>{ ctx.beginPath(); ctx.fillStyle='#7bd66b'; ctx.arc(f.position.x,f.position.y,6,0,Math.PI*2); ctx.fill(); });

    if(current){
      const def = MONSTER_DEFS[current.type];
      const img = loadedImages.monsters[current.type];
      if(img){
        ctx.save();
        ctx.translate(current.body.position.x, current.body.position.y);
        ctx.rotate(current.body.angle);
        ctx.drawImage(img, -def.radius, -def.radius, def.radius*2, def.radius*2);
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
