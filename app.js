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
let currentPeriod = 'all';
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
  const now = new Date(); now.setHours(23,59,59,999);
  if (currentPeriod === 'all') return recs;
  if (currentPeriod === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return recs.filter(r => new Date(r.date+'T00:00:00') >= start);
  }
  const days = parseInt(currentPeriod, 10);
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  start.setHours(0,0,0,0);
  return recs.filter(r => new Date(r.date+'T00:00:00') >= start);
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

  const raceKeys = RACES.map(r => `R${r}`);
  renderBarChart('chart-race', 'wrap-race',
    raceKeys,
    groupROI(filtered, r => `R${r.race}`, raceKeys),
    'x'
  );

  renderBarChart('chart-day', 'wrap-day',
    DAYS,
    groupROI(filtered, r => dow(r.date), DAYS),
    'x'
  );

  renderBarChart('chart-venue', 'wrap-venue',
    VENUES,
    groupROI(filtered, r => r.venue, VENUES),
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

function parseImportDate(raw) {
  // "10/6" or "10/06" → YYYY-MM-DD
  // month 10–12 → 2025, month 1–9 → 2026
  if (!raw || !raw.includes('/')) return null;
  const [mStr, dStr] = raw.trim().split('/');
  const month = parseInt(mStr, 10);
  const day   = parseInt(dStr, 10);
  if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const year = month >= 10 ? 2025 : 2026;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function handleCSVImport(file) {
  const reader = new FileReader();
  reader.onload = e => {
    let text = e.target.result;
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip BOM

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) { showToast('有効なデータがありません', 'error'); return; }

    const parsed = [];
    for (const line of lines.slice(1)) {
      // 日付,経由,投入G,投入P,回収金額,詳細,場名,レース,メモ
      // 0    1   2    3    4      5    6   7     8
      const cols = line.split(',');
      const date = parseImportDate(cols[0]);
      if (!date) continue;

      const betG  = parseInt(cols[2]?.trim() || '0', 10) || 0;
      const betP  = parseInt(cols[3]?.trim() || '0', 10) || 0;
      const bet   = betG + betP;
      if (bet <= 0) continue;

      const venue   = cols[6]?.trim() || '不明';
      const raceRaw = parseInt(cols[7]?.trim() || '0', 10);
      const race    = (!isNaN(raceRaw) && raceRaw >= 1 && raceRaw <= 12) ? raceRaw : 0;

      const payRaw = cols[4]?.trim();
      const payout = (!payRaw || payRaw === '') ? null : parseInt(payRaw, 10);

      const memo = (cols[8]?.trim() || '');
      parsed.push({ date, venue, race, bet, payout, memo });
    }

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
  };
  reader.readAsText(file, 'UTF-8');
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
      renderSummary();
    });
  });

  document.getElementById('btn-export').addEventListener('click', exportCSV);
  document.getElementById('csv-import-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { handleCSVImport(file); e.target.value = ''; }
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
