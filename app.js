/* =========================
   1) 設定（初期）。JSONで上書き可
   ========================= */
let CONFIG = {
  billing: {
    baseFeeLow: 1558.75,
    baseFeeHigh: 1870.5,
    baseFeeThresholdMonthly: 8000,
    standard: {
      tiers: [
        { upto: 120, yenPerKWh: 29.8 },
        { upto: 300, yenPerKWh: 36.4 },
        { upto: null, yenPerKWh: 40.49 }
      ]
    },
    smart: {
      dayYenPerKWh: 39.83,
      nightYPerKWh: 33.99, // 旧キー互換のため保持
      nightYenPerKWh: 33.99,
      dayStart: "07:00",
      dayEnd: "17:30"
    },
    surchargesYenPerKWh: 3.0
  },
  pv: { kwhPerKwPerYear: 1131.5, maxKw: 11.5 },
  battery: { roundTripEff: 0.90, usableRatio: 0.94 },
  fit: {
    postFitYenPerKWh: 8.5,
    ratesUnder10kwByYear: {
      "2012": 42, "2013": 38, "2014": 37, "2015": 35, "2016": 33,
      "2017": 30, "2018": 28, "2019": 26, "2020": 21,
      "2021": 19, "2022": 17, "2023": 16, "2024": 16
    },
    rule2025: { firstYears: 4, firstRate: 24.0, nextYears: 6, nextRate: 8.3 }
  },
  householdAnnualKwh: {
    mixed: { "1": 2349, "2": 3344, "3": 4288, "4": 5200, "5": 6090, "6": 6962, "7": 7819, "8": 8664 },
    allElectric: { "1": 3152, "2": 4669, "3": 6109, "4": 7500, "5": 8857, "6": 10186, "7": 11494, "8": 12783 }
  },
  evaluation: { years: 15, maxCompareCards: 4 }
};

// 価格モデルは別JSONでも可
let PRICING = {
  priceModel: {
    pvFixed: 770322,
    batFixed: 373714.20423056,
    pvTotal: (x) => 3129 * x * x + 85022 * x + 770322,
    batTotal: (y) => -6343.65968615 * y * y + 220780.94393087 * y + 373714.20423056,
    bundleDiscount: (S, Ipv, Ibat) => 200000 + 0.07 * Math.max(S - (Ipv + Ibat), 0)
  }
};

/* ============ ユーティリティ ============ */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const yen = n => '¥' + Math.round(n).toLocaleString();

/* ============ 料金計算 ============ */
function calcStandardBillYen(annualKWh){
  const tiers = CONFIG.billing.standard.tiers;
  let remain = annualKWh, prev = 0, energy = 0;
  for(const t of tiers){
    const cap = t.upto==null?Infinity:t.upto;
    const band = Math.max(Math.min(remain, cap - prev), 0);
    energy += band * t.yenPerKWh;
    remain -= band; prev = cap;
    if(remain<=0) break;
  }
  const sur = CONFIG.billing.surchargesYenPerKWh * annualKWh;
  const monthlyWithoutBase = (energy + sur)/12;
  const base = (monthlyWithoutBase > CONFIG.billing.baseFeeThresholdMonthly)
    ? CONFIG.billing.baseFeeHigh : CONFIG.billing.baseFeeLow;
  return energy + sur + base*12;
}
function calcSmartBillYen(dayKWh, nightKWh){
  const e = dayKWh*CONFIG.billing.smart.dayYenPerKWh +
            nightKWh*(CONFIG.billing.smart.nightYenPerKWh ?? CONFIG.billing.smart.nightYPerKWh);
  const sur = CONFIG.billing.surchargesYenPerKWh*(dayKWh+nightKWh);
  const monthlyWithoutBase = (e+sur)/12;
  const base = (monthlyWithoutBase > CONFIG.billing.baseFeeThresholdMonthly)
    ? CONFIG.billing.baseFeeHigh : CONFIG.billing.baseFeeLow;
  return e + sur + base*12;
}
function invertBillToKWh(planType, annualYen, dayRatio01){
  let lo=0, hi=20000;
  const f = k => planType==='standard'
    ? calcStandardBillYen(k)
    : calcSmartBillYen(k*dayRatio01, k*(1-dayRatio01));
  for(let i=0;i<40;i++){
    const mid=(lo+hi)/2, v=f(mid);
    if(v>annualYen) hi=mid; else lo=mid;
  }
  return Math.round(lo*10)/10;
}

