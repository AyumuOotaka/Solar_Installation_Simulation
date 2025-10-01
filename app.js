/* =========================
   設定（デフォルト）。読み込みJSONで上書き可能
   ========================= */
let CONFIG = {
  billing: {
    baseFeeLow: 1558.75,
    baseFeeHigh: 1870.5,
    baseFeeThresholdMonthly: 8000, // 「基本料金抜き」が月8,000円を超えるか判定
    standard: {
      tiers: [
        { upto: 120, yenPerKWh: 29.8 },
        { upto: 300, yenPerKWh: 36.4 },
        { upto: null, yenPerKWh: 40.49 }
      ]
    },
    smart: {
      dayYenPerKWh: 39.83,
      nightYenPerKWh: 33.99,
      dayStart: "07:00",
      dayEnd: "17:30"
    },
    surchargesYenPerKWh: 3.0
  },
  pv: {
    kwhPerKwPerYear: 1131.5
  },
  battery: {
    roundTripEff: 0.90,
    usableRatio: 0.94
  },
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
    mixed:  { "1": 2349, "2": 3344, "3": 4288, "4": 5200, "5": 6090, "6": 6962, "7": 7819, "8": 8664 },
    allElectric: { "1": 3152, "2": 4669, "3": 6109, "4": 7500, "5": 8857, "6": 10186, "7": 11494, "8": 12783 }
  },
  evaluation: {
    years: 15,
    maxCompareCards: 4
  },
  // 価格近似モデル
  priceModel: {
    // P_pv(x) = 3129 x^2 + 85022 x + 770322
    pvTotal: (x) => 3129 * x * x + 85022 * x + 770322,
    pvFixed: 770322,
    // P_bat(y) = -6343.65968615 y^2 + 220780.94393087 y + 373714.20423056
    batTotal: (y) => -6343.65968615 * y * y + 220780.94393087 * y + 373714.20423056,
    batFixed: 373714.20423056,
    // 同時施工割引：固定20万円 + 変動7%
    bundleDiscount: (S, Ipv, Ibat) => {
      const variable = Math.max(S - (Ipv + Ibat), 0);
      return 200000 + 0.07 * variable;
    }
  }
};

/* ============ ユーティリティ ============ */
const fmtYen = n => Math.round(n).toLocaleString();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ============ 料金計算 ============ */
// 従量電灯：kWh->円（基礎・再エネ燃調込み）
function calcStandardBillYen(annualKWh) {
  const tiers = CONFIG.billing.standard.tiers;
  let rest = annualKWh;
  let energyYen = 0;
  for (const t of tiers) {
    if (t.upto === null) {
      energyYen += rest * t.yenPerKWh;
      break;
    } else {
      const take = Math.max(Math.min(rest, t.upto - (annualKWh - rest)), 0);
      const span = Math.min(rest, t.upto - (annualKWh - rest));
      const s = Math.max(Math.min(span, t.upto), 0);
      const used = Math.min(rest, t.upto - (annualKWh - rest) + 0);
      const chunk = Math.min(rest, t.upto - (annualKWh - rest));
      const delta = Math.min(rest, (t.upto - (annualKWh - rest)));
      const consume = Math.min(rest, (t.upto - (annualKWh - rest)));
      const kwh = Math.max(Math.min(rest, t.upto - (annualKWh - rest)), 0);
      const use = Math.min(rest, t.upto - (annualKWh - rest));
      const part = Math.min(rest, t.upto - (annualKWh - rest));
      const x = Math.min(rest, t.upto - (annualKWh - rest));
      const kk = Math.min(rest, t.upto - (annualKWh - rest));
      // 上のローカルは安全用に置いているが実際に使うのは以下の計算
    }
  }
  // 実装を明快に書き直す
  let remain = annualKWh;
  let prevUpto = 0;
  energyYen = 0;
  for (const t of tiers) {
    const cap = (t.upto === null) ? Infinity : t.upto;
    const thisBand = Math.max(Math.min(remain, cap - prevUpto), 0);
    energyYen += thisBand * t.yenPerKWh;
    remain -= thisBand;
    prevUpto = cap;
    if (remain <= 0) break;
  }
  const sur = CONFIG.billing.surchargesYenPerKWh * annualKWh;
  // 基本料金判定：月あたりの「基本料金抜き」金額
  const monthlyWithoutBase = (energyYen + sur) / 12;
  const base = (monthlyWithoutBase > CONFIG.billing.baseFeeThresholdMonthly)
    ? CONFIG.billing.baseFeeHigh
    : CONFIG.billing.baseFeeLow;
  const baseYear = base * 12;
  return energyYen + sur + baseYear;
}

