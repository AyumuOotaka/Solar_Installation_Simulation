/* Solar & Battery Selector v2 (Ibaraki / contractor tool)
   - Hidden contractor settings (Shift+9 or tiny button)
   - Pricing: median from polynomial T(x,z); range = median ± (x+z)*25000
*/
(() => {
  'use strict';

  const LS_KEY = 'solar_selector_settings_v2';
  const LS_ADMIN_UNLOCK = 'solar_selector_admin_unlock_v2';

  // ---------------- Defaults (contractor only) ----------------
  const DEFAULTS = {
    profitRatePct: 20,
    fixedFeeYen: 1500,
    defaultUnitPrice: 34,
    coveragePct: 80,
    pvYieldKwhPerKwMonth: 90,
    nightPct: 40,
    maxPvKw: 0, // 0 = unlimited
    topN: 3,
    passcode: 'ogw'
  };

  // ---------------- Data (panels) ----------------
  // You can replace ./data/panels.json later.
  const FALLBACK_PANELS = [
    { id:'panel_a', maker:'MakerA', model:'HighEff 430', watt:430, efficiency:21.5, warrantyProductYears:15, warrantyOutputYears:25, tags:['高効率','コスパ','標準'], baseModuleYen:42000 },
    { id:'panel_b', maker:'MakerB', model:'Value 405',   watt:405, efficiency:20.7, warrantyProductYears:12, warrantyOutputYears:25, tags:['コスパ','標準'], baseModuleYen:36000 },
    { id:'panel_c', maker:'MakerC', model:'Premium 440', watt:440, efficiency:22.0, warrantyProductYears:20, warrantyOutputYears:30, tags:['高保証','高効率'], baseModuleYen:52000 },
    { id:'panel_d', maker:'MakerD', model:'Economy 395', watt:395, efficiency:20.2, warrantyProductYears:12, warrantyOutputYears:25, tags:['低価格','コスパ'], baseModuleYen:33000 },
    { id:'panel_e', maker:'MakerE', model:'Compact 410', watt:410, efficiency:21.0, warrantyProductYears:15, warrantyOutputYears:25, tags:['標準','バランス'], baseModuleYen:40000 }
  ];

  // Battery capacity options (kWh) will be loaded from ./data/battery_sizes.json if available.
  const FALLBACK_BATTERY_SIZES = [3.5, 5.6, 6.3, 6.5, 6.6, 7.7, 9.7, 9.8, 9.9, 10.0, 11.1, 13.3, 13.5, 15.0, 15.4, 16.4, 16.5, 16.6].sort((a,b)=>a-b);

  // ---------------- Pricing functions (tax included) ----------------
  // Based on your image:
  // T(x,z) = 287000 + 175500x + 200000z - 1200x^2 - 3000z^2
  // Range = median ± (x+z)*25000
  const priceMedian = (x, z) => 287000 + 175500*x + 200000*z - 1200*(x**2) - 3000*(z**2);
  const rangeDelta = (x, z) => (x + z) * 25000;

  // ---------------- Utilities ----------------
  const el = (id) => document.getElementById(id);

  const formatYen = (n) => Math.round(n).toLocaleString('ja-JP');
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const roundTo = (n, unit) => Math.round(n / unit) * unit;

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
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

  function isAdminUnlocked() {
    return localStorage.getItem(LS_ADMIN_UNLOCK) === '1';
  }

  function setAdminUnlocked(v) {
    localStorage.setItem(LS_ADMIN_UNLOCK, v ? '1' : '0');
  }

  async function loadJson(path) {
    const res = await fetch(path, { cache:'no-store' });
    if (!res.ok) throw new Error('fetch failed');
    return await res.json();
  }

  async function loadData() {
    let panels = FALLBACK_PANELS;
    let batterySizes = FALLBACK_BATTERY_SIZES;
    try { panels = await loadJson('./data/panels.json'); } catch {}
    try { batterySizes = await loadJson('./data/battery_sizes.json'); } catch {}
    // sanitize
    batterySizes = (batterySizes || [])
      .map(Number)
      .filter(v => Number.isFinite(v) && v > 0)
      .sort((a,b)=>a-b);
    if (!batterySizes.length) batterySizes = FALLBACK_BATTERY_SIZES;
    return { panels, batterySizes };
  }

  // ---------------- Estimation logic ----------------
  function billToKwh({ billYen, unitPrice, fixedFeeYen }) {
    const variable = Math.max(0, billYen - fixedFeeYen);
    const kwh = unitPrice > 0 ? (variable / unitPrice) : 0;
    return { variableYen: variable, kwh };
  }

  function recommendPvKw({ usageKwhMonth, coveragePct, pvYieldKwhPerKwMonth, maxPvKw }) {
    // Placeholder logic (you said you will refine later)
    const targetKwh = usageKwhMonth * (coveragePct / 100);
    const rawKw = pvYieldKwhPerKwMonth > 0 ? (targetKwh / pvYieldKwhPerKwMonth) : 0;

    let pvKw = rawKw;
    if (maxPvKw && maxPvKw > 0) pvKw = Math.min(pvKw, maxPvKw);
    pvKw = clamp(pvKw, 0, 50);
    // keep one decimal
    pvKw = Math.round(pvKw * 10) / 10;
    return { pvKw, targetKwh };
  }

  function chooseBestPanel(panels) {
    // C/P score: lower yen/W is better; add warranty & efficiency lightly
    const scored = panels.map(p => {
      const yenPerW = (p.baseModuleYen ?? 0) / (p.watt ?? 1);
      const warrantyScore = (p.warrantyProductYears ?? 0) * 0.02 + (p.warrantyOutputYears ?? 0) * 0.01;
      const effScore = (p.efficiency ?? 0) * 0.03;
      const score = (1 / yenPerW) * 50 + warrantyScore + effScore;
      return { ...p, yenPerW, score };
    }).sort((a,b) => b.score - a.score);

    return { best: scored[0], ranking: scored };
  }

  function panelCountForKw({ panelWatt, pvKw }) {
    const needW = pvKw * 1000;
    const count = Math.max(1, Math.ceil(needW / panelWatt));
    const actualKw = (count * panelWatt) / 1000;
    return { count, actualKw: Math.round(actualKw * 100) / 100 };
  }

  function recommendBattery({ usageKwhMonth, nightPct, batterySizes, useBattery }) {
    if (!useBattery) return { targetKwh: 0, z: 0, ranking: [] };

    const daily = usageKwhMonth / 30;
    const target = daily * (nightPct / 100);

    // choose smallest option >= target; if none, max
    const z = batterySizes.find(v => v >= target) ?? batterySizes[batterySizes.length - 1] ?? 0;

    // ranking: show near options (closest by abs diff)
    const ranking = batterySizes
      .slice()
      .sort((a,b) => Math.abs(a - target) - Math.abs(b - target));

    return { targetKwh: target, z, ranking };
  }

  function estimatePriceRange({ x, z, profitRatePct }) {
    const medianBase = priceMedian(x, z); // tax included
    const median = medianBase * (1 + (profitRatePct / 100));
    const delta = rangeDelta(x, z);

    let min = median - delta;
    let max = median + delta;

    min = Math.max(0, min);
    // round to 10,000 yen
    min = roundTo(min, 10000);
    max = roundTo(max, 10000);

    return { medianBase, median, min, max, delta };
  }

  // ---------------- Rendering ----------------
  function setResultVisible(visible) {
    el('resultEmpty').classList.toggle('hidden', visible);
    el('result').classList.toggle('hidden', !visible);
    el('result').setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  function applyPresentationMode(on) {
    document.body.classList.toggle('present', on);
    el('btnPresent').textContent = on ? 'プレゼン解除' : 'プレゼン表示';
  }

  function buildReasons({ billYen, fixedFeeYen, unitPrice, usageKwhMonth, variableYen, pv, xActual, battery, zActual }) {
    const reasons = [];
    reasons.push(`月の電気代 <b>${formatYen(billYen)}円</b> から、固定費 <b>${formatYen(fixedFeeYen)}円</b> を除外し、単価 <b>${unitPrice.toFixed(1)}円/kWh</b> で使用量を推定しました。`);
    reasons.push(`推定使用量は <b>${usageKwhMonth.toFixed(0)}kWh/月</b>（変動分: <b>${formatYen(variableYen)}円</b>）。`);
    reasons.push(`推奨PVは <b>${pv.pvKw.toFixed(1)}kW</b>（目標ベース）。実際の提案はパネル枚数に合わせて <b>${xActual.toFixed(2)}kW</b> としています。`);
    if (zActual > 0) {
      reasons.push(`蓄電池は夜間比率を目安に <b>${battery.targetKwh.toFixed(1)}kWh</b> を狙い、扱いやすい容量（候補リスト）から <b>${zActual.toFixed(1)}kWh</b> を選びました。`);
    } else {
      reasons.push(`蓄電池はオフのため、太陽光のみの概算です。`);
    }
    reasons.push(`総額の中央値は、PV容量 x と蓄電池容量 z を用いた式 <b>T(x,z)</b> で算出し、レンジは <b>中央値 ± (x+z)×25,000円</b> としています。`);
    return `<ul>${reasons.map(r => `<li>${r}</li>`).join('')}</ul>`;
  }

  function productCard({ title, subtitle, tags, lines, scoreLabel }) {
    const tagHtml = (tags || []).slice(0,6).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    const lineHtml = (lines || []).map(l => `<div>${l}</div>`).join('');
    return `
      <div class="product-card">
        <div class="product-title">
          <div>
            <div class="name">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="mini">${escapeHtml(subtitle)}</div>` : ''}
          </div>
          ${scoreLabel ? `<div class="score">${escapeHtml(scoreLabel)}</div>` : ''}
        </div>
        <div class="tags">${tagHtml}</div>
        <div class="mini">${lineHtml}</div>
      </div>
    `;
  }

  function renderCandidates({ panelPick, panelCount, xActual, battery, zActual, batterySizes, topN }) {
    const panelTop = panelPick.ranking.slice(0, topN);

    const panelCards = panelTop.map((p, i) => {
      const yenPerW = (p.baseModuleYen ?? 0) / (p.watt ?? 1);
      return productCard({
        title: `#${i+1} ${p.maker} ${p.model}`,
        subtitle: `${p.watt}W / 効率${p.efficiency}% / 製品保証${p.warrantyProductYears}年`,
        tags: p.tags,
        lines: [
          `参考：${formatYen(p.baseModuleYen)}円/枚（${yenPerW.toFixed(1)}円/W）`,
          `出力保証：${p.warrantyOutputYears}年`
        ],
        scoreLabel: `score ${p.score.toFixed(2)}`
      });
    }).join('');

    // Battery size candidates: show nearest options
    const batTop = (battery.ranking || []).slice(0, topN).sort((a,b)=>a-b);
    const batCards = batTop.map((v, i) => {
      const comp = -3000*(v**2) + 200000*v + 280000; // B(z) (reference)
      return productCard({
        title: `#${i+1} 容量 ${v.toFixed(1)}kWh`,
        subtitle: `候補リストから選定`,
        tags: ['容量', '節約'],
        lines: [
          `参考：B(z) = ${formatYen(comp)}円（単体の目安）`
        ],
        scoreLabel: ''
      });
    }).join('');

    return `
      <div class="product-grid">
        ${productCard({
          title: '推奨パネル',
          subtitle: `${panelPick.best.maker} ${panelPick.best.model}`,
          tags: panelPick.best.tags,
          lines: [
            `推奨枚数：<b>${panelCount}枚</b>（約 <b>${xActual.toFixed(2)}kW</b>）`
          ],
          scoreLabel: ''
        })}
        ${zActual > 0 ? productCard({
          title: '推奨蓄電池（容量）',
          subtitle: `${zActual.toFixed(1)}kWh`,
          tags: ['容量', '節約'],
          lines: [
            `目標：<b>${battery.targetKwh.toFixed(1)}kWh</b>（夜間比率）`,
            `候補一覧：${batterySizes.length}種類`
          ],
          scoreLabel: ''
        }) : productCard({
          title: '推奨蓄電池',
          subtitle: 'オフ',
          tags: ['太陽光のみ'],
          lines: ['蓄電池を含めたい場合は「蓄電池を含める」をONにしてください。'],
          scoreLabel: ''
        })}
      </div>

      <div class="divider"></div>

      <div class="section">
        <h3>パネル候補（コスパ上位）</h3>
        <div class="product-grid">${panelCards}</div>
      </div>

      <div class="divider"></div>

      <div class="section">
        <h3>蓄電池候補（容量・近い順）</h3>
        <div class="product-grid">${zActual > 0 ? batCards : '<div class="mini">蓄電池OFF</div>'}</div>
      </div>
    `;
  }

  function renderCompare({ panelPick, topN, batteryTop }) {
    const pTop = panelPick.ranking.slice(0, topN);

    const panelRows = pTop.map((p, i) => {
      const yenPerW = (p.baseModuleYen ?? 0) / (p.watt ?? 1);
      return `<tr>
        <td>#${i+1}</td>
        <td>${escapeHtml(p.maker)} ${escapeHtml(p.model)}</td>
        <td>${p.watt}W</td>
        <td>${p.efficiency}%</td>
        <td>${yenPerW.toFixed(1)}円/W</td>
        <td>${p.warrantyProductYears}年</td>
      </tr>`;
    }).join('');

    const batRows = (batteryTop || []).map((v, i) => {
      const comp = -3000*(v**2) + 200000*v + 280000;
      return `<tr>
        <td>#${i+1}</td>
        <td>${v.toFixed(1)}kWh</td>
        <td>${formatYen(comp)}円</td>
      </tr>`;
    }).join('');

    return `
      <div class="mini"><b>パネル比較</b></div>
      <table class="table">
        <thead><tr><th>#</th><th>製品</th><th>W</th><th>効率</th><th>円/W</th><th>製品保証</th></tr></thead>
        <tbody>${panelRows}</tbody>
      </table>

      <div style="height:12px"></div>

      <div class="mini"><b>蓄電池（容量候補）</b></div>
      <table class="table">
        <thead><tr><th>#</th><th>容量</th><th>B(z)（参考）</th></tr></thead>
        <tbody>${batRows || '<tr><td colspan="3">蓄電池OFF</td></tr>'}</tbody>
      </table>
    `;
  }

  // ---------------- Admin modal ----------------
  function openAdminModal() {
    el('adminModal').classList.remove('hidden');
    el('adminModal').setAttribute('aria-hidden','false');

    const unlocked = isAdminUnlocked();
    el('adminLocked').classList.toggle('hidden', unlocked);
    el('adminBody').classList.toggle('hidden', !unlocked);
    el('adminBody').setAttribute('aria-hidden', unlocked ? 'false' : 'true');

    // focus
    (unlocked ? el('profitRate') : el('adminPasscode')).focus();
  }

  function closeAdminModal() {
    el('adminModal').classList.add('hidden');
    el('adminModal').setAttribute('aria-hidden','true');
  }

  function syncSettingsToAdminUI(settings) {
    el('profitRate').value = settings.profitRatePct;
    el('fixedFee').value = settings.fixedFeeYen;
    el('defaultUnitPrice').value = settings.defaultUnitPrice;
    el('coveragePct').value = settings.coveragePct;
    el('pvYield').value = settings.pvYieldKwhPerKwMonth;
    el('nightPct').value = settings.nightPct;
    el('maxPvKw').value = settings.maxPvKw;
    el('topN').value = String(settings.topN ?? 3);
    el('passcode').value = settings.passcode ?? DEFAULTS.passcode;
  }

  function readSettingsFromAdminUI(prev) {
    const next = { ...prev };
    next.profitRatePct = Number(el('profitRate').value ?? DEFAULTS.profitRatePct);
    next.fixedFeeYen = Number(el('fixedFee').value ?? DEFAULTS.fixedFeeYen);
    next.defaultUnitPrice = Number(el('defaultUnitPrice').value ?? DEFAULTS.defaultUnitPrice);
    next.coveragePct = Number(el('coveragePct').value ?? DEFAULTS.coveragePct);
    next.pvYieldKwhPerKwMonth = Number(el('pvYield').value ?? DEFAULTS.pvYieldKwhPerKwMonth);
    next.nightPct = Number(el('nightPct').value ?? DEFAULTS.nightPct);
    next.maxPvKw = Number(el('maxPvKw').value ?? DEFAULTS.maxPvKw);
    next.topN = Number(el('topN').value ?? DEFAULTS.topN);
    next.passcode = String(el('passcode').value || DEFAULTS.passcode).trim() || DEFAULTS.passcode;

    // sanitize
    next.profitRatePct = clamp(next.profitRatePct, -50, 300);
    next.fixedFeeYen = clamp(next.fixedFeeYen, 0, 99999);
    next.defaultUnitPrice = clamp(next.defaultUnitPrice, 1, 200);
    next.coveragePct = clamp(next.coveragePct, 10, 120);
    next.pvYieldKwhPerKwMonth = clamp(next.pvYieldKwhPerKwMonth, 50, 140);
    next.nightPct = clamp(next.nightPct, 10, 80);
    next.maxPvKw = clamp(next.maxPvKw, 0, 50);
    next.topN = next.topN === 5 ? 5 : 3;

    return next;
  }

  // ---------------- Main flow ----------------
  let DATA = { panels: FALLBACK_PANELS, batterySizes: FALLBACK_BATTERY_SIZES };
  let SETTINGS = getSettings();

  function updateFixedFeeLabel() {
    el('fixedFeeLabel').textContent = formatYen(SETTINGS.fixedFeeYen);
  }

  function doCalc() {
    SETTINGS = getSettings();

    const billYen = Number(el('billYen').value || 0);
    const unitPrice = Number(el('unitPrice').value || SETTINGS.defaultUnitPrice);
    const useBattery = !!el('useBattery').checked;

    if (!billYen || billYen <= 0) {
      alert('月の電気代（円）を入力してください。');
      return;
    }

    const { variableYen, kwh: usageKwhMonth } = billToKwh({
      billYen,
      unitPrice,
      fixedFeeYen: SETTINGS.fixedFeeYen
    });

    const pv = recommendPvKw({
      usageKwhMonth,
      coveragePct: SETTINGS.coveragePct,
      pvYieldKwhPerKwMonth: SETTINGS.pvYieldKwhPerKwMonth,
      maxPvKw: SETTINGS.maxPvKw
    });

    const panelPick = (() => {
      const pick = chooseBestPanel(DATA.panels);
      const countInfo = panelCountForKw({ panelWatt: pick.best.watt, pvKw: pv.pvKw });
      return { ...pick, panelCount: countInfo.count, xActualKw: countInfo.actualKw };
    })();

    const battery = recommendBattery({
      usageKwhMonth,
      nightPct: SETTINGS.nightPct,
      batterySizes: DATA.batterySizes,
      useBattery
    });

    const x = panelPick.xActualKw;
    const z = battery.z || 0;

    const totals = estimatePriceRange({
      x, z,
      profitRatePct: SETTINGS.profitRatePct
    });

    // Render KPIs (note: profit rate is NOT shown anywhere)
    el('pillUsage').textContent = `使用量: ${usageKwhMonth.toFixed(0)}kWh/月（単価 ${unitPrice.toFixed(1)}円/kWh）`;
    el('pillGoal').textContent = `目標: ${pv.targetKwh.toFixed(0)}kWh/月（${SETTINGS.coveragePct}%）`;
    el('pillMode').textContent = `表示: 税込概算レンジ`;

    let systemLine = `PV 約${x.toFixed(2)}kW（${panelPick.panelCount}枚 × ${panelPick.best.watt}W）`;
    let systemSub = `推奨: ${pv.pvKw.toFixed(1)}kW（目標ベース）`;
    if (z > 0) {
      systemLine += ` + 蓄電池 ${z.toFixed(1)}kWh`;
      systemSub += ` / 蓄電池目標 ${battery.targetKwh.toFixed(1)}kWh`;
    }

    el('kpiSystem').innerHTML = systemLine;
    el('kpiSystemSub').textContent = systemSub;

    el('kpiPrice').innerHTML = `¥${formatYen(totals.min)} 〜 ¥${formatYen(totals.max)}`;
    el('kpiPriceNote').textContent = `中央値 ¥${formatYen(roundTo(totals.median, 10000))}（レンジ幅: ±¥${formatYen(roundTo(totals.delta, 1000))}）`;

    el('reasons').innerHTML = buildReasons({
      billYen,
      fixedFeeYen: SETTINGS.fixedFeeYen,
      unitPrice,
      usageKwhMonth,
      variableYen,
      pv,
      xActual: x,
      battery,
      zActual: z
    });

    const topN = SETTINGS.topN ?? 3;
    el('candidates').innerHTML = renderCandidates({
      panelPick,
      panelCount: panelPick.panelCount,
      xActual: x,
      battery,
      zActual: z,
      batterySizes: DATA.batterySizes,
      topN
    });

    const batteryTop = (battery.ranking || []).slice(0, topN).sort((a,b)=>a-b);
    el('compare').innerHTML = renderCompare({
      panelPick,
      topN,
      batteryTop
    });

    setResultVisible(true);
  }

  function resetAll() {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_ADMIN_UNLOCK);
    SETTINGS = { ...DEFAULTS };
    saveSettings(SETTINGS);
    updateFixedFeeLabel();
    setResultVisible(false);
    el('billYen').value = '';
    el('unitPrice').value = '';
    el('allElectric').value = 'no';
    el('useBattery').checked = true;
  }

  // ---------------- Init ----------------
  async function init() {
    DATA = await loadData();

    if (!localStorage.getItem(LS_KEY)) saveSettings({ ...DEFAULTS });
    SETTINGS = getSettings();
    updateFixedFeeLabel();

    // Buttons
    el('btnCalc').addEventListener('click', doCalc);

    el('btnReset').addEventListener('click', () => {
      if (confirm('入力と設定をリセットしますか？')) resetAll();
    });

    el('btnPresent').addEventListener('click', () => {
      const on = !document.body.classList.contains('present');
      applyPresentationMode(on);
    });

    // Admin open triggers: tiny button + Shift+9
    el('btnAdmin').addEventListener('click', () => {
      SETTINGS = getSettings();
      syncSettingsToAdminUI(SETTINGS);
      openAdminModal();
    });

    document.addEventListener('keydown', (e) => {
      const isShift9 = e.shiftKey && (e.code === 'Digit9' || e.key === '(' || e.key === ')');
      if (isShift9) {
        e.preventDefault();
        SETTINGS = getSettings();
        syncSettingsToAdminUI(SETTINGS);
        openAdminModal();
        return;
      }
      if (e.key === 'Escape' && !el('adminModal').classList.contains('hidden')) {
        closeAdminModal();
      }
    });

    // Admin modal controls
    el('adminBackdrop').addEventListener('click', closeAdminModal);
    el('btnAdminClose').addEventListener('click', closeAdminModal);

    el('btnAdminUnlock').addEventListener('click', () => {
      const pass = String(el('adminPasscode').value || '');
      const ok = pass === (getSettings().passcode || DEFAULTS.passcode);
      if (!ok) {
        alert('パスコードが違います。');
        return;
      }
      setAdminUnlocked(true);
      SETTINGS = getSettings();
      syncSettingsToAdminUI(SETTINGS);
      el('adminLocked').classList.add('hidden');
      el('adminBody').classList.remove('hidden');
      el('adminBody').setAttribute('aria-hidden','false');
      el('profitRate').focus();
    });

    el('btnSaveSettings').addEventListener('click', () => {
      const prev = getSettings();
      const next = readSettingsFromAdminUI(prev);
      saveSettings(next);
      SETTINGS = next;
      updateFixedFeeLabel();
      alert('設定を保存しました。');
      // Recalc if results are visible
      if (!el('result').classList.contains('hidden')) doCalc();
    });

    // Quick calc on Enter
    el('billYen').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doCalc();
    });
  }

  init();
})();