/* ============ FIT系列 ============ */
function fitSeries(startYear, yearsLeft){
  const arr=[]; let y=startYear, left=yearsLeft;
  while(left>0){
    if(y===2025){
      const a=Math.min(CONFIG.fit.rule2025.firstYears,left);
      for(let i=0;i<a;i++) arr.push(CONFIG.fit.rule2025.firstRate);
      left-=a; y+=a; if(left<=0) break;
      const b=Math.min(CONFIG.fit.rule2025.nextYears,left);
      for(let i=0;i<b;i++) arr.push(CONFIG.fit.rule2025.nextRate);
      left-=b; y+=b; continue;
    }
    const r = CONFIG.fit.ratesUnder10kwByYear[String(y)];
    arr.push((r!=null)?r:CONFIG.fit.postFitYenPerKWh);
    left--; y++;
  }
  return arr;
}

/* ============ 年次シミュレーション（SOC繰越あり・対称効率） ============ */
function simulateOneYear({annualLoadKWh, dayRatio, pvKW, batteryKWh, planType, fitStartYear, fitYearsLeft}){
  const dayLoad = annualLoadKWh*dayRatio, nightLoad = annualLoadKWh - dayLoad;
  const pvGen = pvKW*CONFIG.pv.kwhPerKwPerYear;
  const dayLoadD = dayLoad/365, nightLoadD = nightLoad/365, pvD = pvGen/365;

  const usable = batteryKWh*CONFIG.battery.usableRatio;
  const eta = Math.sqrt(CONFIG.battery.roundTripEff); // 充放電それぞれにη

  let soc=0, sold=0, self=0;
  for(let d=0; d<365; d++){
    // 昼
    let pv = pvD;
    const daySelf = Math.min(pv, dayLoadD); pv -= daySelf; self += daySelf;
    // 余剰充電
    if(usable>0 && pv>0){
      const room = usable - soc;
      const canIn = room/eta; // 入力量
      const inE = Math.min(pv, Math.max(canIn,0));
      soc += inE*eta; pv -= inE;
    }
    // さらに余れば売電
    sold += Math.max(pv,0);
    // 夜 放電
    let need = nightLoadD;
    if(usable>0 && soc>0 && need>0){
      const outMax = soc*eta;
      const use = Math.min(outMax, need);
      soc -= use/eta; need -= use; self += use;
    }
    // soc は繰越
  }

  // 請求
  const resid = Math.max(annualLoadKWh - self, 0);
  const residDay = resid*dayRatio, residNight = resid - residDay;
  const billAfter = (planType==='standard') ? calcStandardBillYen(resid) : calcSmartBillYen(residDay, residNight);
  const billBefore = (planType==='standard') ? calcStandardBillYen(annualLoadKWh) : calcSmartBillYen(dayLoad, nightLoad);

  return { pvGen, selfUse:self, sold, annualSavingYen: billBefore - billAfter,
           fitSeries: fitSeries(fitStartYear, fitYearsLeft) };
}

/* ============ 価格モデル ============ */
function pricePVOnly(x){ return PRICING.priceModel.pvTotal(x); }
function priceBatOnly(y){ return PRICING.priceModel.batTotal(y); }
function priceBundle(x,y){
  const S = pricePVOnly(x) + priceBatOnly(y);
  const D = PRICING.priceModel.bundleDiscount(S, PRICING.priceModel.pvFixed, PRICING.priceModel.batFixed);
  return S - D;
}