// スマート：昼夜kWhを渡す（年次合計）
function calcSmartBillYen(dayKWh, nightKWh) {
  const unitDay = CONFIG.billing.smart.dayYenPerKWh;
  const unitNight = CONFIG.billing.smart.nightYenPerKWh;
  const energyYen = dayKWh * unitDay + nightKWh * unitNight;
  const sur = CONFIG.billing.surchargesYenPerKWh * (dayKWh + nightKWh);
  const monthlyWithoutBase = (energyYen + sur) / 12;
  const base = (monthlyWithoutBase > CONFIG.billing.baseFeeThresholdMonthly)
    ? CONFIG.billing.baseFeeHigh
    : CONFIG.billing.baseFeeLow;
  return energyYen + sur + base * 12;
}

// 年間円→kWh（従量 or スマート）を二分探索（0.1kWh）
function invertBillToKWh(planType, annualYen, dayRatio01) {
  let lo = 0, hi = 20000; // 一般家庭域
  const f = (kwh) => {
    if (planType === 'standard') return calcStandardBillYen(kwh);
    const day = kwh * dayRatio01;
    const night = kwh - day;
    return calcSmartBillYen(day, night);
  };
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const val = f(mid);
    if (val > annualYen) hi = mid; else lo = mid;
  }
  return Math.round(lo * 10) / 10; // 0.1kWh粒度
}

/* ============ FIT 単価系列 ============ */
function buildFitSeries(startYear, yearsLeft) {
  const arr = [];
  let y = startYear;
  let left = yearsLeft;
  while (left > 0) {
    if (y === 2025) {
      const a = Math.min(CONFIG.fit.rule2025.firstYears, left);
      for (let i = 0; i < a; i++) arr.push(CONFIG.fit.rule2025.firstRate);
      left -= a; y += (a > 0 ? a : 1);
      if (left <= 0) break;
      const b = Math.min(CONFIG.fit.rule2025.nextYears, left);
      for (let i = 0; i < b; i++) arr.push(CONFIG.fit.rule2025.nextRate);
      left -= b; y += (b > 0 ? b : 1);
      continue;
    }
    const rateTbl = CONFIG.fit.ratesUnder10kwByYear;
    const r = rateTbl[String(y)];
    if (r != null) {
      arr.push(r);
      left -= 1;
      y += 1;
    } else {
      // 不明年は直近値で延長（安全側）
      arr.push(CONFIG.fit.postFitYenPerKWh);
      left -= 1; y += 1;
    }
  }
  return arr;
}

