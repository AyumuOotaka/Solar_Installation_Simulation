/* Solar & Battery Selector MVP (Ibaraki, contractor tool) */
(() => {
  'use strict';

  const LS_KEY = 'solar_selector_settings_v1';
  const LS_UNLOCK = 'solar_selector_unlocked_v1';

  // ----- Defaults (can be changed via contractor panel) -----
  const DEFAULTS = {
    profitRatePct: 20,        // contractor profit %
    rangePct: 5,              // +/- range %
    fixedFeeYen: 1500,        // monthly fixed fee
    defaultUnitPrice: 34,     // yen/kWh if not provided
    coveragePct: 80,          // % of monthly usage to offset with PV (placeholder)
    pvYieldKwhPerKwMonth: 90, // Ibaraki rough: kWh per kW per month (placeholder)
    nightPct: 40,             // % of daily usage to shift to battery (placeholder)
    maxPvKw: 0,               // 0 = unlimited
    taxIncluded: true,        // show tax included (10%)
    showBreakdown: false,
    topN: 3,
    passcode: 'ogw'           // ⚠️ demo only
  };

  // ----- Embedded fallback data (replace with your own list later) -----
  const FALLBACK_PANELS = [
    {
      id: 'panel_a',
      maker: 'MakerA',
      model: 'HighEff 430',
      watt: 430,
      efficiency: 21.5,
      warrantyProductYears: 15,
      warrantyOutputYears: 25,
      tags: ['高効率', 'コスパ', '標準'],
      // Base wholesale price to contractor (example): per module
      baseModuleYen: 42000
    },
    {
      id: 'panel_b',
      maker: 'MakerB',
      model: 'Value 405',
      watt: 405,
      efficiency: 20.7,
      warrantyProductYears: 12,
      warrantyOutputYears: 25,
      tags: ['コスパ', '標準'],
      baseModuleYen: 36000
    },
    {
      id: 'panel_c',
      maker: 'MakerC',
      model: 'Premium 440',
      watt: 440,
      efficiency: 22.0,
      warrantyProductYears: 20,
      warrantyOutputYears: 30,
      tags: ['高保証', '高効率'],
      baseModuleYen: 52000
    },
    {
      id: 'panel_d',
      maker: 'MakerD',
      model: 'Economy 395',
      watt: 395,
      efficiency: 20.2,
      warrantyProductYears: 12,
      warrantyOutputYears: 25,
      tags: ['低価格', 'コスパ'],
      baseModuleYen: 33000
    },
    {
      id: 'panel_e',
      maker: 'MakerE',
      model: 'Compact 410',
      watt: 410,
      efficiency: 21.0,
      warrantyProductYears: 15,
      warrantyOutputYears: 25,
      tags: ['標準', 'バランス'],
      baseModuleYen: 40000
    }
  ];

  const FALLBACK_BATTERIES = [
    {
      id: 'bat_a',
      maker: 'MakerA',
      model: 'Saver 6.5',
      kwh: 6.5,
      outputKw: 3.0,
      warrantyYears: 10,
      tags: ['節約', '標準'],
      baseUnitYen: 680000,      // wholesale (example)
      baseInstallYen: 180000
    },
    {
      id: 'bat_b',
      maker: 'MakerB',
      model: 'Saver 9.8',
      kwh: 9.8,
      outputKw: 4.0,
      warrantyYears: 10,
      tags: ['節約', '人気'],
      baseUnitYen: 860000,
      baseInstallYen: 200000
    },
    {
      id: 'bat_c',
      maker: 'MakerC',
      model: 'Premium 12.7',
      kwh: 12.7,
      outputKw: 5.5,
      warrantyYears: 15,
      tags: ['大容量', '高保証'],
      baseUnitYen: 1150000,
      baseInstallYen: 220000
    },
    {
      id: 'bat_d',
      maker: 'MakerD',
      model: 'Mini 5.0',
      kwh: 5.0,
      outputKw: 2.5,
      warrantyYears: 10,
      tags: ['低価格', '節約'],
      baseUnitYen: 560000,
      baseInstallYen: 170000
    },
    {
      id: 'bat_e',
      maker: 'MakerE',
      model: 'Balance 8.0',
      kwh: 8.0,
      outputKw: 3.5,
      warrantyYears: 12,
      tags: ['バランス'],
      baseUnitYen: 760000,
      baseInstallYen: 190000
    }
  ];

  // System-level base costs (wholesale to contractor)
  const BASE_COSTS = {
    pvInstallYen: 350000,     // standard PV install (example)
    pvBOSYen: 140000,         // mount / wiring / misc (example)
    inverterYen: 220000       // standard PCS / related (example)
  };

  // ----- Utilities -----
  const el = (id) => document.getElementById(id);

  const formatYen = (n) => {
    const v = Math.round(n);
    return v.toLocaleString('ja-JP');
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const roundTo = (n, unit) => Math.round(n / unit) * unit;

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
    // Try external JSON; fallback to embedded
    let panels = FALLBACK_PANELS;
    let batteries = FALLBACK_BATTERIES;
    try { panels = await loadJson('./data/panels.json'); } catch {}
    try { batteries = await loadJson('./data/batteries.json'); } catch {}
    return { panels, batteries };
  }

  // ----- Core calculations -----
  function billToKwh({ billYen, unitPrice, fixedFeeYen }) {
    const variable = Math.max(0, billYen - fixedFeeYen);
    const kwh = unitPrice > 0 ? (variable / unitPrice) : 0;
    return { variableYen: variable, kwh };
  }

  function recommendPvKw({ usageKwhMonth, coveragePct, pvYieldKwhPerKwMonth, maxPvKw }) {
    // Placeholder logic (user said "後でロジック差し替え可")
    const targetKwh = usageKwhMonth * (coveragePct / 100);
    const rawKw = pvYieldKwhPerKwMonth > 0 ? (targetKwh / pvYieldKwhPerKwMonth) : 0;

    let pvKw = rawKw;
    if (maxPvKw && maxPvKw > 0) pvKw = Math.min(pvKw, maxPvKw);
    pvKw = clamp(pvKw, 0, 50);
    return { pvKw, targetKwh };
  }

  function choosePanelConfig({ panels, pvKwTarget }) {
    // Choose best "cost performance" panel by score, then compute required count
    const scored = panels.map(p => {
      const yenPerW = p.baseModuleYen / p.watt; // lower is better
      const warrantyScore = (p.warrantyProductYears ?? 0) * 0.02 + (p.warrantyOutputYears ?? 0) * 0.01;
      const effScore = (p.efficiency ?? 0) * 0.03;
      const score = (1 / yenPerW) * 50 + warrantyScore + effScore; // simplistic
      return { ...p, yenPerW, score };
    }).sort((a,b) => b.score - a.score);

    const best = scored[0];
    const needW = pvKwTarget * 1000;
    const count = Math.max(1, Math.ceil(needW / best.watt));
    const actualKw = (count * best.watt) / 1000;
    return { bestPanel: best, panelCount: count, actualKw, panelRanking: scored };
  }

  function recommendBatteryKwh({ usageKwhMonth, nightPct, batteries, useBattery }) {
    if (!useBattery) return { targetKwh: 0, battery: null, batteryRanking: [] };

    const daily = usageKwhMonth / 30;
    const target = daily * (nightPct / 100);

    // Choose smallest battery >= target; if none, choose max
    const ranked = batteries
      .map(b => {
        // cost per kWh; lower better. warranty adds a little
        const costPerKwh = (b.baseUnitYen + (b.baseInstallYen ?? 0)) / b.kwh;
        const score = (1 / costPerKwh) * 100 + (b.warrantyYears ?? 0) * 0.05;
        return { ...b, costPerKwh, score };
      })
      .sort((a,b) => b.score - a.score);

    const candidates = ranked
      .slice()
      .sort((a,b) => a.kwh - b.kwh);

    let chosen = candidates.find(x => x.kwh >= target) || candidates[candidates.length - 1] || null;
    return { targetKwh: target, battery: chosen, batteryRanking: ranked };
  }

  function estimateTotal({
    panel, panelCount,
    battery,
    settings
  }) {
    const pvModules = panel.baseModuleYen * panelCount;
    const pvFixed = BASE_COSTS.pvInstallYen + BASE_COSTS.pvBOSYen + BASE_COSTS.inverterYen;

    const batUnit = battery ? battery.baseUnitYen : 0;
    const batInstall = battery ? (battery.baseInstallYen ?? 0) : 0;

    const baseTotal = pvModules + pvFixed + batUnit + batInstall;

    const profitRate = settings.profitRatePct / 100;
    const afterProfit = baseTotal * (1 + profitRate);

    const range = settings.rangePct / 100;
    let min = afterProfit * (1 - range);
    let max = afterProfit * (1 + range);

    // tax included?
    const tax = settings.taxIncluded ? 1.10 : 1.0;
    min *= tax; max *= tax;

    // round to nearest 10,000 yen for presentation
    min = roundTo(min, 10000);
    max = roundTo(max, 10000);

    return {
      baseTotal,
      afterProfit,
      min,
      max,
      breakdown: {
        pvModules,
        pvFixed,
        batUnit,
        batInstall
      }
    };
  }

  // ----- Rendering -----
  function buildReasons({ usageKwhMonth, variableYen, unitPrice, fixedFeeYen, pv, panelPick, batRec, settings, billYen }) {
    const reasons = [];
    reasons.push(`月の電気代 <b>${formatYen(billYen)}円</b> から、固定費 <b>${formatYen(fixedFeeYen)}円</b> を除外し、単価 <b>${unitPrice.toFixed(1)}円/kWh</b> で使用量を推定しました。`);
    reasons.push(`推定使用量は <b>${usageKwhMonth.toFixed(0)}kWh/月</b>（変動分: <b>${formatYen(variableYen)}円</b>）。`);
    reasons.push(`自家消費で賄いたい割合を <b>${settings.coveragePct}%</b> とし、茨城の概算発電量 <b>${settings.pvYieldKwhPerKwMonth}kWh/kW/月</b> で推奨容量を算出しています（後でロジック差し替え可）。`);
    reasons.push(`パネルは “円/W + 保証 + 効率” を簡易スコア化し、最もコスパが良い候補から枚数を決めています。`);
    if (batRec.battery) {
      reasons.push(`蓄電池は夜間比率 <b>${settings.nightPct}%</b> を目安にし、扱い製品の容量に合わせて選定しています。`);
    } else {
      reasons.push(`蓄電池はオフのため、太陽光のみの概算です。`);
    }
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

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#39;');
  }

  function renderCandidates({ panelPick, batRec, totals, settings }) {
    const topN = Number(settings.topN) || 3;

    const panelTop = panelPick.panelRanking.slice(0, topN);
    const batteryTop = batRec.batteryRanking.slice(0, topN);

    const panelCards = panelTop.map((p, i) => {
      const yenPerW = (p.yenPerW ?? (p.baseModuleYen / p.watt));
      return productCard({
        title: `#${i+1} ${p.maker} ${p.model}`,
        subtitle: `${p.watt}W / 効率${p.efficiency}% / 製品保証${p.warrantyProductYears}年`,
        tags: p.tags,
        lines: [
          `卸ベース（例）：${formatYen(p.baseModuleYen)}円/枚（${yenPerW.toFixed(1)}円/W）`,
          `出力保証：${p.warrantyOutputYears}年`
        ],
        scoreLabel: `score ${p.score.toFixed(2)}`
      });
    }).join('');

    const batCards = batteryTop.map((b, i) => {
      const costPer = (b.costPerKwh ?? ((b.baseUnitYen + (b.baseInstallYen ?? 0)) / b.kwh));
      return productCard({
        title: `#${i+1} ${b.maker} ${b.model}`,
        subtitle: `${b.kwh}kWh / 出力${b.outputKw}kW / 保証${b.warrantyYears}年`,
        tags: b.tags,
        lines: [
          `卸ベース（例）：本体${formatYen(b.baseUnitYen)}円 + 工事${formatYen(b.baseInstallYen ?? 0)}円`,
          `目安：${costPer.toFixed(0)}円/kWh`
        ],
        scoreLabel: `score ${b.score.toFixed(2)}`
      });
    }).join('');

    const breakdown = settings.showBreakdown ? `
      <div class="divider"></div>
      <div class="mini">
        <b>内訳（卸ベース）</b><br/>
        PVモジュール: ${formatYen(totals.breakdown.pvModules)}円 / PV固定: ${formatYen(totals.breakdown.pvFixed)}円<br/>
        蓄電池本体: ${formatYen(totals.breakdown.batUnit)}円 / 蓄電池工事: ${formatYen(totals.breakdown.batInstall)}円
      </div>
    ` : '';

    return `
      <div class="product-grid">
        ${productCard({
          title: '推奨パネル',
          subtitle: `${panelPick.bestPanel.maker} ${panelPick.bestPanel.model}`,
          tags: panelPick.bestPanel.tags,
          lines: [
            `推奨枚数：<b>${panelPick.panelCount}枚</b>（約 <b>${panelPick.actualKw.toFixed(2)}kW</b>）`,
            `※屋根無制限前提。上限が必要なら「PV上限」を設定してください。`
          ],
          scoreLabel: ''
        })}
        ${batRec.battery ? productCard({
          title: '推奨蓄電池',
          subtitle: `${batRec.battery.maker} ${batRec.battery.model}`,
          tags: batRec.battery.tags,
          lines: [
            `目標：<b>${batRec.targetKwh.toFixed(1)}kWh</b>（夜間比率 ${settings.nightPct}%）`,
            `選定：<b>${batRec.battery.kwh}kWh</b> / 出力 <b>${batRec.battery.outputKw}kW</b>`
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
        <h3>蓄電池候補（コスパ上位）</h3>
        <div class="product-grid">${batCards || '<div class="mini">蓄電池OFF</div>'}</div>
      </div>

      ${breakdown}
    `;
  }

  function renderCompare({ panelPick, batRec, settings }) {
    const topN = Number(settings.topN) || 3;
    const pTop = panelPick.panelRanking.slice(0, topN);
    const bTop = batRec.batteryRanking.slice(0, topN);

    const panelRows = pTop.map((p, i) => {
      const yenPerW = (p.yenPerW ?? (p.baseModuleYen / p.watt));
      return `<tr>
        <td>#${i+1}</td>
        <td>${escapeHtml(p.maker)} ${escapeHtml(p.model)}</td>
        <td>${p.watt}W</td>
        <td>${p.efficiency}%</td>
        <td>${formatYen(p.baseModuleYen)}円/枚</td>
        <td>${yenPerW.toFixed(1)}円/W</td>
        <td>${p.warrantyProductYears}年</td>
      </tr>`;
    }).join('');

    const batteryRows = bTop.map((b, i) => {
      const unit = b.baseUnitYen + (b.baseInstallYen ?? 0);
      return `<tr>
        <td>#${i+1}</td>
        <td>${escapeHtml(b.maker)} ${escapeHtml(b.model)}</td>
        <td>${b.kwh}kWh</td>
        <td>${b.outputKw}kW</td>
        <td>${formatYen(unit)}円（本体+工事）</td>
        <td>${b.warrantyYears}年</td>
      </tr>`;
    }).join('');

    return `
      <div class="mini"><b>パネル比較</b></div>
      <table class="table">
        <thead><tr><th>#</th><th>製品</th><th>W</th><th>効率</th><th>卸ベース</th><th>円/W</th><th>保証</th></tr></thead>
        <tbody>${panelRows}</tbody>
      </table>

      <div style="height:12px"></div>

      <div class="mini"><b>蓄電池比較</b></div>
      <table class="table">
        <thead><tr><th>#</th><th>製品</th><th>kWh</th><th>出力</th><th>卸ベース</th><th>保証</th></tr></thead>
        <tbody>${batteryRows || '<tr><td colspan="6">蓄電池OFF</td></tr>'}</tbody>
      </table>
    `;
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

  // ----- Init UI -----
  let DATA = { panels: FALLBACK_PANELS, batteries: FALLBACK_BATTERIES };
  let SETTINGS = getSettings();

  function syncSettingsToUI() {
    el('profitRate').value = SETTINGS.profitRatePct;
    el('rangePct').value = SETTINGS.rangePct;
    el('fixedFee').value = SETTINGS.fixedFeeYen;
    el('defaultUnitPrice').value = SETTINGS.defaultUnitPrice;
    el('coveragePct').value = SETTINGS.coveragePct;
    el('pvYield').value = SETTINGS.pvYieldKwhPerKwMonth;
    el('nightPct').value = SETTINGS.nightPct;
    el('maxPvKw').value = SETTINGS.maxPvKw;
    el('taxIncluded').checked = !!SETTINGS.taxIncluded;
    el('showBreakdown').checked = !!SETTINGS.showBreakdown;
    el('topN').value = String(SETTINGS.topN ?? 3);
    el('fixedFeeLabel').textContent = formatYen(SETTINGS.fixedFeeYen);

    const unlocked = isUnlocked();
    el('settingsBody').classList.toggle('hidden', !unlocked);
    el('settingsBody').setAttribute('aria-hidden', unlocked ? 'false' : 'true');
  }

  function readSettingsFromUI() {
    const next = { ...SETTINGS };
    next.profitRatePct = Number(el('profitRate').value ?? DEFAULTS.profitRatePct);
    next.rangePct = Number(el('rangePct').value ?? DEFAULTS.rangePct);
    next.fixedFeeYen = Number(el('fixedFee').value ?? DEFAULTS.fixedFeeYen);
    next.defaultUnitPrice = Number(el('defaultUnitPrice').value ?? DEFAULTS.defaultUnitPrice);
    next.coveragePct = Number(el('coveragePct').value ?? DEFAULTS.coveragePct);
    next.pvYieldKwhPerKwMonth = Number(el('pvYield').value ?? DEFAULTS.pvYieldKwhPerKwMonth);
    next.nightPct = Number(el('nightPct').value ?? DEFAULTS.nightPct);
    next.maxPvKw = Number(el('maxPvKw').value ?? DEFAULTS.maxPvKw);
    next.taxIncluded = !!el('taxIncluded').checked;
    next.showBreakdown = !!el('showBreakdown').checked;
    next.topN = Number(el('topN').value ?? DEFAULTS.topN);

    // sanitize
    next.profitRatePct = clamp(next.profitRatePct, -50, 300);
    next.rangePct = clamp(next.rangePct, 0, 30);
    next.fixedFeeYen = clamp(next.fixedFeeYen, 0, 99999);
    next.defaultUnitPrice = clamp(next.defaultUnitPrice, 1, 200);
    next.coveragePct = clamp(next.coveragePct, 10, 120);
    next.pvYieldKwhPerKwMonth = clamp(next.pvYieldKwhPerKwMonth, 50, 140);
    next.nightPct = clamp(next.nightPct, 10, 80);
    next.maxPvKw = clamp(next.maxPvKw, 0, 50);

    return next;
  }

  function doCalc() {
    SETTINGS = getSettings(); // refresh
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

    const panelPick = choosePanelConfig({ panels: DATA.panels, pvKwTarget: pv.pvKw });

    const batRec = recommendBatteryKwh({
      usageKwhMonth,
      nightPct: SETTINGS.nightPct,
      batteries: DATA.batteries,
      useBattery
    });

    const totals = estimateTotal({
      panel: panelPick.bestPanel,
      panelCount: panelPick.panelCount,
      battery: batRec.battery,
      settings: SETTINGS
    });

    // Render top KPIs
    el('pillUsage').textContent = `使用量: ${usageKwhMonth.toFixed(0)}kWh/月（単価 ${unitPrice.toFixed(1)}円/kWh）`;
    el('pillGoal').textContent = `目標: ${pv.targetKwh.toFixed(0)}kWh/月（${SETTINGS.coveragePct}%）`;
    el('pillMode').textContent = SETTINGS.taxIncluded ? '表示: 税込概算レンジ' : '表示: 税抜概算レンジ';

    const pvKwDisp = panelPick.actualKw.toFixed(2);
    const panelW = panelPick.bestPanel.watt;
    const panelCount = panelPick.panelCount;

    let systemLine = `PV 約${pvKwDisp}kW（${panelCount}枚 × ${panelW}W）`;
    let systemSub = `推奨: ${pv.pvKw.toFixed(2)}kW（目標ベース）`;
    if (batRec.battery) {
      systemLine += ` + 蓄電池 ${batRec.battery.kwh}kWh`;
      systemSub += ` / 蓄電池目標 ${batRec.targetKwh.toFixed(1)}kWh`;
    }

    el('kpiSystem').innerHTML = systemLine;
    el('kpiSystemSub').textContent = systemSub;

    el('kpiPrice').innerHTML = `¥${formatYen(totals.min)} 〜 ¥${formatYen(totals.max)}`;
    const pr = SETTINGS.profitRatePct;
    const note = `利益率 ${pr}% / レンジ幅 ±${SETTINGS.rangePct}% / 固定費 ${formatYen(SETTINGS.fixedFeeYen)}円`;
    el('kpiPriceNote').textContent = note;

    el('reasons').innerHTML = buildReasons({
      usageKwhMonth,
      variableYen,
      unitPrice,
      fixedFeeYen: SETTINGS.fixedFeeYen,
      pv,
      panelPick,
      batRec,
      settings: SETTINGS,
      billYen
    });

    el('candidates').innerHTML = renderCandidates({ panelPick, batRec, totals, settings: SETTINGS });
    el('compare').innerHTML = renderCompare({ panelPick, batRec, settings: SETTINGS });

    setResultVisible(true);
  }

  function resetAll() {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_UNLOCK);
    SETTINGS = { ...DEFAULTS };
    saveSettings(SETTINGS);
    syncSettingsToUI();
    setResultVisible(false);
    el('billYen').value = '';
    el('unitPrice').value = '';
    el('allElectric').value = 'no';
    el('useBattery').checked = true;
  }

  // ----- Wire events -----
  async function init() {
    // Load data first
    DATA = await loadData();

    // Ensure defaults exist
    if (!localStorage.getItem(LS_KEY)) saveSettings({ ...DEFAULTS });

    SETTINGS = getSettings();
    syncSettingsToUI();

    el('btnCalc').addEventListener('click', doCalc);

    el('btnReset').addEventListener('click', () => {
      if (confirm('入力と設定をリセットしますか？')) resetAll();
    });

    el('btnPresent').addEventListener('click', () => {
      const on = !document.body.classList.contains('present');
      applyPresentationMode(on);
    });

    el('btnUnlock').addEventListener('click', () => {
      const pass = String(el('passcode').value || '');
      const ok = pass === (getSettings().passcode || DEFAULTS.passcode);
      if (!ok) {
        alert('パスコードが違います。');
        return;
      }
      setUnlocked(true);
      syncSettingsToUI();
      alert('工務店設定を表示しました。');
    });

    el('btnLock').addEventListener('click', () => {
      setUnlocked(false);
      syncSettingsToUI();
    });

    el('btnSaveSettings').addEventListener('click', () => {
      const next = readSettingsFromUI();
      saveSettings(next);
      SETTINGS = next;
      syncSettingsToUI();
      alert('設定を保存しました。');
      // Recalc if already showing results
      if (!el('result').classList.contains('hidden')) doCalc();
    });

    // Display fixed fee label
    el('fixedFeeLabel').textContent = formatYen(getSettings().fixedFeeYen);

    // Quick calc on Enter in bill field
    el('billYen').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doCalc();
    });
  }

  init();
})();