/* ============ 15年評価 & 回収年数（累積超過年） ============ */
function evaluate15(sim, evalYears, price){
  // 年yの売電収入 = sim.sold * (fitSeries[y] or postFit)
  let totalSell=0, cum=0, payback=null;
  for(let y=0; y<evalYears; y++){
    const rate = (y < sim.fitSeries.length) ? sim.fitSeries[y] : CONFIG.fit.postFitYenPerKWh;
    const oneYearBenefit = sim.annualSavingYen + sim.sold * rate;
    totalSell += sim.sold * rate;
    cum += oneYearBenefit;
    if(payback==null && cum >= price) payback = (y+1);
  }
  const totalBenefit = sim.annualSavingYen*evalYears + totalSell;
  const payoff = totalBenefit - price;
  return { totalSell, totalBenefit, payoff, payback };
}

/* ============ 最適化（カード個別） ============ */
function optimizeForCard(ctx, mode){
  // ctx: planType, annualKWh, dayRatio, fitStartYear, fitYearsLeft, evalYears, hasPV, existingPvKW
  const PV_MAX = CONFIG.pv.maxKw;
  const PV_STEP = 0.5, BAT_STEP = 0.5;
  const PV_MIN = 0, BAT_MIN = 0, BAT_MAX = 20;

  const tryCase = (pv, bat) => {
    // PV単独禁止条件：hasPV=false かつ pv=0 & bat>0 は提案しない
    if(!ctx.hasPV && pv<=0 && bat>0) return null;
    // 既設がある場合、Aは“現状”で別途扱う。B最適化では pv は既設前提で0固定にするか？→要件：既設前提の蓄電池最適（pvは既設量）
    const sim = simulateOneYear({
      annualLoadKWh: ctx.annualKWh,
      dayRatio: ctx.dayRatio,
      pvKW: pv,
      batteryKWh: bat,
      planType: ctx.planType,
      fitStartYear: ctx.fitStartYear,
      fitYearsLeft: ctx.fitYearsLeft
    });

    let price = 0;
    if(pv>0 && bat>0) price = priceBundle(pv, bat);
    else if(pv>0) price = pricePVOnly(pv);
    else price = priceBatOnly(bat);

    const ev = evaluate15(sim, ctx.evalYears, price);
    return { pv, bat, price, sim, ...ev };
  };

  let best=null;

  if(mode==='PV_ONLY'){
    for(let pv=PV_MIN; pv<=PV_MAX; pv+=PV_STEP){
      const r = tryCase(+pv.toFixed(2), 0);
      if(!r) continue;
      if(!best || r.payoff>best.payoff) best=r;
    }
  }else if(mode==='PV_BAT'){
    for(let pv=PV_MIN; pv<=PV_MAX; pv+=PV_STEP){
      for(let b=BAT_MIN; b<=BAT_MAX; b+=BAT_STEP){
        if(pv<=0 && b>0) continue;
        const r = tryCase(+pv.toFixed(2), +b.toFixed(2));
        if(!r) continue;
        if(!best || r.payoff>best.payoff) best=r;
      }
    }
  }else if(mode==='BAT_ONLY_EXISTING'){
    // 既設PV前提：pvは既設値で固定
    const pv = clamp(ctx.existingPvKW||0, 0, PV_MAX);
    for(let b=BAT_MIN; b<=BAT_MAX; b+=BAT_STEP){
      const r = tryCase(pv, +b.toFixed(2));
      if(!r) continue;
      if(!best || r.payoff>best.payoff) best=r;
    }
  }

  return best;
}

/* ============ カードUI ============ */
const cardsWrap = document.getElementById('cards');
const compareWrap = document.getElementById('compareTableWrap');
const compareTable = document.getElementById('compareTable');
let cards = []; // {id, ctx, result, node}