/* ============ PV・蓄電池 ディスパッチ（日次） ============ */
function simulateYear(params) {
  // params: { annualLoadKWh, dayRatio, pvKW, batteryKWh, hasPV,
  //           fitStartYear, fitYearsLeft, planType, evalYears }
  const dayRatio = clamp(params.dayRatio, 0, 1);
  const dayLoadYear = params.annualLoadKWh * dayRatio;
  const nightLoadYear = params.annualLoadKWh - dayLoadYear;

  const pvGenYear = params.pvKW * CONFIG.pv.kwhPerKwPerYear;
  const pvGenDay = pvGenYear / 365;
  const dayLoadPerDay = dayLoadYear / 365;
  const nightLoadPerDay = nightLoadYear / 365;

  const usableCap = params.batteryKWh * CONFIG.battery.usableRatio; // kWh
  const eff = CONFIG.battery.roundTripEff; // 対称で扱う：充電も放電も√effを適用する方法
  const eta = Math.sqrt(eff); // 充放電それぞれに適用

  let soc = 0; // kWh, 0..usableCap
  let soldYear = 0, selfUseYear = 0, chargeLossYear = 0;

  // 15年のうち、年0の売電単価は fitSeries[0]、残りはpostFit
  const fitSeries = buildFitSeries(params.fitStartYear, params.fitYearsLeft);
  const yearsEvaluated = params.evalYears;

  // 年間フロー（365日）を1年分で返す
  for (let d = 0; d < 365; d++) {
    // 昼：PVで昼負荷を賄う
    let pv = pvGenDay;
    const daySelf = Math.min(pv, dayLoadPerDay);
    pv -= daySelf;
    selfUseYear += daySelf;

    // 余剰があれば充電（充電効率：入れた x → バッファ増分 x*eta）
    if (usableCap > 0 && pv > 0) {
      const room = usableCap - soc;
      const canStoreInput = room / eta; // 入力換算
      const storeIn = Math.min(pv, Math.max(canStoreInput, 0));
      soc += storeIn * eta;
      pv -= storeIn;
      chargeLossYear += storeIn * (1 - eta); // 充電ロス
    }

    // なお、まだ余剰が残れば売電
    const soldNow = Math.max(pv, 0);
    soldYear += soldNow;

    // 夜：放電して夜間負荷を削減（放電効率：取り出し y → SoC減少 y/eta）
    let nightNeed = nightLoadPerDay;
    if (usableCap > 0 && soc > 0 && nightNeed > 0) {
      const canOut = soc * eta; // 取り出せるエネルギー
      const use = Math.min(canOut, nightNeed);
      const socDrop = use / eta;
      soc -= socDrop;
      nightNeed -= use;
      selfUseYear += use;
    }
    // 使い切れないSOCは翌日に繰越（→翌日の売電開始が早まることになる）
  }

  // 年間の電力会社請求（導入後）
  const afterDay = dayLoadYear - (selfUseYear * (dayLoadYear / (dayLoadYear + nightLoadYear))); // ざっくり配分
  // 上記配分は厳密ではないため、導入後請求は「総自己消費を負荷全体から差引」→ プラン別単価へ
  const residualLoad = Math.max(params.annualLoadKWh - selfUseYear, 0);
  const residualDay = residualLoad * (dayRatio); // 初版は比率維持
  const residualNight = residualLoad - residualDay;

  const billAfter = (params.planType === 'standard')
    ? calcStandardBillYen(residualLoad)
    : calcSmartBillYen(residualDay, residualNight);

  // 導入前請求
  const billBefore = (params.planType === 'standard')
    ? calcStandardBillYen(params.annualLoadKWh)
    : calcSmartBillYen(params.annualLoadKWh * dayRatio, params.annualLoadKWh * (1 - dayRatio));

  // 売電収入（評価年数の最初の年のみの単価で出さず、年ごとに計上）
  // 初版：ここでは「1年平均の売電量＝soldYear」を、評価年数内の各年に配布
  function totalSellRevenue(evalYears) {
    let sum = 0;
    for (let y = 0; y < evalYears; y++) {
      const rate = (y < fitSeries.length) ? fitSeries[y] : CONFIG.fit.postFitYenPerKWh;
      sum += soldYear * rate;
    }
    return sum;
  }

  return {
    pvGenYear, selfUseYear, soldYear,
    billBefore, billAfter,
    annualSavingYen: billBefore - billAfter,
    totalSellRevenue15: totalSellRevenue(params.evalYears)
  };
}

/* ============ 価格モデル ============ */
function pricePVOnly(pvKW) {
  return CONFIG.priceModel.pvTotal(pvKW);
}
function priceBatteryOnly(batKWh) {
  return CONFIG.priceModel.batTotal(batKWh);
}
function priceBundle(pvKW, batKWh) {
  const Ppv = CONFIG.priceModel.pvTotal(pvKW);
  const Pbat = CONFIG.priceModel.batTotal(batKWh);
  const S = Ppv + Pbat;
  const D = CONFIG.priceModel.bundleDiscount(S, CONFIG.priceModel.pvFixed, CONFIG.priceModel.batFixed);
  return S - D;
}

