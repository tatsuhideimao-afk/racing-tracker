'use strict';

// ── Constants ──────────────────────────────────────────
const VENUES = [
  '桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑',
  '津','三国','琵琶湖','住之江','尼崎','鳴門','丸亀','児島',
  '宮島','徳山','下関','若松','芦屋','福岡','唐津','大村'
];
const RACES = [1,2,3,4,5,6,7,8,9,10,11,12];
const DAYS  = ['日','月','火','水','木','金','土'];
const STORAGE_KEY = 'boatRecords';

// ── State ──────────────────────────────────────────────
let records       = [];
let currentPeriod = 'month';
let selectedMonth = null;
let selectedYear  = null;
let currentEditId   = null;
let currentPayoutId = null;
let charts = {};
let toastTimer = null;

// ── Storage ────────────────────────────────────────────
function loadRecords() {
  try { records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { records = []; }
}

function saveRecords() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

// ── Utils ──────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(s) {
  const [y,m,d] = s.split('-');
  return `${y}/${m}/${d}`;
}

function dow(dateStr) {
  return DAYS[new Date(dateStr + 'T00:00:00').getDay()];
}

function fmtMoney(n) {
  return '¥' + Math.abs(n).toLocaleString('ja-JP');
}

function fmtPct(n) {
  return n.toFixed(1) + '%';
}

function roiColor(roi) {
  if (roi >= 100) return '#22c55e';
  if (roi >= 80)  return '#3b82f6';
  if (roi >= 60)  return '#f97316';
  return '#ef4444';
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Filtering ──────────────────────────────────────────
function getPending()   { return records.filter(r => r.payout === null); }
function getCompleted() { return records.filter(r => r.payout !== null); }

function filterByPeriod(recs) {
  const today = todayStr();
  if (currentPeriod === 'all') return recs;
  if (currentPeriod === 'today') return recs.filter(r => r.date === today);
  if (currentPeriod === 'month') {
    const ym = today.slice(0, 7);
    return recs.filter(r => r.date.startsWith(ym));
  }
  if (currentPeriod === 'select-month' && selectedMonth) {
    return recs.filter(r => r.date.startsWith(selectedMonth));
  }
  if (currentPeriod === 'year' && selectedYear) {
    return recs.filter(r => r.date.startsWith(selectedYear));
  }
  return recs;
}

// ── KPI ────────────────────────────────────────────────
function calcKPI(recs) {
  const totalBet    = recs.reduce((s,r) => s + r.bet, 0);
  const totalPayout = recs.reduce((s,r) => s + r.payout, 0);
  const balance     = totalPayout - totalBet;
  const roi         = totalBet > 0 ? totalPayout / totalBet * 100 : null;
  const hits        = recs.filter(r => r.payout > 0).length;
  const hitRate     = recs.length > 0 ? hits / recs.length * 100 : null;
  return { totalBet, totalPayout, balance, roi, hitRate, count: recs.length };
}

// ── Chart helpers ──────────────────────────────────────
function groupROI(recs, keyFn, allKeys) {
  const g = {};
  allKeys.forEach(k => { g[k] = { bet: 0, payout: 0 }; });
  recs.forEach(r => {
    const k = keyFn(r);
    if (g[k] !== undefined) { g[k].bet += r.bet; g[k].payout += r.payout; }
  });
  return allKeys.map(k => g[k].bet > 0 ? g[k].payout / g[k].bet * 100 : null);
}

function renderBarChart(canvasId, wrapId, labels, data, indexAxis) {
  const wrap   = document.getElementById(wrapId);
  const canvas = document.getElementById(canvasId);
  if (!wrap || !canvas) return;

  // Remove any existing no-data message
  const old = wrap.querySelector('.no-data-msg');
  if (old) old.remove();

  const hasData = data.some(v => v !== null);
  if (!hasData) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    canvas.style.display = 'none';
    const msg = document.createElement('div');
    msg.className = 'no-data-msg';
    msg.textContent = 'データなし';
    wrap.appendChild(msg);
    return;
  }
  canvas.style.display = '';

  const vals   = data.map(v => v !== null ? parseFloat(v.toFixed(1)) : 0);
  const colors = vals.map((v,i) => data[i] === null ? '#e2e8f0' : roiColor(v));

  if (charts[canvasId]) { charts[canvasId].destroy(); }

  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: vals,
        backgroundColor: colors,
        borderWidth: 0,
        borderRadius: 3,
      }]
    },
    options: {
      indexAxis,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const orig = data[ctx.dataIndex];
              return orig === null ? 'データなし' : `ROI: ${ctx.raw.toFixed(1)}%`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 11 }, color: '#64748b' },
        },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: indexAxis === 'y' ? 11 : 11 }, color: '#64748b' },
          ...(indexAxis === 'x' ? { beginAtZero: true } : {})
        }
      }
    }
  });
}