function newCardFromGlobalDefaults(){
  const plan = document.querySelector('input[name="g_planType"]:checked').value;
  const hasPV = document.querySelector('input[name="g_hasPV"]:checked').value === 'true';
  const dayRatio = +document.getElementById('g_dayRatio').value/100;
  const evalYears = +document.getElementById('g_evalYears').value;
  const fitStartYear = +document.getElementById('g_fitStartYear').value;
  const fitYearsLeft = +document.getElementById('g_fitYearsLeft').value;
  const mode = document.getElementById('g_scaleMode').value;
  let annualKWh=5200;
  if(mode==='kwh') annualKWh = +document.getElementById('g_annualKWh').value;
  if(mode==='yen') annualKWh = invertBillToKWh(plan, +document.getElementById('g_annualBill').value, dayRatio);
  if(mode==='household'){
    const n = clamp(+document.getElementById('g_household').value,1,8);
    const table = (plan==='standard')?CONFIG.householdAnnualKwh.mixed:CONFIG.householdAnnualKwh.allElectric;
    annualKWh = table[String(n)] ?? 5200;
  }
  const existingPvKW = hasPV ? +document.getElementById('g_existingPvKW').value : 0;
  return {
    planType: plan,
    hasPV,
    existingPvKW,
    annualKWh,
    dayRatio,
    fitStartYear,
    fitYearsLeft,
    evalYears
  };
}

function renderCard(c){
  if(c.node) c.node.remove();

  const id = c.id;
  const ctx = c.ctx;

  const div = document.createElement('div');
  div.className = 'card wide';
  div.innerHTML = `
    <div class="card-head">
      <h3>カード #${id}</h3>
      <div class="spacer"></div>
      <button class="ghost del">削除</button>
      <button class="ghost recalc">再計算</button>
    </div>

    <details class="card-settings" open>
      <summary>このカードの設定</summary>
      <div class="grid3">
        <div>
          <label class="lbl">プラン</label>
          <select data-k="planType">
            <option value="standard" ${ctx.planType==='standard'?'selected':''}>従量電灯</option>
            <option value="smart" ${ctx.planType==='smart'?'selected':''}>スマートライフ</option>
          </select>
        </div>
        <div>
          <label class="lbl">太陽光の有無</label>
          <select data-k="hasPV">
            <option value="true" ${ctx.hasPV?'selected':''}>あり</option>
            <option value="false" ${!ctx.hasPV?'selected':''}>なし</option>
          </select>
        </div>
        <div>
          <label class="lbl">既設PV（kW）</label>
          <input type="number" min="0" max="${CONFIG.pv.maxKw}" step="0.1" data-k="existingPvKW" value="${ctx.existingPvKW||0}">
        </div>

        <div>
          <label class="lbl">年間使用量（kWh）</label>
          <input type="number" min="0" step="0.1" data-k="annualKWh" value="${ctx.annualKWh}">
          <div class="hint">※ここに直接入れる（電気代/世帯からの換算は左で新規作成時のみ）</div>
        </div>
        <div>
          <label class="lbl">日中使用割合（%）</label>
          <input type="number" min="0" max="100" step="1" data-k="dayRatioPct" value="${Math.round(ctx.dayRatio*100)}">
        </div>
        <div>
          <label class="lbl">評価年数（年）</label>
          <input type="number" min="1" max="30" step="1" data-k="evalYears" value="${ctx.evalYears}">
        </div>

        <div>
          <label class="lbl">FIT開始年</label>
          <input type="number" min="2012" max="2030" step="1" data-k="fitStartYear" value="${ctx.fitStartYear}">
        </div>
        <div>
          <label class="lbl">FIT残存年数</label>
          <input type="number" min="0" max="10" step="1" data-k="fitYearsLeft" value="${ctx.fitYearsLeft}">
        </div>
        <div>
          <label class="lbl">提案タイプ</label>
          <select data-k="mode">
            ${ctx.hasPV ? `
              <option value="existing">A=現状 / B=既設前提で蓄電池最適</option>
            ` : `
              <option value="new">A=PVのみ最適 / B=PV+蓄電池最適</option>
            `}
          </select>
        </div>
      </div>
    </details>

    <div class="grid">
      <div class="subcard" id="A_${id}"></div>
      <div class="subcard" id="B_${id}"></div>
    </div>
  `;
  c.node = div;

  // ハンドラ
  div.querySelector('.del').onclick = () => {
    if(cards.length<=1) return; // 最低1枚残す
    cards = cards.filter(x=>x!==c);
    mount();
  };
  div.querySelector('.recalc').onclick = () => computeCard(c);

  for(const el of div.querySelectorAll('[data-k]')){
    el.oninput = () => {
      const k = el.getAttribute('data-k');
      if(k==='dayRatioPct') ctx.dayRatio = clamp(+el.value/100,0,1);
      else if(k==='hasPV') ctx.hasPV = (el.value==='true');
      else ctx[k] = (k==='planType') ? el.value : +el.value;
    };
    el.onchange = () => computeCard(c);
  }

  cardsWrap.appendChild(div);
  computeCard(c);
}