/* ============ 提案の最適化 ============ */
function optimize(params, mode) {
  // mode: "PV_ONLY" | "PV_BAT" | "BAT_ONLY_FOR_EXISTING"
  const results = [];
  const evalYears = params.evalYears;

  const test = (pv, bat) => {
    // 蓄電池単体は非推奨（hasPV=false で bat>0 && pv=0 は弾く）
    if (!params.hasPV && pv <= 0 && bat > 0) return;

    const sim = simulateYear({
      annualLoadKWh: params.annualLoadKWh,
      dayRatio: params.dayRatio,
      pvKW: pv,
      batteryKWh: bat,
      hasPV: params.hasPV,
      fitStartYear: params.fitStartYear,
      fitYearsLeft: params.fitYearsLeft,
      planType: params.planType,
      evalYears
    });

    let price = 0;
    if (pv > 0 && bat > 0) price = priceBundle(pv, bat);
    else if (pv > 0) price = pricePVOnly(pv);
    else price = priceBatteryOnly(bat); // 既設PVに蓄電池追加ケース想定

    const annualMerit = sim.annualSavingYen + sim.soldYear * ((buildFitSeries(params.fitStartYear, params.fitYearsLeft)[0] ?? CONFIG.fit.postFitYenPerKWh));
    const totalBenefit = sim.annualSavingYen * evalYears + sim.totalSellRevenue15;
    const payoff = totalBenefit - price;
    const paybackYears = (sim.annualSavingYen > 0) ? (price / sim.annualSavingYen) : Infinity;

    results.push({
      pvKW: pv, batKWh: bat,
      price,
      sim,
      totalBenefit, payoff, paybackYears
    });
  };

  // 探索レンジ（初版）
  const PV_RANGE = { min: 0, max: 15, step: 0.5 };
  const BAT_RANGE = { min: 0, max: 20, step: 0.5 };

  if (mode === 'PV_ONLY') {
    for (let pv = PV_RANGE.min; pv <= PV_RANGE.max; pv += PV_RANGE.step) {
      test(+pv.toFixed(2), 0);
    }
  } else if (mode === 'PV_BAT') {
    for (let pv = PV_RANGE.min; pv <= PV_RANGE.max; pv += PV_RANGE.step) {
      for (let b = BAT_RANGE.min; b <= BAT_RANGE.max; b += BAT_RANGE.step) {
        if (pv <= 0 && b > 0) continue; // PV無しの蓄電池単体は提案しない
        test(+pv.toFixed(2), +b.toFixed(2));
      }
    }
  } else if (mode === 'BAT_ONLY_FOR_EXISTING') {
    const pv = params.existingPvKW ?? 0;
    for (let b = BAT_RANGE.min; b <= BAT_RANGE.max; b += BAT_RANGE.step) {
      test(pv, +b.toFixed(2));
    }
  }

  // payoff（15年利益）最大を採用
  results.sort((a, b) => b.payoff - a.payoff);
  return results[0];
}

/* ============ UI バインド ============ */
const els = {
  planType: () => document.querySelector('input[name="planType"]:checked').value,
  hasPV: () => document.querySelector('input[name="hasPV"]:checked').value === 'true',
  scaleMode: document.getElementById('scaleMode'),
  annualKWh: document.getElementById('annualKWh'),
  annualBill: document.getElementById('annualBill'),
  household: document.getElementById('household'),
  dayRatio: document.getElementById('dayRatio'),
  evalYears: document.getElementById('evalYears'),
  fitBlock: document.getElementById('fitBlock'),
  fitStartYear: document.getElementById('fitStartYear'),
  fitYearsLeft: document.getElementById('fitYearsLeft'),
  cards: document.getElementById('cards'),
  compareWrap: document.getElementById('compareTableWrap'),
  compareTable: document.getElementById('compareTable'),
  leftPanel: document.getElementById('leftPanel'),
};

function currentAnnualKWh() {
  const plan = els.planType();
  const mode = els.scaleMode.value;
  const D = +els.dayRatio.value / 100;
  if (mode === 'kwh') return +els.annualKWh.value;
  if (mode === 'yen') return invertBillToKWh(plan, +els.annualBill.value, D);
  // household
  const n = clamp(+els.household.value, 1, 8);
  const table = (plan === 'standard') ? CONFIG.householdAnnualKwh.mixed : CONFIG.householdAnnualKwh.allElectric;
  return table[String(n)] ?? 5200;
}

function gatherGlobal() {
  const hasPV = els.hasPV();
  els.fitBlock.hidden = !hasPV;

  const plan = els.planType();
  const annualKWh = currentAnnualKWh();
  const D = +els.dayRatio.value / 100;
  const evalYears = +els.evalYears.value;

  return {
    planType: plan,
    hasPV,
    annualKWh,
    dayRatio: D,
    fitStartYear: +els.fitStartYear.value,
    fitYearsLeft: +els.fitYearsLeft.value,
    evalYears
  };
}

/* ============ カード描画 & 比較 ============ */
let compareCards = []; // {id, title, detail, numbers}