// ── Badge ──────────────────────────────────────────────
function updateBadge(n) {
  const badge = document.getElementById('nav-badge');
  if (n > 0) {
    badge.textContent = n > 99 ? '99+' : n;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Tab switching ──────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${name}"]`).classList.add('active');
  if (name === 'results') renderPendingList();
  if (name === 'summary') renderSummary();
  if (name === 'history') renderHistoryList();
}

// ── Render: Pending list ────────────────────────────────
function renderPendingList() {
  const pending = getPending().sort((a,b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.race - b.race;
  });
  const container = document.getElementById('pending-list');
  const emptyEl   = document.getElementById('pending-empty');
  updateBadge(pending.length);

  if (pending.length === 0) {
    container.innerHTML = '';
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  container.innerHTML = pending.map(r => `
    <div class="record-card pending-card" data-id="${r.id}">
      <div class="record-main">
        <div class="record-meta">
          <span class="record-date">${fmtDate(r.date)}（${dow(r.date)}）</span>
          <span class="record-venue">${esc(r.venue)}</span>
          <span class="badge-race">R${r.race}</span>
        </div>
        <div class="record-amounts">
          <span class="record-bet">${fmtMoney(r.bet)}</span>
          <span class="record-status pending">結果待ち</span>
        </div>
        ${r.memo ? `<div class="record-memo">${esc(r.memo)}</div>` : ''}
      </div>
      <button class="btn-enter-result" data-id="${r.id}">入力</button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-enter-result').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openPayoutModal(btn.dataset.id); });
  });
  container.querySelectorAll('.record-card').forEach(card => {
    card.addEventListener('click', () => openPayoutModal(card.dataset.id));
  });
}

// ── Period select population ────────────────────────────
function populatePeriodSelects() {
  const completed = getCompleted();
  const months = [...new Set(completed.map(r => r.date.slice(0, 7)))].sort().reverse();
  const years  = [...new Set(completed.map(r => r.date.slice(0, 4)))].sort().reverse();

  const monthSel = document.getElementById('month-select');
  monthSel.innerHTML = months.map(m => {
    const [y, mo] = m.split('-');
    return `<option value="${m}">${y}年${parseInt(mo,10)}月</option>`;
  }).join('');
  if (!selectedMonth || !months.includes(selectedMonth)) selectedMonth = months[0] || null;
  if (selectedMonth) monthSel.value = selectedMonth;

  const yearSel = document.getElementById('year-select');
  yearSel.innerHTML = years.map(y => `<option value="${y}">${y}年</option>`).join('');
  if (!selectedYear || !years.includes(selectedYear)) selectedYear = years[0] || null;
  if (selectedYear) yearSel.value = selectedYear;
}

// ── Monthly ROI chart (year mode) ──────────────────────
function renderMonthlyChart(year) {
  const completed = getCompleted().filter(r => year && r.date.startsWith(year));
  const canvas = document.getElementById('chart-monthly');
  if (!canvas) return;

  const monthData = Array.from({length: 12}, (_, i) => {
    const m = i + 1;
    const ym = `${year}-${String(m).padStart(2,'0')}`;
    const recs = completed.filter(r => r.date.startsWith(ym));
    if (recs.length === 0) return { roi: null, balance: 0 };
    const bet    = recs.reduce((s,r) => s + r.bet,    0);
    const payout = recs.reduce((s,r) => s + r.payout, 0);
    return { roi: bet > 0 ? payout / bet * 100 : null, balance: payout - bet };
  });

  const roiVals  = monthData.map(d => d.roi !== null ? parseFloat(d.roi.toFixed(1)) : 0);
  const colors   = monthData.map(d => d.roi === null ? '#e2e8f0' : roiColor(d.roi));
  const balances = monthData.map(d => d.balance);

  const balanceLabelPlugin = {
    id: 'balanceLabels',
    afterDatasetsDraw(chart) {
      const ctx  = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      meta.data.forEach((bar, i) => {
        if (monthData[i].roi === null) return;
        const bal  = balances[i];
        const text = (bal >= 0 ? '+¥' : '-¥') + Math.abs(bal).toLocaleString('ja-JP');
        ctx.save();
        ctx.font = 'bold 9px -apple-system,sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle    = bal >= 0 ? '#22c55e' : '#ef4444';
        ctx.fillText(text, bar.x, bar.y - 2);
        ctx.restore();
      });
    }
  };

  if (charts['chart-monthly']) { charts['chart-monthly'].destroy(); }

  charts['chart-monthly'] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    plugins: [balanceLabelPlugin],
    data: {
      labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
      datasets: [
        {
          data: roiVals,
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 3,
          order: 2,
        },
        {
          type: 'line',
          data: Array(12).fill(100),
          borderColor: '#64748b',
          borderWidth: 1.5,
          borderDash: [5, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 1,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              if (ctx.datasetIndex === 1) return null;
              const d = monthData[ctx.dataIndex];
              if (d.roi === null) return 'データなし';
              const sign = d.balance >= 0 ? '+¥' : '-¥';
              return [`ROI: ${ctx.raw.toFixed(1)}%`, `収支: ${sign}${Math.abs(d.balance).toLocaleString('ja-JP')}`];
            }
          }
        }
      },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' }, beginAtZero: true }
      }
    }
  });
}

// ── Render: Summary ─────────────────────────────────────
function renderSummary() {
  const filtered = filterByPeriod(getCompleted());
  const kpi      = calcKPI(filtered);

  document.getElementById('kpi-total-bet').textContent    = fmtMoney(kpi.totalBet);
  document.getElementById('kpi-total-payout').textContent = fmtMoney(kpi.totalPayout);

  const balEl = document.getElementById('kpi-balance');
  balEl.textContent = (kpi.balance >= 0 ? '+' : '−') + fmtMoney(kpi.balance);
  balEl.style.color = kpi.balance > 0 ? '#22c55e' : kpi.balance < 0 ? '#ef4444' : '';

  document.getElementById('kpi-roi').textContent      = kpi.roi     !== null ? fmtPct(kpi.roi)     : '—';
  document.getElementById('kpi-hit-rate').textContent = kpi.hitRate !== null ? fmtPct(kpi.hitRate) : '—';

  const isYearMode = currentPeriod === 'year';
  document.getElementById('section-monthly').style.display = isYearMode ? '' : 'none';
  document.getElementById('section-race').style.display    = isYearMode ? 'none' : '';
  document.getElementById('section-day').style.display     = isYearMode ? 'none' : '';
  document.getElementById('section-venue').style.display   = isYearMode ? 'none' : '';

  if (isYearMode) {
    renderMonthlyChart(selectedYear);
    return;
  }

  // ① R0 を除外してレース番号別グラフ
  const raceFiltered = filtered.filter(r => r.race >= 1 && r.race <= 12);
  const raceKeys = RACES.map(r => `R${r}`);
  renderBarChart('chart-race', 'wrap-race',
    raceKeys,
    groupROI(raceFiltered, r => `R${r.race}`, raceKeys),
    'x'
  );

  renderBarChart('chart-day', 'wrap-day',
    DAYS,
    groupROI(filtered, r => dow(r.date), DAYS),
    'x'
  );

  // ① 「不明」を除外して場別グラフ
  const venueFiltered = filtered.filter(r => r.venue !== '不明');
  renderBarChart('chart-venue', 'wrap-venue',
    VENUES,
    groupROI(venueFiltered, r => r.venue, VENUES),
    'y'
  );
}

// ── Render: History ─────────────────────────────────────
function renderHistoryList() {
  const sorted = [...records].sort((a,b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  const container = document.getElementById('history-list');
  const emptyEl   = document.getElementById('history-empty');

  if (sorted.length === 0) {
    container.innerHTML = '';
    emptyEl.style.display = 'flex';
    return;
  }
  emptyEl.style.display = 'none';

  container.innerHTML = sorted.map(r => {
    const isPending = r.payout === null;
    const isHit     = !isPending && r.payout > 0;
    const statusCls  = isPending ? 'pending' : isHit ? 'hit' : 'miss';
    const statusTxt  = isPending ? '結果待ち' : isHit ? '的中' : 'ハズレ';
    const diff       = isPending ? null : r.payout - r.bet;
    const diffTxt    = diff !== null
      ? `<div class="record-balance ${diff >= 0 ? 'positive' : 'negative'}">${diff >= 0 ? '+' : '−'}${fmtMoney(diff)}</div>`
      : '';
    return `
      <div class="record-card" data-id="${r.id}">
        <div class="record-main">
          <div class="record-meta">
            <span class="record-date">${fmtDate(r.date)}（${dow(r.date)}）</span>
            <span class="record-venue">${esc(r.venue)}</span>
            <span class="badge-race">R${r.race}</span>
          </div>
          <div class="record-amounts">
            <span class="record-bet">${fmtMoney(r.bet)}</span>
            ${!isPending ? `<span class="record-payout">→ ${fmtMoney(r.payout)}</span>` : ''}
            <span class="record-status ${statusCls}">${statusTxt}</span>
          </div>
          ${diffTxt}
          ${r.memo ? `<div class="record-memo">${esc(r.memo)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.record-card').forEach(card => {
    card.addEventListener('click', () => openEditModal(card.dataset.id));
  });
}

// ── Payout Modal ────────────────────────────────────────
function openPayoutModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  currentPayoutId = id;
  document.getElementById('payout-info').innerHTML =
    `<span>${fmtDate(r.date)}（${dow(r.date)}）</span>` +
    `<span>${esc(r.venue)}　R${r.race}</span>` +
    `<span>掛け金：${fmtMoney(r.bet)}</span>`;
  document.getElementById('payout-input').value = '';
  document.getElementById('payout-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('payout-input').focus(), 100);
}

function closePayoutModal() {
  document.getElementById('payout-overlay').style.display = 'none';
  currentPayoutId = null;
}

function savePayoutModal() {
  if (!currentPayoutId) return;
  const raw    = document.getElementById('payout-input').value.trim();
  const payout = raw === '' ? null : parseInt(raw, 10);
  if (payout === null) { closePayoutModal(); return; }
  if (isNaN(payout) || payout < 0) { showToast('0以上の数値を入力してください', 'error'); return; }

  const idx = records.findIndex(r => r.id === currentPayoutId);
  if (idx >= 0) {
    records[idx].payout = payout;
    saveRecords();
    renderPendingList();
    showToast(payout > 0 ? `的中！ ${fmtMoney(payout)} を確定しました` : 'ハズレを確定しました');
  }
  closePayoutModal();
}

// ── Edit Modal ──────────────────────────────────────────
function openEditModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  currentEditId = id;
  document.getElementById('modal-date').value   = r.date;
  document.getElementById('modal-venue').value  = r.venue;
  document.getElementById('modal-race').value   = r.race;
  document.getElementById('modal-bet').value    = r.bet;
  document.getElementById('modal-payout').value = r.payout !== null ? r.payout : '';
  document.getElementById('modal-memo').value   = r.memo || '';
  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  currentEditId = null;
}

function saveEditModal() {
  if (!currentEditId) return;
  const date    = document.getElementById('modal-date').value;
  const venue   = document.getElementById('modal-venue').value;
  const race    = parseInt(document.getElementById('modal-race').value, 10);
  const bet     = parseInt(document.getElementById('modal-bet').value, 10);
  const payRaw  = document.getElementById('modal-payout').value.trim();
  const payout  = payRaw === '' ? null : parseInt(payRaw, 10);
  const memo    = document.getElementById('modal-memo').value.trim();

  if (!date || !venue || !race || !bet || bet <= 0) {
    showToast('必須項目を入力してください', 'error'); return;
  }
  if (payout !== null && (isNaN(payout) || payout < 0)) {
    showToast('払戻金は0以上の数値を入力してください', 'error'); return;
  }

  const idx = records.findIndex(r => r.id === currentEditId);
  if (idx >= 0) {
    records[idx] = { ...records[idx], date, venue, race, bet, payout, memo };
    saveRecords();
    renderHistoryList();
    updateBadge(getPending().length);
    showToast('変更を保存しました');
  }
  closeEditModal();
}

function deleteRecord() {
  if (!currentEditId) return;
  if (!confirm('この記録を削除しますか？')) return;
  records = records.filter(r => r.id !== currentEditId);
  saveRecords();
  renderHistoryList();
  updateBadge(getPending().length);
  showToast('削除しました');
  closeEditModal();
}

// ── Toast ───────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Register ────────────────────────────────────────────
function registerRecord() {
  const date  = document.getElementById('input-date').value;
  const venue = document.getElementById('input-venue').value;
  const race  = parseInt(document.getElementById('input-race').value, 10);
  const bet   = parseInt(document.getElementById('input-bet').value, 10);
  const memo  = document.getElementById('input-memo').value.trim();

  if (!date)          { showToast('日付を入力してください', 'error'); return; }
  if (!venue)         { showToast('場名を選択してください', 'error'); return; }
  if (!race)          { showToast('レース番号を選択してください', 'error'); return; }
  if (!bet || bet <= 0) { showToast('掛け金を入力してください', 'error'); return; }

  records.push({ id: genId(), date, venue, race, bet, payout: null, memo, createdAt: Date.now() });
  saveRecords();
  document.getElementById('input-venue').value = '';
  document.getElementById('input-race').value  = '';
  document.getElementById('input-bet').value   = '';
  document.getElementById('input-memo').value  = '';
  updateBadge(getPending().length);
  showToast('登録しました');
}

// ── CSV Export ──────────────────────────────────────────
function exportCSV() {
  if (records.length === 0) { showToast('エクスポートするデータがありません', 'error'); return; }
  const header = '日付,場名,レース番号,掛け金,払戻金,収支,ROI,メモ\n';
  const rows = [...records]
    .sort((a,b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
    .map(r => {
      const p   = r.payout !== null ? r.payout : '結果待ち';
      const bal = r.payout !== null ? r.payout - r.bet : '';
      const roi = r.payout !== null && r.bet > 0 ? (r.payout / r.bet * 100).toFixed(1) + '%' : '';
      const m   = (r.memo || '').replace(/,/g,'、').replace(/\n/g,' ');
      return [r.date, r.venue, `R${r.race}`, r.bet, p, bal, roi, m].join(',');
    }).join('\n');

  const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `boat-tracker-${todayStr()}.csv` });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSVをエクスポートしました');
}

// ── CSV Import ─────────────────────────────────────────

function parseDate(str) {
  str = str.trim();
  const m = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) return null;
  const y = parseInt(m[1]);
  const mo = parseInt(m[2]);
  const d = parseInt(m[3]);
  if (isNaN(y) || isNaN(mo) || isNaN(d)) return null;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function importCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    console.log(`[CSV Import] 読み込み行数（ヘッダー含む）: ${lines.length}`);
    if (lines.length < 2) { showToast('有効なデータがありません', 'error'); return; }

    const parsed = [];
    const skipped = [];
    let debugCount = 0;
    for (const line of lines.slice(1)) {
      // 日付,場名,レース,掛け金,払戻金,メモ
      // 0    1   2     3     4      5
      const cols = line.split(',');

      if (debugCount < 5) {
        console.log(`[CSV Debug] 行${debugCount+1}: cols=`, cols.map((c,i) => `[${i}]${c}`).join(' / '));
        debugCount++;
      }

      const date = parseDate(cols[0]);
      if (!date) { skipped.push({ line, reason: `日付パース失敗: "${cols[0]?.trim()}"` }); continue; }

      const venue   = cols[1]?.trim() || '不明';
      const raceRaw = parseInt(cols[2]?.trim() || '0', 10);
      const race    = (!isNaN(raceRaw) && raceRaw >= 1 && raceRaw <= 12) ? raceRaw : 0;

      const bet = parseInt(cols[3]?.trim() || '0', 10) || 0;
      if (bet <= 0) { skipped.push({ line, reason: `掛け金0以下: "${cols[3]?.trim()}"` }); continue; }

      const payRaw = cols[4]?.trim();
      const payout = (!payRaw || payRaw === '') ? null : parseInt(payRaw, 10);

      const memo = (cols[5]?.trim() || '');
      parsed.push({ date, venue, race, bet, payout, memo });
    }

    console.log(`[CSV Import] パース結果: 有効=${parsed.length}件 / スキップ=${skipped.length}件`);
    if (skipped.length > 0) {
      console.group('[CSV Import] スキップされた行');
      skipped.forEach(({ line, reason }) => console.log(`理由: ${reason} | 行: ${line}`));
      console.groupEnd();
    }
    console.log('[CSV Import] 先頭3件:', parsed.slice(0, 3));

    if (parsed.length === 0) { showToast('インポートできるデータがありません', 'error'); return; }

    // 重複チェック: 既存データ＋CSV内部の重複を除外
    const toAdd = [];
    for (const nr of parsed) {
      const inExisting = records.some(r =>
        r.date === nr.date && r.venue === nr.venue &&
        r.race === nr.race && r.bet  === nr.bet
      );
      const inToAdd = toAdd.some(r =>
        r.date === nr.date && r.venue === nr.venue &&
        r.race === nr.race && r.bet  === nr.bet
      );
      if (!inExisting && !inToAdd) toAdd.push(nr);
    }
    const dupeCount = parsed.length - toAdd.length;

    if (toAdd.length === 0) {
      showToast('全て重複データのためスキップしました');
      return;
    }

    const dupeNote = dupeCount > 0 ? `\n（${dupeCount}件は重複のためスキップ）` : '';
    if (!confirm(`${toAdd.length}件インポートします。既存データと統合しますか？${dupeNote}`)) return;

    const now = Date.now();
    toAdd.forEach((r, i) => {
      records.push({ id: genId(), ...r, createdAt: now + i });
    });
    saveRecords();
    renderHistoryList();
    updateBadge(getPending().length);
    showToast(`${toAdd.length}件インポートしました`);
}

// ── Populate dropdowns ──────────────────────────────────
function populateDropdowns() {
  [['input-venue'], ['modal-venue']].forEach(([id]) => {
    const el = document.getElementById(id);
    if (id === 'modal-venue') el.innerHTML = '';
    VENUES.forEach(v => {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      el.appendChild(o);
    });
  });

  [['input-race', true], ['modal-race', false]].forEach(([id, withEmpty]) => {
    const el = document.getElementById(id);
    if (!withEmpty) el.innerHTML = '';
    RACES.forEach(r => {
      const o = document.createElement('option');
      o.value = r; o.textContent = `R${r}`;
      el.appendChild(o);
    });
  });
}

// ── Init ────────────────────────────────────────────────
function init() {
  loadRecords();
  populateDropdowns();
  document.getElementById('input-date').value = todayStr();
  updateBadge(getPending().length);

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-register').addEventListener('click', registerRecord);
  document.getElementById('input-bet').addEventListener('keydown', e => { if (e.key === 'Enter') registerRecord(); });

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      document.getElementById('select-month-picker').style.display =
        currentPeriod === 'select-month' ? '' : 'none';
      document.getElementById('year-picker').style.display =
        currentPeriod === 'year' ? '' : 'none';
      if (currentPeriod === 'select-month' || currentPeriod === 'year') {
        populatePeriodSelects();
      }
      renderSummary();
    });
  });

  document.getElementById('month-select').addEventListener('change', function() {
    selectedMonth = this.value;
    renderSummary();
  });

  document.getElementById('year-select').addEventListener('change', function() {
    selectedYear = this.value;
    renderSummary();
  });

  document.getElementById('btn-export').addEventListener('click', exportCSV);

  // CSV インポート: ボタン → input.click() → change イベント → 処理
  document.getElementById('csv-import-btn').addEventListener('click', function() {
    console.log('インポートボタンクリック');
    document.getElementById('csv-file-input').click();
  });
  document.getElementById('csv-file-input').addEventListener('change', function(e) {
    console.log('ファイル選択:', e.target.files[0].name);
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(event) {
      console.log('ファイル読み込み完了');
      const text = event.target.result;
      importCSV(text);
    };
    reader.readAsText(file, 'UTF-8');
  });

  // Payout modal
  document.getElementById('payout-save').addEventListener('click', savePayoutModal);
  document.getElementById('payout-close').addEventListener('click', closePayoutModal);
  document.getElementById('payout-input').addEventListener('keydown', e => { if (e.key === 'Enter') savePayoutModal(); });
  document.getElementById('payout-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('payout-overlay')) closePayoutModal();
  });

  // Edit modal
  document.getElementById('modal-save').addEventListener('click', saveEditModal);
  document.getElementById('modal-delete').addEventListener('click', deleteRecord);
  document.getElementById('modal-close').addEventListener('click', closeEditModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeEditModal();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }
}

document.addEventListener('DOMContentLoaded', init);