function computeCard(c){
  const ctx = c.ctx;
  const base = {
    planType: ctx.planType,
    annualKWh: ctx.annualKWh,
    dayRatio: ctx.dayRatio,
    fitStartYear: ctx.fitStartYear,
    fitYearsLeft: ctx.fitYearsLeft,
    evalYears: ctx.evalYears,
    hasPV: ctx.hasPV,
    existingPvKW: ctx.existingPvKW||0
  };

  let A,B;
  if(!ctx.hasPV){
    A = optimizeForCard(base, 'PV_ONLY');
    B = optimizeForCard(base, 'PV_BAT');
  }else{
    // A：現状（既設のみ）
    const simA = simulateOneYear({
      annualLoadKWh: base.annualKWh,
      dayRatio: base.dayRatio,
      pvKW: clamp(base.existingPvKW, 0, CONFIG.pv.maxKw),
      batteryKWh: 0,
      planType: base.planType,
      fitStartYear: base.fitStartYear,
      fitYearsLeft: base.fitYearsLeft
    });
    const priceA = 0;
    const evA = evaluate15(simA, base.evalYears, priceA);
    A = { pv: base.existingPvKW, bat: 0, price: 0, sim: simA, ...evA };

    // B：既設前提で蓄電池最適（価格は蓄電池のみ）
    B = optimizeForCard(base, 'BAT_ONLY_EXISTING');
  }

  c.result = {A,B};
  fillSubCard(`A_${c.id}`, ctx, '提案A', A);
  fillSubCard(`B_${c.id}`, ctx, '提案B', B);
  renderCompare();
}

function fillSubCard(domId, ctx, title, r){
  const el = document.getElementById(domId);
  if(!r){ el.innerHTML = `<div class="mono small">条件に合致する提案がありません。</div>`; return; }
  const rate0 = (r.sim.fitSeries[0] ?? CONFIG.fit.postFitYenPerKWh);
  const annualSellYen = r.sim.sold * rate0;
  el.innerHTML = `
    <div class="card-head"><h4>${title}</h4></div>
    <div class="mono small">PV=${r.pv.toFixed(1)}kW / Battery=${r.bat.toFixed(1)}kWh</div>
    <div class="grid2">
      <div><label>初期費用</label><div class="big">${yen(r.price)}</div></div>
      <div><label>年間削減額</label><div class="big">${yen(r.sim.annualSavingYen)}</div></div>
      <div><label>年間売電（初年単価）</label><div class="big">${yen(annualSellYen)}</div></div>
      <div><label>15年メリット</label><div class="big">${yen(r.totalBenefit)}</div></div>
      <div><label>15年利益</label><div class="big strong">${yen(r.payoff)}</div></div>
      <div><label>回収年</label><div class="big">${r.payback ?? '—'} 年</div></div>
    </div>
  `;
}