function buildCardView(title, detail, numbers, allowRemove=true) {
  const div = document.createElement('div');
  div.className = 'card';
  div.innerHTML = `
    <div class="card-head">
      <h3>${title}</h3>
      <div class="spacer"></div>
      ${allowRemove ? '<button class="ghost remove">削除</button>' : ''}
    </div>
    <div class="mono small">${detail}</div>
    <div class="grid">
      <div><label>PV容量 (kW)</label><div class="big">${numbers.pvKW.toFixed(1)}</div></div>
      <div><label>蓄電池 (kWh)</label><div class="big">${numbers.batKWh.toFixed(1)}</div></div>
      <div><label>初期費用（概算）</label><div class="big">¥${fmtYen(numbers.price)}</div></div>
      <div><label>年間削減額</label><div class="big">¥${fmtYen(numbers.annualSaving)}</div></div>
      <div><label>年間売電収入</label><div class="big">¥${fmtYen(numbers.annualSell)}</div></div>
      <div><label>15年メリット合計</label><div class="big">¥${fmtYen(numbers.totalBenefit)}</div></div>
      <div><label>15年利益（−初期費）</label><div class="big strong">¥${fmtYen(numbers.payoff)}</div></div>
      <div><label>単純回収年</label><div class="big">${isFinite(numbers.payback)?numbers.payback.toFixed(1):'—'} 年</div></div>
    </div>
  `;
  if (allowRemove) {
    div.querySelector('.remove').onclick = () => {
      if (compareCards.length <= 1) return;
      compareCards = compareCards.filter(c => c._node !== div);
      renderCompareTable();
      renderCards();
    };
  }
  return div;
}

function renderCompareTable() {
  els.compareWrap.hidden = (compareCards.length < 2);
  if (els.compareWrap.hidden) return;
  const rows = [
    ['名称', ...compareCards.map(c => c.title)],
    ['PV (kW)', ...compareCards.map(c => c.numbers.pvKW.toFixed(1))],
    ['蓄電池 (kWh)', ...compareCards.map(c => c.numbers.batKWh.toFixed(1))],
    ['初期費用', ...compareCards.map(c => '¥'+fmtYen(c.numbers.price))],
    ['年間削減額', ...compareCards.map(c => '¥'+fmtYen(c.numbers.annualSaving))],
    ['年間売電', ...compareCards.map(c => '¥'+fmtYen(c.numbers.annualSell))],
    ['15年メリット', ...compareCards.map(c => '¥'+fmtYen(c.numbers.totalBenefit))],
    ['15年利益', ...compareCards.map(c => '¥'+fmtYen(c.numbers.payoff))],
    ['回収年', ...compareCards.map(c => isFinite(c.numbers.payback)?c.numbers.payback.toFixed(1)+'年':'—')]
  ];
  const table = document.createElement('table');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    r.forEach((cell,i) => {
      const el = document.createElement(i===0?'th':'td');
      el.textContent = cell;
      tr.appendChild(el);
    });
    table.appendChild(tr);
  });
  els.compareTable.innerHTML = '';
  els.compareTable.appendChild(table);

  // 左パネルをコンパクト化
  document.body.classList.toggle('compact-left', compareCards.length >= 2);
}

function pushCard(item) {
  const node = buildCardView(item.title, item.detail, item.numbers, true);
  item._node = node;
  compareCards.push(item);
}

function renderCards() {
  els.cards.innerHTML = '';
  compareCards.forEach(c => els.cards.appendChild(c._node));
}

