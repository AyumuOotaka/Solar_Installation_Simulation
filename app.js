/* 15-year Optimizer (Ibaraki, contractor tool) */
(() => {
  'use strict';

  const LS_KEY = 'solar_selector_settings_v3';
  const LS_UNLOCK = 'solar_selector_unlocked_v3';

  // ---- defaults ----
  const DEFAULTS = {
    profitRatePct: 20,          // hidden in modal only
    fixedFeeYen: 1500,
    defaultUnitPrice: 34,
    nightPct: 70,               // user specified
    pvYieldPerKwDay: 3.1,       // user specified (kWh/kW/day)
    pvMinKw: 1.0,
    pvMaxKw: 13.5,
    pvStepKw: 0.01,
    profitTolYen: 100000,
    roiTolPt: 2.0,              // percentage points
    paybackTolY: 1.5,
    showDebug: true,
    passcode: 'ogw'
  };

  // Price median (base) from user's formula:
  // T(x,z) = 287000 + 175500x + 200000z - 1200x^2 - 3000z^2
  function baseMedianYen(x, z) {
    return 287000 + 175500 * x + 200000 * z - 1200 * x * x - 3000 * z * z;
  }

  // Range: median ± (x+z)*25000
  function rangeWidthYen(x, z) {
    return (x + z) * 25000;
  }

  // Tariffs loaded from JSON
  let TARIFFS = [
    { startYear: 1, endYear: 4, yenPerKwh: 24 },
    { startYear: 5, endYear: 10, yenPerKwh: 8.3 },
    { startYear: 11, endYear: 15, yenPerKwh: 8.5 }
  ];

  // Battery sizes loaded from JSON; include z=0 as PV-only option.
  let BATTERY_SIZES = [0];

  const el = (id) => document.getElementById(id);

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const formatYen = (n) => {
    const v = Math.round(n);
    return v.toLocaleString('ja-JP');
  };
  const escapeHtml = (value) => {
    const s = String(value ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };


  function formatPct(p) {
    return (p * 100).toFixed(1) + '%';
  }

  function getSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(next) {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }

  function isUnlocked() {
    return localStorage.getItem(LS_UNLOCK) === '1';
  }

  function setUnlocked(v) {
    localStorage.setItem(LS_UNLOCK, v ? '1' : '0');
  }

  async function loadJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    return await res.json();
  }

  async function loadData() {
    try {
      const t = await loadJson('./data/feed_in_tariffs.json');
      if (Array.isArray(t) && t.length) TARIFFS = t;
    } catch {}
    try {
      const b = await loadJson('./data/battery_sizes.json');
      if (Array.isArray(b) && b.length) {
        const s = Array.from(new Set([0, ...b.map(Number).filter(x => !Number.isNaN(x) && x >= 0)]));
        s.sort((a,b) => a - b);
        BATTERY_SIZES = s;
      }
    } catch {}
  }

  function yearlyFitRate(year) {
    for (const seg of TARIFFS) {
      if (year >= seg.startYear && year <= seg.endYear) return seg.yenPerKwh;
    }
    return TARIFFS.length ? TARIFFS[TARIFFS.length - 1].yenPerKwh : 0;
  }

  // Convert bill to usage kWh/month
  function billToUsageKwhMonth(billYen, unitPrice, fixedFeeYen) {
    const variableYen = Math.max(0, billYen - fixedFeeYen);
    const kwh = unitPrice > 0 ? (variableYen / unitPrice) : 0;
    return { usageKwhMonth: kwh, variableYen };
  }

  // Simple daily energy flow model:
  // PV gen -> day load -> battery -> sell; night load from battery -> grid
  function dailyFlows({ pvKw, batKwh, usageKwhDay, nightPct, pvYieldPerKwDay }) {
    const nightUse = usageKwhDay * (nightPct / 100);
    const dayUse = usageKwhDay - nightUse;

    const pvGen = pvKw * pvYieldPerKwDay;

    const pvToDay = Math.min(pvGen, dayUse);
    const pvExcess = Math.max(0, pvGen - pvToDay);

    const batCharge = Math.min(batKwh, pvExcess);
    const pvSold = Math.max(0, pvExcess - batCharge);

    const batToNight = Math.min(nightUse, batCharge);
    const gridDay = Math.max(0, dayUse - pvToDay);
    const gridNight = Math.max(0, nightUse - batToNight);

    const selfConsumption = pvToDay + batToNight;
    const gridTotal = gridDay + gridNight;

    return {
      pvGen, dayUse, nightUse,
      pvToDay, batCharge, batToNight,
      pvSold,
      gridTotal,
      selfConsumption
    };
  }

  function estimate15yEconomics({ pvKw, batKwh, unitPrice, billYen, settings }) {
    const { usageKwhMonth } = billToUsageKwhMonth(billYen, unitPrice, settings.fixedFeeYen);
    const usageKwhDay = usageKwhMonth / 30; // simple

    const flows = dailyFlows({
      pvKw,
      batKwh,
      usageKwhDay,
      nightPct: settings.nightPct,
      pvYieldPerKwDay: settings.pvYieldPerKwDay
    });

    const days = 365;
    const annualAvoidYen = flows.selfConsumption * unitPrice * days;

    const years = settings.horizonYears || 15;

    let revenueYen = 0;
    for (let y = 1; y <= years; y++) {
      const r = yearlyFitRate(y);
      revenueYen += flows.pvSold * r * days;
    }

    const avoidYen = annualAvoidYen * years;
    const benefitYen = avoidYen + revenueYen;

    return { usageKwhMonth, usageKwhDay, flows, annualAvoidYen, years, avoidYen, revenueYen, benefitYen };
  }

  function estimateCustomerPrice({ pvKw, batKwh, settings }) {
    const base = baseMedianYen(pvKw, batKwh);
    const profitMult = 1 + (settings.profitRatePct / 100);
    const median = base * profitMult;
    const width = rangeWidthYen(pvKw, batKwh);
    const min = median - width;
    const max = median + width;
    return { baseMedian: base, median, min, max, width };
  }

  function paybackYears(cost, yearlyBenefits) {
    if (!(yearlyBenefits(1) > 0)) return Infinity;
    let cum = 0;
    for (let y = 1; y <= 15; y++) {
      const annual = yearlyBenefits(y);
      cum += annual;
      if (cum >= cost) {
        const prev = cum - annual;
        const remain = cost - prev;
        const frac = annual > 0 ? (remain / annual) : 1;
        return (y - 1) + frac;
      }
    }
    return Infinity;
  }

  function evaluateCombo({ pvKw, batKwh, billYen, unitPrice, settings }) {
    const econ = estimate15yEconomics({ pvKw, batKwh, unitPrice, billYen, settings });
    const price = estimateCustomerPrice({ pvKw, batKwh, settings });

    const netProfit = econ.benefitYen - price.median;
    const roi = price.median > 0 ? (netProfit / price.median) : -Infinity;

    const flows = econ.flows;
    const days = 365;
    const annualAvoid = flows.selfConsumption * unitPrice * days;
    const yearlyBenefits = (year) => {
      const r = yearlyFitRate(year);
      const annualRev = flows.pvSold * r * days;
      return annualAvoid + annualRev;
    };

    const pb = paybackYears(price.median, yearlyBenefits);

    return { pvKw, batKwh, price, econ, netProfit, roi, payback: pb };
  }

  function buildPvGrid(settings) {
    const out = [];
    const min = settings.pvMinKw;
    const max = settings.pvMaxKw;
    const step = settings.pvStepKw;

    const n = Math.round((max - min) / step);
    for (let i = 0; i <= n; i++) {
      const v = Math.round((min + step * i) * 100) / 100; // keep 0.01
      out.push(v);
    }
    return out;
  }

  function pickCandidates(all, settings) {
    const useBattery = !!settings.useBattery;
    const budgetYen = (Number.isFinite(settings.budgetYen) && settings.budgetYen > 0) ? settings.budgetYen : Infinity;

    // eligible set respects budget by price.min
    const withinBudget = (a) => (budgetYen === Infinity) ? true : (a.price && a.price.min <= budgetYen);

    // groups (unfiltered)
    const noBatAll = all.filter(a => a.batKwh === 0);
    const withBatAll = all.filter(a => a.batKwh > 0);

    // eligible by toggle: PV-only always, battery only when toggled
    const eligibleAll = useBattery ? all : noBatAll;

    function keyOf(a) { return `${a.pvKw.toFixed(2)}|${a.batKwh.toFixed(1)}`; }

    function pickTwo(arrAll, prefix, messages) {
      const arr = arrAll.filter(withinBudget);
      if (!arr.length) {
        const minLower = arrAll.length ? Math.min(...arrAll.map(a => a.price?.min ?? Infinity)) : Infinity;
        if (budgetYen !== Infinity && Number.isFinite(minLower)) {
          messages.push(`${prefix}予算内候補なし（最安レンジ下限: ¥${formatYen(minLower)}）`);
        } else {
          messages.push(`${prefix}候補なし`);
        }
        return [];
      }

      const profitWinner = arr.reduce((p,c) => (c.netProfit > p.netProfit ? c : p), arr[0]);

      const finitePB = arr.filter(a => Number.isFinite(a.payback));
      const paybackWinner = finitePB.length
        ? finitePB.reduce((p,c) => (c.payback < p.payback ? c : p), finitePB[0])
        : null;

      const out = [];
      const push = (label, cand) => {
        if (!cand) return false;
        const key = keyOf(cand);
        if (out.some(x => x.key === key)) return false;
        out.push({ type: `${prefix}${label}`, key, cand });
        return true;
      };

      push('純利益最大', profitWinner);

      // Payback: if same as profit winner, choose next best payback
      if (paybackWinner && keyOf(paybackWinner) !== keyOf(profitWinner)) {
        push('回収年数最小', paybackWinner);
      } else {
        let alt = null;
        if (finitePB.length) {
          const sorted = [...finitePB].sort((a,b) => a.payback - b.payback);
          alt = sorted.find(a => keyOf(a) !== keyOf(profitWinner)) || null;
        }
        if (alt) push('回収年数最小', alt);
        else {
          const sortedP = [...arr].sort((a,b) => b.netProfit - a.netProfit);
          const altP = sortedP.find(a => keyOf(a) !== keyOf(profitWinner)) || null;
          if (altP) push('回収年数最小', altP);
          else push('回収年数最小', profitWinner);
        }
      }

      return out.slice(0, 2);
    }

    const messages = [];
    const candidates = [];

    // Existing 4 slots
    candidates.push(...pickTwo(noBatAll, 'PVのみ：', messages));
    if (useBattery) {
      candidates.push(...pickTwo(withBatAll, '蓄電池あり：', messages));
    }

    // Extra slots (2):
    // ① 投資金額最大（予算内で最大の中央値）
    const eligibleWithin = eligibleAll.filter(withinBudget);
    if (eligibleWithin.length) {
      const investMax = eligibleWithin.reduce((p,c) => (c.price.median > p.price.median ? c : p), eligibleWithin[0]);
      candidates.push({ type: '予算使い切り：投資金額最大', key: keyOf(investMax), cand: investMax });
    } else {
      messages.push(`全体：予算内候補なし（投資金額最大を算出できません）`);
    }

    // ② 回収年数最小（全体・予算内・トグル適用）
    const finitePBAll = eligibleWithin.filter(a => Number.isFinite(a.payback));
    if (finitePBAll.length) {
      const pbMinAll = finitePBAll.reduce((p,c) => (c.payback < p.payback ? c : p), finitePBAll[0]);
      candidates.push({ type: '全体：回収年数最小', key: keyOf(pbMinAll), cand: pbMinAll });
    } else if (eligibleWithin.length) {
      messages.push(`全体：回収年数が算出できる候補なし`);
    }

    // Ensure unique (avoid duplicates) but keep order; allow <6.
    const seen = new Set();
    const uniq = [];
    for (const item of candidates) {
      const k = item.key;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(item);
      if (uniq.length >= 6) break;
    }

    // stats (overall, unfiltered)
    let bestProfit = -Infinity, bestROI = -Infinity, bestPayback = Infinity;
    for (const a of all) {
      if (a.netProfit > bestProfit) bestProfit = a.netProfit;
      if (a.roi > bestROI) bestROI = a.roi;
      if (Number.isFinite(a.payback) && a.payback < bestPayback) bestPayback = a.payback;
    }

    return { candidates: uniq, messages, stats: { bestProfit, bestROI, bestPayback }, budgetYen, horizonYears: settings.horizonYears || 15 };
  }

function renderPlans(picks, unitPrice) {
    if (!picks.candidates || picks.candidates.length === 0) {
      return `<div class="mini muted">予算内の候補がありません。予算を上げるか、工務店設定（利益率・前提）を見直してください。</div>`;
    }

    return picks.candidates.map(({ type, cand }) => {
      const pv = cand.pvKw.toFixed(2);
      const bat = cand.batKwh > 0 ? cand.batKwh.toFixed(1) + 'kWh' : 'なし';
      const net = cand.netProfit;
      const roi = cand.roi;
      const pb = cand.payback;

      const H = picks.horizonYears || 15;
      const pbText = Number.isFinite(pb) ? pb.toFixed(1) + '年' : `${H}年超`;
      const netText = (net >= 0 ? '+' : '') + formatYen(net) + '円';
      const priceText = `¥${formatYen(cand.price.min)} 〜 ¥${formatYen(cand.price.max)}`;

      return `
        <div class="plan-card">
          <div class="plan-head">
            <div>
              <div class="badge">${escapeHtml(type)}</div>
              <div class="kpi">PV ${pv}kW / 蓄電池 ${escapeHtml(bat)}</div>
            </div>
            <div class="mini muted">電気単価 ${unitPrice.toFixed(1)}円/kWh</div>
          </div>

          <div class="kv">
            <div class="item">
              <div class="label">概算総額（レンジ）</div>
              <div class="value">${priceText}</div>
            </div>
            <div class="item">
              <div class="label">${H}年 純利益（目安）</div>
              <div class="value">${netText}</div>
            </div>
            <div class="item">
              <div class="label">ROI（目安）</div>
              <div class="value">${formatPct(roi)}</div>
            </div>
            <div class="item">
              <div class="label">回収年数（目安）</div>
              <div class="value">${pbText}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function setResultVisible(visible) {
    el('resultEmpty').classList.toggle('hidden', visible);
    el('result').classList.toggle('hidden', !visible);
    el('result').setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function applyPresentationMode(on) {
    document.body.classList.toggle('present', on);
    el('btnPresent').textContent = on ? 'プレゼン解除' : 'プレゼン表示';
  }

  function openModal() {
    el('modalBackdrop').classList.remove('hidden');
    el('modal').classList.remove('hidden');
    el('modalBackdrop').setAttribute('aria-hidden', 'false');
    el('modal').setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    el('modalBackdrop').classList.add('hidden');
    el('modal').classList.add('hidden');
    el('modalBackdrop').setAttribute('aria-hidden', 'true');
    el('modal').setAttribute('aria-hidden', 'true');
  }

  function syncSettingsToUI() {
    const s = getSettings();

    el('profitRate').value = s.profitRatePct;
    el('fixedFee').value = s.fixedFeeYen;
    el('defaultUnitPrice').value = s.defaultUnitPrice;
    el('nightPct').value = s.nightPct;
    el('pvYieldPerKwDay').value = s.pvYieldPerKwDay;
    el('pvMinKw').value = s.pvMinKw;
    el('pvMaxKw').value = s.pvMaxKw;
    el('pvStepKw').value = s.pvStepKw;
    el('profitTolYen').value = s.profitTolYen;
    el('roiTolPt').value = s.roiTolPt;
    el('paybackTolY').value = s.paybackTolY;
    el('showDebug').checked = !!s.showDebug;
    el('fixedFeeLabel').textContent = formatYen(s.fixedFeeYen);

    const unlocked = isUnlocked();
    el('settingsBody').classList.toggle('hidden', !unlocked);
    el('settingsBody').setAttribute('aria-hidden', unlocked ? 'false' : 'true');
  }

  function readSettingsFromUI() {
    const cur = getSettings();
    const next = { ...cur };

    next.profitRatePct = Number(el('profitRate').value || cur.profitRatePct);
    next.fixedFeeYen = Number(el('fixedFee').value || cur.fixedFeeYen);
    next.defaultUnitPrice = Number(el('defaultUnitPrice').value || cur.defaultUnitPrice);
    next.nightPct = Number(el('nightPct').value || cur.nightPct);
    next.pvYieldPerKwDay = Number(el('pvYieldPerKwDay').value || cur.pvYieldPerKwDay);

    next.pvMinKw = Number(el('pvMinKw').value || cur.pvMinKw);
    next.pvMaxKw = Number(el('pvMaxKw').value || cur.pvMaxKw);
    next.pvStepKw = Number(el('pvStepKw').value || cur.pvStepKw);

    next.profitTolYen = Number(el('profitTolYen').value || cur.profitTolYen);
    next.roiTolPt = Number(el('roiTolPt').value || cur.roiTolPt);
    next.paybackTolY = Number(el('paybackTolY').value || cur.paybackTolY);

    next.showDebug = !!el('showDebug').checked;

    const np = String(el('newPasscode').value || '').trim();
    if (np) next.passcode = np;

    // sanitize
    next.profitRatePct = clamp(next.profitRatePct, -50, 300);
    next.fixedFeeYen = clamp(next.fixedFeeYen, 0, 99999);
    next.defaultUnitPrice = clamp(next.defaultUnitPrice, 1, 200);
    next.nightPct = clamp(next.nightPct, 10, 95);
    next.pvYieldPerKwDay = clamp(next.pvYieldPerKwDay, 0.5, 8);

    next.pvMinKw = clamp(next.pvMinKw, 0.5, 50);
    next.pvMaxKw = clamp(next.pvMaxKw, next.pvMinKw, 60);
    next.pvStepKw = clamp(next.pvStepKw, 0.01, 1);

    next.profitTolYen = clamp(next.profitTolYen, 0, 2000000);
    next.roiTolPt = clamp(next.roiTolPt, 0, 20);
    next.paybackTolY = clamp(next.paybackTolY, 0, 10);

    return next;
  }

  
  function comboKey(a) {
    return `${a.pvKw.toFixed(2)}|${a.batKwh.toFixed(1)}`;
  }

  function computeRanks(evals) {
    const rankMap = new Map();

    const byProfit = [...evals].sort((a,b) => b.netProfit - a.netProfit);
    byProfit.forEach((a,i) => {
      const k = comboKey(a);
      const cur = rankMap.get(k) || {};
      cur.profitRank = i + 1;
      rankMap.set(k, cur);
    });

    const byROI = [...evals].sort((a,b) => b.roi - a.roi);
    byROI.forEach((a,i) => {
      const k = comboKey(a);
      const cur = rankMap.get(k) || {};
      cur.roiRank = i + 1;
      rankMap.set(k, cur);
    });

    const byPB = [...evals].sort((a,b) => {
      const ap = Number.isFinite(a.payback) ? a.payback : 1e9;
      const bp = Number.isFinite(b.payback) ? b.payback : 1e9;
      return ap - bp;
    });
    byPB.forEach((a,i) => {
      const k = comboKey(a);
      const cur = rankMap.get(k) || {};
      cur.paybackRank = i + 1;
      rankMap.set(k, cur);
    });

    const byBal = [...evals].sort((a,b) => (a._balancedDist ?? 1e9) - (b._balancedDist ?? 1e9));
    byBal.forEach((a,i) => {
      const k = comboKey(a);
      const cur = rankMap.get(k) || {};
      cur.balancedRank = i + 1;
      rankMap.set(k, cur);
    });

    const topN = (arr, n, mapper) => arr.slice(0, n).map(mapper);

    const topProfit = topN(byProfit, 10, a => ({
      key: comboKey(a),
      pvKw: a.pvKw,
      batKwh: a.batKwh,
      netProfitYen: Math.round(a.netProfit),
      roiPct: Number((a.roi * 100).toFixed(2)),
      paybackY: Number.isFinite(a.payback) ? Number(a.payback.toFixed(2)) : null
    }));

    const topROI = topN(byROI, 10, a => ({
      key: comboKey(a),
      pvKw: a.pvKw,
      batKwh: a.batKwh,
      roiPct: Number((a.roi * 100).toFixed(2)),
      netProfitYen: Math.round(a.netProfit),
      paybackY: Number.isFinite(a.payback) ? Number(a.payback.toFixed(2)) : null
    }));

    const topPB = topN(byPB, 10, a => ({
      key: comboKey(a),
      pvKw: a.pvKw,
      batKwh: a.batKwh,
      paybackY: Number.isFinite(a.payback) ? Number(a.payback.toFixed(2)) : null,
      netProfitYen: Math.round(a.netProfit),
      roiPct: Number((a.roi * 100).toFixed(2)),
    }));

    const topBalanced = topN(byBal, 10, a => ({
      key: comboKey(a),
      pvKw: a.pvKw,
      batKwh: a.batKwh,
      balancedDist: Number((a._balancedDist ?? 0).toFixed(6)),
      netProfitYen: Math.round(a.netProfit),
      roiPct: Number((a.roi * 100).toFixed(2)),
      paybackY: Number.isFinite(a.payback) ? Number(a.payback.toFixed(2)) : null
    }));

    return { rankMap, topProfit, topROI, topPB, topBalanced };
  }

  function logDebugToConsole({ evals, picks, ranks, settings, billYen, unitPrice }) {
    const unlocked = isUnlocked();
    if (!unlocked || !settings.showDebug) return;

    console.groupCollapsed(`SolarSelector Debug | bill=${billYen} unit=${unitPrice}`);
    console.log('Settings:', {
      fixedFeeYen: settings.fixedFeeYen,
      nightPct: settings.nightPct,
      pvYieldPerKwDay: settings.pvYieldPerKwDay,
      pvRange: [settings.pvMinKw, settings.pvMaxKw, settings.pvStepKw],
      profitRatePct: settings.profitRatePct,
      budgetYen: settings.budgetYen,
      batterySizes: BATTERY_SIZES,
      tariffs: TARIFFS
    });

    console.groupCollapsed('Top10 (利益/ROI/回収/バランス)');
    console.table(ranks.topProfit);
    console.table(ranks.topROI);
    console.table(ranks.topPB);
    console.table(ranks.topBalanced);
    console.groupEnd();

    const candRows = picks.candidates.map(({ type, cand }) => {
      const k = comboKey(cand);
      const r = ranks.rankMap.get(k) || {};
      return {
        withinBudget: (settings.budgetYen === Infinity) ? true : (cand.price.min <= settings.budgetYen),
        type,
        key: k,
        pvKw: cand.pvKw,
        batKwh: cand.batKwh,
        price_baseMedian: Math.round(cand.price.baseMedian),
        price_profitAppliedMedian: Math.round(cand.price.median),
        price_width: Math.round(cand.price.width),
        price_rangeMin: Math.round(cand.price.min),
        price_rangeMax: Math.round(cand.price.max),
        econ_avoid: Math.round(cand.econ.avoidYen),
        econ_revenue: Math.round(cand.econ.revenueYen),
        econ_benefit: Math.round(cand.econ.benefitYen),
        netProfit: Math.round(cand.netProfit),
        roiPct: Number((cand.roi * 100).toFixed(2)),
        paybackY: Number.isFinite(cand.payback) ? Number(cand.payback.toFixed(2)) : null,
        rankProfit: r.profitRank,
        rankROI: r.roiRank,
        rankPayback: r.paybackRank,
        rankBalanced: r.balancedRank,
        flow_pvGen_kWhDay: Number(cand.econ.flows.pvGen.toFixed(2)),
        flow_self_kWhDay: Number(cand.econ.flows.selfConsumption.toFixed(2)),
        flow_sold_kWhDay: Number(cand.econ.flows.pvSold.toFixed(2)),
      };
    });
    console.table(candRows);
    console.groupEnd();
  }

  function renderDebug(evals, picks, ranks, settings, billYen, unitPrice) {
    const unlocked = isUnlocked();
    if (!unlocked || !settings.showDebug) return '';

    const lines = [];
    lines.push('--- DEBUG (工務店のみ) ---');
    lines.push(`billYen=${billYen} unitPrice=${unitPrice}`);
    lines.push(`fixedFeeYen=${settings.fixedFeeYen} nightPct=${settings.nightPct} pvYieldPerKwDay=${settings.pvYieldPerKwDay}`);
    lines.push(`profitRatePct=${settings.profitRatePct}`);
    lines.push(`budgetYen=${(Number.isFinite(settings.budgetYen)?settings.budgetYen:'Infinity')}`);
    lines.push(`PV range: ${settings.pvMinKw}..${settings.pvMaxKw} step ${settings.pvStepKw}`);
    lines.push(`battery sizes (count=${BATTERY_SIZES.length}): ${BATTERY_SIZES.join(', ')}`);
    lines.push(`tariffs: ${TARIFFS.map(t => `[${t.startYear}-${t.endYear}:${t.yenPerKwh}]`).join(' ')}`);
    lines.push(`bestProfit=${Math.round(picks.stats.bestProfit)} bestROI=${picks.stats.bestROI.toFixed(6)} bestPayback=${picks.stats.bestPayback}`);
    lines.push('');
    lines.push('--- TOP10 (利益) ---');
    for (const row of ranks.topProfit) {
      const r = ranks.rankMap.get(row.key) || {};
      lines.push(`  #${r.profitRank} ${row.key} profit=${row.netProfitYen} roi=${row.roiPct}% pb=${row.paybackY ?? 'Inf'}`);
    }
    lines.push('');
    lines.push('--- TOP10 (ROI) ---');
    for (const row of ranks.topROI) {
      const r = ranks.rankMap.get(row.key) || {};
      lines.push(`  #${r.roiRank} ${row.key} roi=${row.roiPct}% profit=${row.netProfitYen} pb=${row.paybackY ?? 'Inf'}`);
    }
    lines.push('');
    lines.push('--- TOP10 (回収) ---');
    for (const row of ranks.topPB) {
      const r = ranks.rankMap.get(row.key) || {};
      lines.push(`  #${r.paybackRank} ${row.key} pb=${row.paybackY ?? 'Inf'} profit=${row.netProfitYen} roi=${row.roiPct}%`);
    }
    lines.push('');
    lines.push('--- 推奨候補（なぜ選ばれたか） ---');
    lines.push('※除外ロジックはOFF（デバッグ用）。PVのみ2件＋（蓄電池ありON時）蓄電池あり2件を表示。');
    lines.push('');
    for (const c of picks.candidates) {
      const a = c.cand;
      const key = comboKey(a);
      const r = ranks.rankMap.get(key) || {};
      lines.push(`[${c.type}] key=${key} rankProfit=${r.profitRank} rankROI=${r.roiRank} rankPB=${r.paybackRank} rankBal=${r.balancedRank}`);
      lines.push(`  PV=${a.pvKw.toFixed(2)}kW  bat=${a.batKwh.toFixed(1)}kWh`);
      lines.push(`  PRICE: baseMedian=${Math.round(a.price.baseMedian)} median(afterProfit)=${Math.round(a.price.median)} width=±${Math.round(a.price.width)} range=[${Math.round(a.price.min)}..${Math.round(a.price.max)}]`);
      lines.push(`  FLOWS(kWh/day): pvGen=${a.econ.flows.pvGen.toFixed(2)} pvToDay=${a.econ.flows.pvToDay.toFixed(2)} batCharge=${a.econ.flows.batCharge.toFixed(2)} sold=${a.econ.flows.pvSold.toFixed(2)} batToNight=${a.econ.flows.batToNight.toFixed(2)} self=${a.econ.flows.selfConsumption.toFixed(2)} grid=${a.econ.flows.gridTotal.toFixed(2)}`);
      lines.push(`  ECON: avoid=${Math.round(a.econ.avoidYen)} revenue=${Math.round(a.econ.revenueYen)} benefit=${Math.round(a.econ.benefitYen)}`);
      lines.push(`  METRICS: netProfit=${Math.round(a.netProfit)} ROI=${(a.roi*100).toFixed(2)}% payback=${Number.isFinite(a.payback)?a.payback.toFixed(2):'Inf'}y`);
      lines.push('');
    }
    return lines.join('\n');
  }


function doCalc() {
    const settings = getSettings();
    const billYen = Number(el('billYen').value || 0);
    const unitPrice = Number(el('unitPrice').value || settings.defaultUnitPrice);

    const budgetRaw = (el('budgetYen')?.value ?? '').toString().trim();
    const budgetYen = budgetRaw === '' ? Infinity : Number(budgetRaw);
    settings.budgetYen = (Number.isFinite(budgetYen) && budgetYen > 0) ? budgetYen : Infinity;

    const yearsRaw = (el('horizonYears')?.value ?? '').toString().trim();
    const horizonYears = yearsRaw === '' ? settings.defaultHorizonYears : Number(yearsRaw);
    settings.horizonYears = (Number.isFinite(horizonYears) && horizonYears >= 1) ? Math.round(horizonYears) : settings.defaultHorizonYears;

    const useBattery = !!el('useBattery').checked;
    settings.useBattery = useBattery;

    if (!billYen || billYen <= 0) {
      alert('月の電気代（円）を入力してください。');
      return;
    }
    if (!unitPrice || unitPrice <= 0) {
      alert('電気単価（円/kWh）を入力してください。');
      return;
    }

    const { usageKwhMonth } = billToUsageKwhMonth(billYen, unitPrice, settings.fixedFeeYen);

    el('pillUsage').textContent = `推定使用量: ${usageKwhMonth.toFixed(0)}kWh/月`;
    el('pillTariff').textContent = `売電単価: 1-4年 ${yearlyFitRate(1)}円 / 5-10年 ${yearlyFitRate(5)}円 / 11年以降 ${yearlyFitRate(11)}円`;

    el('pillBudget').textContent = settings.budgetYen === Infinity ? '予算: 制限なし' : `予算: ¥${formatYen(settings.budgetYen)}`;
    el('pillYears').textContent = `期間: ${settings.horizonYears}年`;

    const pvGrid = buildPvGrid(settings);
    const batteryList = useBattery ? BATTERY_SIZES : [0];

    const evals = [];
    for (const x of pvGrid) {
      for (const z of batteryList) {
        evals.push(evaluateCombo({ pvKw: x, batKwh: z, billYen, unitPrice, settings }));
      }
    }

    const picks = pickCandidates(evals, settings);
    const ranks = computeRanks(evals);

    el('plans').innerHTML = renderPlans(picks, unitPrice);
    if (picks.messages && picks.messages.length) {
      const base = el('planNote').textContent || '';
      el('planNote').textContent = base + ' / ' + picks.messages.join(' / ');
    }


    el('planNote').textContent = '※表示：予算内（概算レンジ下限が予算内）の中から、PVのみ2件＋（蓄電池ありON時）蓄電池あり2件＋投資金額最大＋全体回収年数最小（最大6件）';

    const dbg = renderDebug(evals, picks, ranks, settings, billYen, unitPrice);
    el('debugBox').textContent = dbg;
    const showDbg = isUnlocked() && settings.showDebug;
    el('debugBox').classList.toggle('hidden', !showDbg);
    el('debugBox').setAttribute('aria-hidden', showDbg ? 'false' : 'true');

    logDebugToConsole({ evals, picks, ranks, settings, billYen, unitPrice });

    setResultVisible(true);
  }

  function resetAll() {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_UNLOCK);
    saveSettings({ ...DEFAULTS });
    syncSettingsToUI();
    meansHide();
    el('billYen').value = '';
    el('unitPrice').value = '';
    el('useBattery').checked = true;
    closeModal();
  }

  function meansHide() {
    setResultVisible(false);
  }

  async function init() {
    await loadData();

    if (!localStorage.getItem(LS_KEY)) saveSettings({ ...DEFAULTS });

    syncSettingsToUI();

    el('btnCalc').addEventListener('click', doCalc);

    el('btnReset').addEventListener('click', () => {
      if (confirm('入力と設定をリセットしますか？')) resetAll();
    });

    el('btnPresent').addEventListener('click', () => {
      const on = !document.body.classList.contains('present');
      applyPresentationMode(on);
    });

    el('btnContractor').addEventListener('click', openModal);
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.key === '9') openModal();
      if (e.key === 'Escape') closeModal();
    });
    el('modalBackdrop').addEventListener('click', closeModal);
    el('btnCloseModal').addEventListener('click', closeModal);

    el('btnUnlock').addEventListener('click', () => {
      const pass = String(el('passcode').value || '');
      const ok = pass === (getSettings().passcode || DEFAULTS.passcode);
      if (!ok) return alert('パスコードが違います。');
      setUnlocked(true);
      syncSettingsToUI();
    });

    el('btnLock').addEventListener('click', () => {
      setUnlocked(false);
      syncSettingsToUI();
    });

    el('btnSaveSettings').addEventListener('click', () => {
      const next = readSettingsFromUI();
      saveSettings(next);
      syncSettingsToUI();
      el('newPasscode').value = '';
      alert('設定を保存しました。');
      if (!el('result').classList.contains('hidden')) doCalc();
    });

    el('billYen').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doCalc();
    });
  }

  init();
})();