function renderCompare(){
  compareWrap.hidden = (cards.length<2);
  if(compareWrap.hidden){ document.body.classList.remove('compact-left'); return; }
  document.body.classList.add('compact-left');

  const rows = [
    ['カード', ...cards.map(c=>'#'+c.id)],
    ['プラン', ...cards.map(c=>c.ctx.planType==='standard'?'従量':'スマート')],
    ['既設PV(kW)', ...cards.map(c=>(c.ctx.existingPvKW||0).toFixed(1))],
    ['年間使用量(kWh)', ...cards.map(c=>c.ctx.annualKWh.toFixed(1))],
    ['日中割合(%)', ...cards.map(c=>Math.round(c.ctx.dayRatio*100))],
    ['A: PV(kW)', ...cards.map(c=>c.result?.A?c.result.A.pv.toFixed(1):'—')],
    ['A: Bat(kWh)', ...cards.map(c=>c.result?.A?c.result.A.bat.toFixed(1):'—')],
    ['A: 利益(15y)', ...cards.map(c=>c.result?.A?yen(c.result.A.payoff):'—')],
    ['B: PV(kW)', ...cards.map(c=>c.result?.B?c.result.B.pv.toFixed(1):'—')],
    ['B: Bat(kWh)', ...cards.map(c=>c.result?.B?c.result.B.bat.toFixed(1):'—')],
    ['B: 利益(15y)', ...cards.map(c=>c.result?.B?yen(c.result.B.payoff):'—')],
  ];
  const table = document.createElement('table');
  rows.forEach(r=>{
    const tr=document.createElement('tr');
    r.forEach((cell,i)=>{
      const el=document.createElement(i===0?'th':'td');
      el.textContent = cell; tr.appendChild(el);
    });
    table.appendChild(tr);
  });
  compareTable.innerHTML=''; compareTable.appendChild(table);
}

/* ============ マウント & 左の初期値UI ============ */
function mount(){
  cardsWrap.innerHTML='';
  cards.forEach(renderCard);
  renderCompare();
}

(function initLeft(){
  const g_hasPV = () => document.querySelector('input[name="g_hasPV"]:checked').value==='true';
  const wrap = document.getElementById('g_existingWrap');
  for(const r of document.querySelectorAll('input[name="g_hasPV"]')){
    r.onchange = ()=> wrap.hidden = !g_hasPV();
  }

  const g_scaleMode = document.getElementById('g_scaleMode');
  const g_scaleInputs = document.getElementById('g_scaleInputs');
  g_scaleMode.onchange = ()=>{
    for(const d of g_scaleInputs.querySelectorAll('[data-mode]')){
      d.hidden = (d.getAttribute('data-mode')!==g_scaleMode.value);
    }
  };

  document.getElementById('addCard').onclick = ()=>{
    if(cards.length>=CONFIG.evaluation.maxCompareCards) return;
    const ctx = newCardFromGlobalDefaults();
    const id = (cards.length? Math.max(...cards.map(c=>c.id))+1 : 1);
    cards.push({id, ctx});
    mount();
  };
})();

/* ============ 設定の入出力 ============ */
document.getElementById('configFile').onchange = async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  try{
    const j=JSON.parse(await f.text());
    CONFIG = {...CONFIG, ...j};
    alert('設定JSONを読み込みました。');
  }catch(_){ alert('設定JSONの解析に失敗しました。'); }
};

document.getElementById('pricingFile').onchange = async e=>{
  const f=e.target.files?.[0]; if(!f) return;
  try{
    const j=JSON.parse(await f.text());
    PRICING = {...PRICING, ...j};
    alert('価格モデルJSONを読み込みました。');
  }catch(_){ alert('価格モデルJSONの解析に失敗しました。'); }
};

document.getElementById('exportAllBtn').onclick = ()=>{
  const payload = { CONFIG, PRICING };
  const blob = new Blob([JSON.stringify(payload, null, 2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='sim_export_all.json'; a.click();
  URL.revokeObjectURL(url);
};
document.getElementById('resetBtn').onclick = ()=> location.reload();

// 初期1枚
cards.push({ id:1, ctx: newCardFromGlobalDefaults() });
mount();