/* ============ おすすめ生成 ============ */
function recompute() {
  // 最低1枚は常に保持
  if (compareCards.length === 0) compareCards.push({title:'—', detail:'—', numbers:{pvKW:0,batKWh:0,price:0,annualSaving:0,annualSell:0,totalBenefit:0,payoff:0,payback:Infinity}, _node:document.createElement('div')});

  const g = gatherGlobal();
  const annualLoadKWh = g.annualKWh;

  const base = {
    planType: g.planType,
    hasPV: g.hasPV,
    annualLoadKWh,
    dayRatio: g.dayRatio,
    fitStartYear: g.fitStartYear,
    fitYearsLeft: g.fitYearsLeft,
    evalYears: g.evalYears
  };

  // 提案A/B
  let proposeA, proposeB;

  if (!g.hasPV) {
    // A: PVのみ最適
    proposeA = optimize({...base}, 'PV_ONLY');
    // B: PV+蓄電池
    proposeB = optimize({...base}, 'PV_BAT');
  } else {
    // 既設あり：A=現状見える化（0kWh電池）
    const existingPvKW = 0; // 既設kWは追加で入力できるよう将来拡張。初版は0扱い→Aは「現状=0?」になるため注意。
    // 現状表示：シミュレーションのみ
    const simA = simulateYear({
      annualLoadKWh,
      dayRatio: g.dayRatio,
      pvKW: existingPvKW,
      batteryKWh: 0,
      hasPV: true,
      fitStartYear: g.fitStartYear,
      fitYearsLeft: g.fitYearsLeft,
      planType: g.planType,
      evalYears: g.evalYears
    });
    proposeA = {
      pvKW: existingPvKW, batKWh: 0, price: 0,
      sim: simA,
      totalBenefit: simA.annualSavingYen * g.evalYears + simA.totalSellRevenue15,
      payoff: simA.annualSavingYen * g.evalYears + simA.totalSellRevenue15,
      paybackYears: Infinity
    };
    // B: 既設前提で蓄電池最適化（バッテリー価格のみ適用）
    proposeB = optimize({...base, existingPvKW}, 'BAT_ONLY_FOR_EXISTING');
  }

  // カードを2枚に更新（既存比較は維持）
  const makeItem = (title, p) => ({
    title,
    detail: `PV=${p.pvKW.toFixed(1)}kW / Battery=${p.batKWh.toFixed(1)}kWh`,
    numbers: {
      pvKW: p.pvKW,
      batKWh: p.batKWh,
      price: p.price,
      annualSaving: p.sim.annualSavingYen,
      annualSell: p.sim.soldYear * ((buildFitSeries(g.fitStartYear, g.fitYearsLeft)[0] ?? CONFIG.fit.postFitYenPerKWh)),
      totalBenefit: p.totalBenefit,
      payoff: p.payoff,
      payback: p.paybackYears
    }
  });

  // 先頭2枚を入れ替え（比較で増やした分は残す）
  const head = makeItem(g.hasPV ? '提案A：現状（参考）' : '提案A：PVのみ（最適）', proposeA);
  const head2 = makeItem(g.hasPV ? '提案B：蓄電池追加（最適）' : '提案B：PV＋蓄電池（最適）', proposeB);

  // 既存の先頭2枚を差し替え、なければ追加
  if (compareCards.length >= 1) compareCards[0] = {...head, _node: buildCardView(head.title, head.detail, head.numbers, compareCards.length>1)};
  else pushCard(head);
  if (compareCards.length >= 2) compareCards[1] = {...head2, _node: buildCardView(head2.title, head2.detail, head2.numbers, true)};
  else pushCard(head2);

  renderCards();
  renderCompareTable();
}

/* ============ イベント配線 ============ */
function initUI() {
  // 入力モード切替
  const scaleInputs = document.getElementById('scaleInputs');
  els.scaleMode.addEventListener('change', () => {
    for (const el of scaleInputs.querySelectorAll('[data-mode]')) {
      el.hidden = (el.getAttribute('data-mode') !== els.scaleMode.value);
    }
    if (document.getElementById('autoRecalc').checked) recompute();
  });

  // hasPVでFIT欄の表示切替
  for (const r of document.querySelectorAll('input[name="hasPV"]')) {
    r.addEventListener('change', () => {
      els.fitBlock.hidden = !(els.hasPV());
      if (document.getElementById('autoRecalc').checked) recompute();
    });
  }

  // 入力変更で再計算
  for (const id of ['annualKWh','annualBill','household','dayRatio','evalYears','fitStartYear','fitYearsLeft']) {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      if (document.getElementById('autoRecalc').checked) recompute();
    });
  }
  for (const n of ['planType']) {
    for (const r of document.querySelectorAll(`input[name="${n}"]`)) {
      r.addEventListener('change', () => {
        if (document.getElementById('autoRecalc').checked) recompute();
      });
    }
  }

  // 「おすすめを再計算」
  document.getElementById('runSuggest').onclick = () => recompute();

  // 比較カード追加
  document.getElementById('addCompare').onclick = () => {
    if (compareCards.length >= CONFIG.evaluation.maxCompareCards) return;
    // 直近のカードを複製
    const base = compareCards[compareCards.length - 1];
    const copy = JSON.parse(JSON.stringify(base));
    const node = buildCardView(copy.title + '（複製）', copy.detail, copy.numbers, true);
    copy._node = node;
    compareCards.push(copy);
    renderCards();
    renderCompareTable();
  };

  // 設定のインポート
  document.getElementById('configFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      CONFIG = { ...CONFIG, ...json };
      recompute();
      alert('設定を読み込みました。');
    } catch (err) {
      alert('設定JSONの読み込みに失敗しました。内容をご確認ください。');
    }
  });

  // 設定のエクスポート
  document.getElementById('exportConfigBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(CONFIG, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sim_config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // 初期化
  document.getElementById('resetBtn').onclick = () => {
    location.reload();
  };

  // 初回描画
  recompute();
}

window.addEventListener('DOMContentLoaded', initUI);
