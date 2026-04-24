'use strict';

// ── Constants ─────────────────────────────────────────────
const VENUES = {
  '競馬（中央）': ['札幌','函館','福島','新潟','中山','東京','中京','京都','阪神','小倉'],
  '競馬（地方）': ['帯広','門別','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','園田','姫路','高知','佐賀'],
  '競輪': ['函館','青森','いわき平','弥彦','前橋','取手','宇都宮','大宮','西武園','京王閣','立川','松戸','千葉','川崎','平塚','小田原','伊東','静岡','浜松','豊橋','岐阜','大垣','四日市','富山','名古屋','松阪','福井','大津','奈良','向日町','和歌山','岸和田','玉野','広島','防府','高松','観音寺','小松島','高知','松山','久留米','小倉','飯塚','武雄','佐世保','熊本','別府'],
  'オートレース': ['川口','伊勢崎','浜松','山陽','飯塚'],
  '競艇': ['桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑','津','三国','琵琶湖','住之江','尼崎','鳴門','丸亀','児島','宮島','徳山','下関','若松','芦屋','福岡','唐津','大村'],
  'パチンコ・スロット': [],  // 店舗名テキスト入力
  'その他': []              // 場名・R番号なし
};
const SPORTS         = Object.keys(VENUES);
const SUMMARY_SPORTS = SPORTS.filter(s => s !== 'その他'); // 集計タブで使う競技
const RACES    = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS     = ['日','月','火','水','木','金','土'];
const MEMBERS  = ['大迫', '今伊', '今尾', '藤原'];
const BUY_TYPES = ['ノリ', '単騎'];
const GREEN    = '#3a9c2e';
const RED      = '#e24b4a';
const GREY     = '#aab2bb';
const STORAGE_KEY = 'racingTracker';
const RANK_MEDALS = ['🥇','🥈','🥉','💀'];

// ── State ──────────────────────────────────────────────────
let records       = [];
let pendingSyncs  = [];
let currentPeriod = 'month';
let currentTopTab    = 'nori';
let currentMember    = '大迫';
let noriViewMember   = '大迫';
let currentOverallSport = 'all';
let selectedPeriodValue = null;
let currentEditId   = null;
let currentPayoutId = null;
let charts = {};
let toastTimer = null;

// Sub-tab State
let currentNoriSubTab = 'koken';
let currentIndSubTab  = 'ranking';

// History filter state
let historyFilter = {
  period: 'all',   // 'all' | 'today' | 'month'
  sport:  'all',
  buyType:'all',   // 'all' | 'ノリ' | '単騎'
  result: 'all',   // 'all' | 'hit' | 'miss' | 'pending'
  member: 'all'
};

// Step Form State
let currentStep = 1;
let stepFormData = {
  buyType: 'ノリ', noriMembers: [], member: null,
  sport: null, venue: null, date: '', race: null, bet: null, memo: ''
};

// ── Storage ────────────────────────────────────────────────
function normalizeBuyType(bt) {
  if (bt === '単舞') return '単騎';
  return bt;
}

function loadStorage() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    records      = (data.records || []).map(r => ({ ...r, buyType: normalizeBuyType(r.buyType) }));
    pendingSyncs = data.pendingSyncs || [];
  } catch { records = []; pendingSyncs = []; }
}

function saveStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ records, pendingSyncs }));
}

// ── Utils ──────────────────────────────────────────────────
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function normalizeDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr);
  if (s.includes('T') || s.includes('Z')) {
    const dt = new Date(s);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  }
  return s.slice(0, 10);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const norm  = normalizeDate(dateStr);
  const parts = norm.split('-');
  if (parts.length !== 3) return String(dateStr);
  return parts[0] + '/' + parts[1] + '/' + parts[2];
}

function getDayOfWeek(dateStr) {
  if (!dateStr) return '';
  const norm = normalizeDate(dateStr);
  const [y, m, d] = norm.split('-').map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}

function getYearMonth(dateStr) {
  if (!dateStr) return '';
  return normalizeDate(dateStr).slice(0, 7);
}

const fmtDate = formatDate;
const dow = getDayOfWeek;

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return '¥' + Math.abs(n).toLocaleString('ja-JP');
}

function roiColor(roi) { return roi >= 100 ? GREEN : RED; }

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// 競技に応じた場名ラベル
function venueLabel(sport) {
  if (sport === 'パチンコ・スロット') return '店舗名';
  return '場名';
}

// レース表示用
function raceDisplay(r) {
  if (!r.sport || r.sport === 'その他') return '';
  if (r.sport === 'パチンコ・スロット') return r.race ? String(r.race) : '';
  return r.race ? `R${r.race}` : '';
}

// ── GAS Sync ───────────────────────────────────────────────
function gasUrl() { return window.CONFIG?.GAS_URL || ''; }

function setSyncSpinning(spinning) {
  document.querySelectorAll('.btn-sync').forEach(btn => {
    btn.classList.toggle('spinning', spinning);
    btn.disabled = spinning;
  });
}

async function loadFromGAS(manual = false) {
  if (!navigator.onLine || !gasUrl()) {
    if (manual) showToast('同期に失敗しました', 'error');
    return;
  }
  setSyncSpinning(true);
  updateSyncIndicator('同期中…');
  try {
    const res  = await fetch(gasUrl(), { method: 'GET', mode: 'cors', redirect: 'follow' });
    const data = await res.json();
    if (data?.status === 'success' && Array.isArray(data.records)) {
      const localById = new Map(records.map(r => [r.id, r]));
      records = data.records.map(gasRec => {
        // invest/recover → bet/payout マッピング（新スキーマ対応）
        if (gasRec.invest  != null) gasRec.bet    = gasRec.invest;
        if (gasRec.recover != null) gasRec.payout = gasRec.recover;
        // 後方互換: 単舞→単騎
        gasRec.buyType = normalizeBuyType(gasRec.buyType);
        const local = localById.get(gasRec.id);
        if (local) {
          if (!gasRec.buyType      && local.buyType)      gasRec.buyType      = local.buyType;
          if (!gasRec.member       && local.member)       gasRec.member       = local.member;
          if (!gasRec.noriMembers  && local.noriMembers)  gasRec.noriMembers  = local.noriMembers;
          if (!gasRec.predictor    && local.predictor)    gasRec.predictor    = local.predictor;
          if (!gasRec.victoryComment && local.victoryComment) gasRec.victoryComment = local.victoryComment;
        }
        if (gasRec.date) gasRec.date = normalizeDate(gasRec.date);
        return gasRec;
      });
      saveStorage();
      updateBadge(getPending().length);
      const activeTab = document.querySelector('.tab-content.active')?.id?.replace('tab-','');
      if (activeTab === 'results') renderPendingList();
      if (activeTab === 'summary') renderSummary();
      if (activeTab === 'history') renderHistoryList();
      updateSyncIndicator('');
      console.log('[GAS] 全件取得:', records.length, '件');
      if (manual) showToast('同期しました');
    } else {
      console.warn('[GAS] GET失敗:', data);
      updateSyncIndicator('');
      if (manual) showToast('同期に失敗しました', 'error');
    }
  } catch (err) {
    console.error('[GAS] GET エラー:', err);
    updateSyncIndicator('');
    if (manual) showToast('同期に失敗しました', 'error');
  } finally {
    setSyncSpinning(false);
  }
}

async function syncWithGAS() {
  if (!navigator.onLine || !gasUrl()) return;
  if (!pendingSyncs.length) return;
  updateSyncIndicator('同期中…');
  const failed = [];
  for (const item of pendingSyncs) {
    try {
      const res  = await fetch(gasUrl(), {
        method: 'POST', mode: 'cors', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(item)
      });
      const data = await res.json();
      if (data?.status !== 'success') failed.push(item);
    } catch { failed.push(item); }
  }
  pendingSyncs = failed;
  saveStorage();
  updateSyncIndicator(failed.length ? `未同期 ${failed.length}件` : '');
}

async function gasPost(action, record) {
  const url = gasUrl();
  // bet→invest / payout→recover に変換してGASへ送る
  const gasRecord = {
    ...record,
    invest:  record.bet,
    recover: record.payout
  };
  const payload = { action, record: gasRecord };

  if (!url || !navigator.onLine) {
    pendingSyncs.push({ action, record: gasRecord });
    saveStorage();
    updateSyncIndicator(`未同期 ${pendingSyncs.length}件`);
    return;
  }
  try {
    const res  = await fetch(url, {
      method: 'POST', mode: 'cors', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data?.status !== 'success') {
      pendingSyncs.push(payload);
      saveStorage();
      updateSyncIndicator(`未同期 ${pendingSyncs.length}件`);
    } else {
      updateSyncIndicator('');
    }
  } catch {
    pendingSyncs.push(payload);
    saveStorage();
    updateSyncIndicator(`未同期 ${pendingSyncs.length}件`);
  }
}

function updateSyncIndicator(text) {
  const el = document.getElementById('sync-indicator');
  if (el) el.textContent = text;
}

// ── CRUD ───────────────────────────────────────────────────
function getPending()   { return records.filter(r => r.payout === null); }
function getCompleted() { return records.filter(r => r.payout !== null); }

function addRecord(data) {
  const r = { id: genId(), ...data, createdAt: Date.now() };
  records.unshift(r);
  saveStorage();
  gasPost('add', r);
  updateBadge(getPending().length);
}

function updateRec(id, updates) {
  const i = records.findIndex(r => r.id === id);
  if (i < 0) return;
  records[i] = { ...records[i], ...updates, updatedAt: Date.now() };
  saveStorage();
  gasPost('update', records[i]);
  updateBadge(getPending().length);
}

function deleteRec(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  records = records.filter(x => x.id !== id);
  saveStorage();
  gasPost('delete', { id });
  updateBadge(getPending().length);
}

// ── Filtering ──────────────────────────────────────────────
function filterByPeriod(recs) {
  const today = todayStr();
  switch (currentPeriod) {
    case 'today':        return recs.filter(r => normalizeDate(r.date) === today);
    case 'month':        return recs.filter(r => normalizeDate(r.date).startsWith(today.slice(0,7)));
    case 'select-month': return selectedPeriodValue ? recs.filter(r => normalizeDate(r.date).startsWith(selectedPeriodValue)) : recs;
    case 'year':         return selectedPeriodValue ? recs.filter(r => normalizeDate(r.date).startsWith(selectedPeriodValue)) : recs;
    default:             return recs;
  }
}

// ノリ = buyType が 'ノリ' または未設定（旧データ互換）
function getNoriOnly(recs) { return recs.filter(r => !r.buyType || r.buyType === 'ノリ'); }

// ── Badge ──────────────────────────────────────────────────
function updateBadge(n) {
  const badge = document.getElementById('nav-badge');
  if (!badge) return;
  if (n > 0) { badge.textContent = n > 99 ? '99+' : n; badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}

// ── Tab switching ──────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`.nav-btn[data-tab="${name}"]`).classList.add('active');
  if (name === 'results') renderPendingList();
  if (name === 'summary') renderSummary();
  if (name === 'history') renderHistoryList();
}

// ── Venue / Race select helpers ────────────────────────────
function populateVenueSelect(selEl, sport, selected = '') {
  const venues = VENUES[sport] || [];
  selEl.innerHTML = `<option value="">選択してください</option>` +
    venues.map(v => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
  selEl.disabled = venues.length === 0;
}

function populateRaceSelect(selEl, selected = '') {
  selEl.innerHTML = `<option value="">選択してください</option>` +
    RACES.map(r => `<option value="${r}" ${r == selected ? 'selected' : ''}>R${r}</option>`).join('');
}

// ── Render: Period selects ──────────────────────────────────
function populatePeriodSelect() {
  const sel   = document.getElementById('period-select');
  const extra = document.getElementById('period-extra');

  if (currentPeriod === 'select-month') {
    const months = [...new Set(records.map(r => getYearMonth(r.date)).filter(Boolean))].sort().reverse();
    sel.innerHTML = months.map(m => {
      const [y, mo] = m.split('-');
      return `<option value="${m}" ${m === selectedPeriodValue ? 'selected' : ''}>${y}年${parseInt(mo)}月</option>`;
    }).join('');
    if (!selectedPeriodValue && months[0]) selectedPeriodValue = months[0];
    if (selectedPeriodValue) sel.value = selectedPeriodValue;
    extra.style.display = months.length ? '' : 'none';
  } else if (currentPeriod === 'year') {
    const years = [...new Set(records.map(r => getYearMonth(r.date)?.slice(0,4)).filter(Boolean))].sort().reverse();
    sel.innerHTML = years.map(y => `<option value="${y}" ${y === selectedPeriodValue ? 'selected' : ''}>${y}年</option>`).join('');
    if (!selectedPeriodValue && years[0]) selectedPeriodValue = years[0];
    if (selectedPeriodValue) sel.value = selectedPeriodValue;
    extra.style.display = years.length ? '' : 'none';
  } else {
    extra.style.display = 'none';
  }
}

// ── Render: Pending list ───────────────────────────────────
function renderPendingList() {
  const pending   = getPending().sort((a,b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.race||0) - (b.race||0));
  const container = document.getElementById('pending-list');
  const emptyEl   = document.getElementById('pending-empty');
  updateBadge(pending.length);

  if (pending.length === 0) { container.innerHTML = ''; emptyEl.style.display = 'flex'; return; }
  emptyEl.style.display = 'none';

  container.innerHTML = pending.map(r => {
    const rd = raceDisplay(r);
    return `
    <div class="record-card pending-card" data-id="${r.id}">
      <div class="record-main">
        <div class="record-meta">
          <span class="record-date">${formatDate(r.date)}（${getDayOfWeek(r.date)}）</span>
          <span class="record-sport">${esc(r.sport)}</span>
          ${r.venue ? `<span class="record-venue">${esc(r.venue)}</span>` : ''}
          ${rd ? `<span class="badge-race">${esc(rd)}</span>` : ''}
        </div>
        <div class="record-amounts">
          <span class="record-bet">${fmtMoney(r.bet)}</span>
          <span class="record-status pending">結果待ち</span>
        </div>
        ${r.memo ? `<div class="record-memo">${esc(r.memo)}</div>` : ''}
      </div>
      <button class="btn-enter-result" data-id="${r.id}">入力</button>
    </div>`;
  }).join('');

  container.querySelectorAll('.btn-enter-result').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openPayoutModal(btn.dataset.id); });
  });
  container.querySelectorAll('.record-card').forEach(card => {
    card.addEventListener('click', () => openPayoutModal(card.dataset.id));
  });
}

// ── KPI ────────────────────────────────────────────────────
function calcKPI(recs) {
  const totalBet    = recs.reduce((s, r) => s + (r.bet || 0), 0);
  const totalPayout = recs.reduce((s, r) => s + (r.payout || 0), 0);
  const profit      = totalPayout - totalBet;
  const roi         = totalBet > 0 ? totalPayout / totalBet * 100 : null;
  const hits        = recs.filter(r => r.payout > 0).length;
  const hitRate     = recs.length > 0 ? hits / recs.length * 100 : null;
  return { totalBet, totalPayout, profit, roi, hitRate };
}

// ── Chart helpers ──────────────────────────────────────────
function setNoData(canvasId, wrapId) {
  const wrap   = document.getElementById(wrapId);
  const canvas = document.getElementById(canvasId);
  if (!wrap || !canvas) return;
  if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
  canvas.style.display = 'none';
  if (!wrap.querySelector('.no-data-msg')) {
    const msg = document.createElement('div');
    msg.className = 'no-data-msg'; msg.textContent = 'データなし';
    wrap.appendChild(msg);
  }
}

function clearNoData(canvasId, wrapId) {
  const wrap   = document.getElementById(wrapId);
  const canvas = document.getElementById(canvasId);
  if (!wrap || !canvas) return;
  wrap.querySelectorAll('.no-data-msg').forEach(el => el.remove());
  canvas.style.display = '';
}

// horizontal bar
function renderHBar(canvasId, wrapId, labels, rois, counts, minCount) {
  if (!labels.length || !rois.some(v => v !== null)) { setNoData(canvasId, wrapId); return; }
  clearNoData(canvasId, wrapId);
  const colors = rois.map((v, i) => {
    if (v === null) return '#e2e8f0';
    if (counts && counts[i] < minCount) return GREY;
    return roiColor(v);
  });
  const vals = rois.map(v => v !== null ? parseFloat(v.toFixed(1)) : 0);

  const roiLabelPlugin = {
    id: 'roiRight',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        if (rois[i] === null) return;
        const text = vals[i].toFixed(1) + '%' + (counts && counts[i] < minCount ? ' *' : '');
        ctx.save(); ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillStyle = '#1e293b'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(text, bar.x + 4, bar.y); ctx.restore();
      });
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'bar', plugins: [roiLabelPlugin],
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 52 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => rois[ctx.dataIndex] === null ? 'データなし' : `ROI: ${ctx.raw.toFixed(1)}%` } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748b' } }
      }
    }
  });
}

// vertical bar
function renderVBar(canvasId, labels, rois, topLabels) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!labels.length || !rois.some(v => v !== null)) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    canvas.style.display = 'none';
    const wrap = canvas.parentElement;
    if (!wrap.querySelector('.no-data-msg')) {
      const msg = document.createElement('div'); msg.className = 'no-data-msg'; msg.textContent = 'データなし'; wrap.appendChild(msg);
    }
    return;
  }
  const wrap = canvas.parentElement;
  wrap.querySelectorAll('.no-data-msg').forEach(el => el.remove());
  canvas.style.display = '';

  const vals   = rois.map(v => v !== null ? parseFloat(v.toFixed(1)) : 0);
  const colors = rois.map(v => v === null ? '#e2e8f0' : roiColor(v));

  const topLabelPlugin = topLabels ? {
    id: 'topLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        if (rois[i] === null) return;
        ctx.save(); ctx.font = 'bold 9px -apple-system,sans-serif';
        ctx.fillStyle = colors[i]; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(topLabels[i], bar.x, bar.y - 2); ctx.restore();
      });
    }
  } : null;

  const baselineLine = {
    id: 'baseline100',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0);
      if (!meta.data.length) return;
      const { ctx, scales } = chart;
      const y = scales.y.getPixelForValue(100);
      ctx.save(); ctx.beginPath();
      ctx.moveTo(chart.chartArea.left, y); ctx.lineTo(chart.chartArea.right, y);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.setLineDash([5,4]); ctx.stroke(); ctx.restore();
    }
  };

  const roiTopPlugin = !topLabels ? {
    id: 'roiTop',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        if (rois[i] === null) return;
        ctx.save(); ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillStyle = '#1e293b'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(vals[i].toFixed(1) + '%', bar.x, bar.y - 2); ctx.restore();
      });
    }
  } : null;

  const plugins = [baselineLine];
  if (topLabels) plugins.push(topLabelPlugin); else plugins.push(roiTopPlugin);

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar', plugins,
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => rois[ctx.dataIndex] === null ? 'データなし' : `ROI: ${ctx.raw.toFixed(1)}%` } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' }, beginAtZero: true }
      }
    }
  });
}

// ── Summary (top-level dispatcher) ─────────────────────────
function renderSummary() {
  populatePeriodSelect();
  document.getElementById('toptab-nori').style.display       = currentTopTab === 'nori'       ? '' : 'none';
  document.getElementById('toptab-individual').style.display = currentTopTab === 'individual'  ? '' : 'none';
  document.getElementById('toptab-overall').style.display    = currentTopTab === 'overall'     ? '' : 'none';
  switch (currentTopTab) {
    case 'nori':       renderNoriTab();       break;
    case 'individual': renderIndividualTab(); break;
    case 'overall':    renderOverallTab();    break;
  }
}

// ── ① ノリタブ ────────────────────────────────────────────
function renderNoriSubTabs() {
  const bar = document.getElementById('nori-sub-tab-bar');
  if (!bar) return;
  const tabs = [{ value: 'koken', label: '貢献度' }, ...MEMBERS.map(m => ({ value: m, label: m }))];
  bar.innerHTML = tabs.map(t =>
    `<button class="sport-tab ${currentNoriSubTab === t.value ? 'active' : ''}" data-sub="${esc(t.value)}">${esc(t.label)}</button>`
  ).join('');
  bar.querySelectorAll('.sport-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentNoriSubTab = btn.dataset.sub;
      if (currentNoriSubTab !== 'koken') noriViewMember = currentNoriSubTab;
      renderNoriTab();
    });
  });
}

function calcNoriKPI(recs, viewMember) {
  let personalBet = 0, personalPayout = 0, count = 0, hits = 0;

  recs.forEach(r => {
    let members;
    try { members = r.noriMembers ? JSON.parse(r.noriMembers) : MEMBERS; }
    catch { members = MEMBERS; }
    if (!Array.isArray(members) || members.length === 0) members = MEMBERS;

    if (members.includes(viewMember)) {
      const n = members.length;
      const myBet    = (r.bet    || 0) / n;
      const myPayout = (r.payout || 0) / n;
      personalBet    += myBet;
      personalPayout += myPayout;
      count++;
      if (r.payout > 0) hits++;
      console.log(`[ノリKPI] id=${r.id} n=${n} bet=${r.bet}÷${n}=${myBet.toFixed(0)} pay=${r.payout}÷${n}=${myPayout.toFixed(0)} members=${JSON.stringify(members)}`);
    }
  });

  const profit  = personalPayout - personalBet;
  const roi     = personalBet > 0 ? personalPayout / personalBet * 100 : null;
  const hitRate = count > 0 ? hits / count * 100 : null;
  return { personalBet, personalPayout, profit, roi, count, hitRate };
}

function renderNoriTab() {
  renderNoriSubTabs();

  // buyType === 'ノリ'（または未設定の旧データ）の完了レコードのみ
  const allNori  = getNoriOnly(getCompleted());
  const noriRecs = filterByPeriod(allNori);

  console.log('[ノリ] 全ノリ完了:', allNori.length, '/ 期間後:', noriRecs.length,
    '/ period:', currentPeriod, '/ sub:', currentNoriSubTab);
  if (records.length > 0) {
    const s = records.slice(0, 3);
    console.log('[ノリ] サンプルbuyType:', s.map(r => r.buyType), '/ payout:', s.map(r => r.payout));
  }

  const isKoken = currentNoriSubTab === 'koken';
  document.getElementById('nori-panel-koken').style.display  = isKoken ? '' : 'none';
  document.getElementById('nori-panel-member').style.display = isKoken ? 'none' : '';

  if (isKoken) {
    renderPredictorRankList(noriRecs);
  } else {
    noriViewMember = currentNoriSubTab;
    const kpi = calcNoriKPI(noriRecs, noriViewMember);
    console.log('[ノリ] member:', noriViewMember, '/ 対象:', kpi.count, '/ bet:', Math.round(kpi.personalBet), '/ payout:', Math.round(kpi.personalPayout), '/ profit:', Math.round(kpi.profit));

    document.getElementById('nori-kpi-bet').textContent    = fmtMoney(Math.round(kpi.personalBet));
    document.getElementById('nori-kpi-payout').textContent = fmtMoney(Math.round(kpi.personalPayout));

    const p = Math.round(kpi.profit);
    const profitEl = document.getElementById('nori-kpi-profit');
    profitEl.textContent = p >= 0 ? '+' + fmtMoney(p) : '−' + fmtMoney(Math.abs(p));
    profitEl.className   = 'kpi-value ' + (p > 0 ? 'positive' : p < 0 ? 'negative' : '');

    const roiEl = document.getElementById('nori-kpi-roi');
    roiEl.textContent = kpi.roi != null ? kpi.roi.toFixed(1) + '%' : '—';
    roiEl.className   = 'kpi-value ' + (kpi.roi == null ? '' : kpi.roi >= 100 ? 'positive' : 'negative');

    document.getElementById('nori-kpi-count').textContent = kpi.count;
    const hrEl = document.getElementById('nori-kpi-hitrate');
    if (hrEl) hrEl.textContent = kpi.hitRate != null ? kpi.hitRate.toFixed(1) + '%' : '—';
  }
}

// 貢献度ランキング（HTML形式）
function renderPredictorRankList(noriRecs) {
  const container = document.getElementById('nori-panel-koken');
  if (!container) return;

  const stats = {};
  MEMBERS.forEach(m => { stats[m] = { bet: 0, payout: 0, total: 0, wins: 0 }; });

  noriRecs.filter(r => r.predictor && stats[r.predictor]).forEach(r => {
    stats[r.predictor].bet    += r.bet    || 0;
    stats[r.predictor].payout += r.payout || 0;
    stats[r.predictor].total++;
    if (r.payout > 0) stats[r.predictor].wins++;
  });

  const entries = MEMBERS.map(m => ({
    member: m,
    wins:   stats[m].wins,
    total:  stats[m].total,
    payout: stats[m].payout,
    bet:    stats[m].bet
  })).filter(e => e.total > 0)
    .sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : b.payout - a.payout);

  // 古いチャートがあれば破棄
  if (charts['chart-predictor']) { charts['chart-predictor'].destroy(); charts['chart-predictor'] = null; }

  if (entries.length === 0) {
    container.innerHTML = `<div class="chart-section"><div class="chart-title">予想者貢献度ランキング</div><div class="no-data-msg" style="height:100px;display:flex;align-items:center;justify-content:center;font-size:13px;color:#94a3b8">データなし</div></div>`;
    return;
  }

  const rows = entries.map((e, i) => {
    const medal = RANK_MEDALS[i] || `${i+1}位`;
    const profitColor = (e.payout - e.bet) >= 0 ? 'positive' : 'negative';
    const profitSign  = (e.payout - e.bet) >= 0 ? '+' : '−';
    return `
    <div class="rank-item">
      <div class="rank-medal">${medal}</div>
      <div class="rank-content">
        <div class="rank-name">${esc(e.member)}</div>
        <div class="rank-stats">
          <span>${e.wins}勝 / ${e.total}件</span>
          <span>回収 ${fmtMoney(e.payout)}</span>
          <span class="${profitColor}">${profitSign}${fmtMoney(Math.abs(e.payout - e.bet))}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">予想者貢献度ランキング（勝数順）</div>
      <div class="rank-list">${rows}</div>
    </div>`;
}

// ── ② 個人タブ ────────────────────────────────────────────
function renderIndSubTabs() {
  const bar = document.getElementById('ind-sub-tab-bar');
  if (!bar) return;
  const tabs = [{ value: 'ranking', label: 'ランキング' }, ...MEMBERS.map(m => ({ value: m, label: m }))];
  bar.innerHTML = tabs.map(t =>
    `<button class="sport-tab ${currentIndSubTab === t.value ? 'active' : ''}" data-sub="${esc(t.value)}">${esc(t.label)}</button>`
  ).join('');
  bar.querySelectorAll('.sport-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentIndSubTab = btn.dataset.sub;
      if (currentIndSubTab !== 'ranking') currentMember = currentIndSubTab;
      renderIndividualTab();
    });
  });
}

function renderIndividualTab() {
  renderIndSubTabs();

  const isRanking = currentIndSubTab === 'ranking';
  document.getElementById('ind-panel-ranking').style.display = isRanking ? '' : 'none';
  document.getElementById('ind-panel-member').style.display  = isRanking ? 'none' : '';

  if (isRanking) {
    const periodRecs = filterByPeriod(records);
    const tanki = periodRecs.filter(r => r.buyType === '単騎');
    console.log('[個人ランキング] 期間後全:', periodRecs.length, '/ 単騎:', tanki.length);
    renderMemberRankList();
  } else {
    currentMember = currentIndSubTab;

    const allTanki   = records.filter(r => r.buyType === '単騎');
    console.log('[個人] 総単騎:', allTanki.length);

    const memberRecs = records.filter(r => r.buyType === '単騎' && r.member === currentMember);
    const periodRecs = filterByPeriod(memberRecs);
    const completed  = periodRecs.filter(r => r.payout !== null);
    console.log('[個人] member=' + currentMember + ' 全期間:', memberRecs.length,
      '/ 期間後:', periodRecs.length, '/ 確定:', completed.length, '/ period:', currentPeriod);

    const kpi = calcKPI(completed);
    console.log('[個人] KPI:', { bet: kpi.totalBet, payout: kpi.totalPayout, roi: kpi.roi });

    document.getElementById('ind-kpi-bet').textContent    = fmtMoney(kpi.totalBet);
    document.getElementById('ind-kpi-payout').textContent = fmtMoney(kpi.totalPayout);

    const profitEl = document.getElementById('ind-kpi-profit');
    profitEl.textContent = kpi.profit >= 0 ? '+' + fmtMoney(kpi.profit) : '−' + fmtMoney(Math.abs(kpi.profit));
    profitEl.className   = 'kpi-value ' + (kpi.profit > 0 ? 'positive' : kpi.profit < 0 ? 'negative' : '');

    const roiEl = document.getElementById('ind-kpi-roi');
    roiEl.textContent = kpi.roi != null ? kpi.roi.toFixed(1) + '%' : '—';
    roiEl.className   = 'kpi-value ' + (kpi.roi == null ? '' : kpi.roi >= 100 ? 'positive' : 'negative');

    document.getElementById('ind-kpi-hitrate').textContent = kpi.hitRate != null ? kpi.hitRate.toFixed(1) + '%' : '—';

    const isImai = currentMember === '今伊';
    document.getElementById('section-ind-sport').style.display = isImai ? 'none' : '';
    document.getElementById('section-ind-venue').style.display = isImai ? '' : 'none';

    if (isImai) {
      renderIndividualVenueChart(completed, 'chart-ind-venue', 'wrap-ind-venue');
    } else {
      renderIndividualSportChart(completed, 'chart-ind-sport', 'wrap-ind-sport');
    }
  }
}

// 個人収支ランキング（HTML形式）
function renderMemberRankList() {
  const container = document.getElementById('ind-panel-ranking');
  if (!container) return;

  const periodRecs = filterByPeriod(records);

  const entries = MEMBERS.map(m => {
    const recs   = periodRecs.filter(r => r.buyType === '単騎' && r.member === m && r.payout !== null);
    const invest = recs.reduce((s, r) => s + (r.bet    || 0), 0);
    const recover= recs.reduce((s, r) => s + (r.payout || 0), 0);
    const profit = recover - invest;
    return { member: m, invest, recover, profit, count: recs.length };
  }).sort((a, b) => b.profit - a.profit);  // 収支金額高い順

  // 古いチャートがあれば破棄
  if (charts['chart-member-rank']) { charts['chart-member-rank'].destroy(); charts['chart-member-rank'] = null; }

  const rows = entries.map((e, i) => {
    const medal     = RANK_MEDALS[i] || `${i+1}位`;
    const profitCls = e.profit >= 0 ? 'positive' : 'negative';
    const profitStr = (e.profit >= 0 ? '+' : '−') + fmtMoney(Math.abs(e.profit));
    return `
    <div class="rank-item">
      <div class="rank-medal">${medal}</div>
      <div class="rank-content">
        <div class="rank-name">${esc(e.member)} <span class="rank-count">${e.count}件</span></div>
        <div class="rank-stats">
          <span class="rank-stat ${profitCls}">収支 ${profitStr}</span>
          <span>投入 ${fmtMoney(e.invest)}</span>
          <span>回収 ${fmtMoney(e.recover)}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="chart-section">
      <div class="chart-title">4人収支ランキング（収支金額順）</div>
      <div class="rank-list">${rows}</div>
    </div>`;
}

// ── ③ 全体タブ ────────────────────────────────────────────
function renderOverallSportTabs() {
  const bar  = document.getElementById('overall-sport-tab-bar');
  // その他は集計タブから除外
  const tabs = [{ value: 'all', label: '全' }, ...SUMMARY_SPORTS.map(s => ({ value: s, label: s }))];
  bar.innerHTML = tabs.map(t =>
    `<button class="sport-tab ${currentOverallSport === t.value ? 'active' : ''}" data-sport="${esc(t.value)}">${esc(t.label)}</button>`
  ).join('');
  bar.querySelectorAll('.sport-tab').forEach(btn => {
    btn.addEventListener('click', () => { currentOverallSport = btn.dataset.sport; renderOverallTab(); });
  });
}

function updateOvrKPI(kpi) {
  document.getElementById('ovr-kpi-bet').textContent    = fmtMoney(kpi.totalBet);
  document.getElementById('ovr-kpi-payout').textContent = fmtMoney(kpi.totalPayout);
  const profitEl = document.getElementById('ovr-kpi-profit');
  profitEl.textContent = kpi.profit >= 0 ? '+' + fmtMoney(kpi.profit) : '−' + fmtMoney(Math.abs(kpi.profit));
  profitEl.className   = 'kpi-value ' + (kpi.profit > 0 ? 'positive' : kpi.profit < 0 ? 'negative' : '');
  const roiEl = document.getElementById('ovr-kpi-roi');
  roiEl.textContent = kpi.roi != null ? kpi.roi.toFixed(1) + '%' : '—';
  roiEl.className   = 'kpi-value ' + (kpi.roi == null ? '' : kpi.roi >= 100 ? 'positive' : 'negative');
  document.getElementById('ovr-kpi-hitrate').textContent = kpi.hitRate != null ? kpi.hitRate.toFixed(1) + '%' : '—';
}

function renderOverallTab() {
  renderOverallSportTabs();

  const isAll   = currentOverallSport === 'all';
  const isYear  = currentPeriod === 'year';
  const baseRecs = getNoriOnly(getCompleted());
  const filtered = isAll
    ? filterByPeriod(baseRecs)
    : filterByPeriod(baseRecs.filter(r => r.sport === currentOverallSport));

  updateOvrKPI(calcKPI(filtered));

  document.getElementById('section-ovr-all').style.display    = isAll && !isYear ? '' : 'none';
  document.getElementById('section-ovr-yearly').style.display = isAll && isYear  ? '' : 'none';
  document.getElementById('section-ovr-sport').style.display  = !isAll           ? '' : 'none';

  // パチンコ・スロットはレース番号・曜日チャートを非表示
  const isPachi = currentOverallSport === 'パチンコ・スロット';
  const raceSection = document.getElementById('section-ovr-race');
  const daySection  = document.getElementById('section-ovr-day');
  if (raceSection) raceSection.style.display = isPachi ? 'none' : '';
  if (daySection)  daySection.style.display  = isPachi ? 'none' : '';

  if (isAll && isYear) {
    renderMonthlyChart(filtered, selectedPeriodValue);
  } else if (isAll) {
    renderSportROIChart(filtered);
    renderMonthlyTrendChart(filtered);
    renderMovingAvgChart();
  } else {
    renderOvrVenueChart(filtered);
    if (!isPachi) {
      renderOvrRaceChart(filtered);
      renderOvrDayChart(filtered);
    }
  }
}

function renderOvrVenueChart(filtered) {
  const canvasId = 'chart-ovr-venue', wrapId = 'wrap-ovr-venue';
  const venueStats = {};
  filtered.forEach(r => {
    const key = r.venue || '(未設定)';
    if (!venueStats[key]) venueStats[key] = { bet: 0, payout: 0, count: 0 };
    venueStats[key].bet    += r.bet    || 0;
    venueStats[key].payout += r.payout || 0;
    venueStats[key].count++;
  });
  const entries = Object.entries(venueStats).filter(([, s]) => s.bet > 0)
    .map(([venue, s]) => ({ venue, roi: s.payout / s.bet * 100, count: s.count }))
    .sort((a, b) => b.roi - a.roi);
  const wrapEl = document.getElementById(wrapId);
  if (wrapEl) wrapEl.style.height = Math.max(120, entries.length * 32) + 'px';
  renderHBar(canvasId, wrapId, entries.map(e => e.venue), entries.map(e => e.roi), entries.map(e => e.count), 3);
}

function renderOvrRaceChart(filtered) {
  const raceStats = {};
  RACES.forEach(r => { raceStats[`R${r}`] = { bet: 0, payout: 0 }; });
  filtered.filter(r => r.race >= 1 && r.race <= 12).forEach(r => {
    raceStats[`R${r.race}`].bet    += r.bet    || 0;
    raceStats[`R${r.race}`].payout += r.payout || 0;
  });
  const raceKeys = RACES.map(r => `R${r}`);
  const raceRois = raceKeys.map(k => raceStats[k].bet > 0 ? raceStats[k].payout / raceStats[k].bet * 100 : null);
  renderHBar('chart-ovr-race', 'wrap-ovr-race', raceKeys, raceRois, null, 0);
}

function renderOvrDayChart(filtered) {
  const dayStats = DAYS.map((_, i) => {
    const recs = filtered.filter(r => {
      if (!r.date) return false;
      const s = String(r.date).split('T')[0];
      const [ry, rm, rd] = s.split('-').map(Number);
      return new Date(ry, rm - 1, rd).getDay() === i;
    });
    const bet = recs.reduce((s, r) => s + (r.bet    || 0), 0);
    const pay = recs.reduce((s, r) => s + (r.payout || 0), 0);
    return { roi: bet > 0 ? pay / bet * 100 : null };
  });
  renderVBar('chart-ovr-day', DAYS, dayStats.map(d => d.roi), null);
}

// ── 競技別ROI比較（全体タブ） ─────────────────────────────
function renderSportROIChart(filtered) {
  const canvasId = 'chart-sport-roi', wrapId = 'wrap-sport-roi';
  const sportData = SUMMARY_SPORTS.map(sport => {
    const recs   = filtered.filter(r => r.sport === sport);
    const bet    = recs.reduce((s, r) => s + (r.bet    || 0), 0);
    const payout = recs.reduce((s, r) => s + (r.payout || 0), 0);
    return { sport, bet, payout, roi: bet > 0 ? payout / bet * 100 : null, profit: payout - bet };
  }).filter(d => d.bet > 0);

  if (!sportData.length) { setNoData(canvasId, wrapId); return; }
  clearNoData(canvasId, wrapId);

  const labels = sportData.map(d => d.sport);
  const vals   = sportData.map(d => parseFloat(d.roi.toFixed(1)));
  const colors = sportData.map(d => roiColor(d.roi));

  const labelPlugin = {
    id: 'sportRoiLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const d = sportData[i];
        const roi    = vals[i].toFixed(1) + '%';
        const profit = (d.profit >= 0 ? '+¥' : '-¥') + Math.abs(d.profit).toLocaleString('ja-JP');
        ctx.save(); ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillStyle = '#1e293b'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(`${roi}  ${profit}`, bar.x + 5, bar.y); ctx.restore();
      });
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'bar', plugins: [labelPlugin],
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 140 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `ROI: ${ctx.raw.toFixed(1)}%` } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748b' } }
      }
    }
  });
}

// ── 個人別 競技別収支横棒グラフ ────────────────────────────
function renderIndividualSportChart(filtered, canvasId = 'chart-ind-sport', wrapId = 'wrap-ind-sport') {
  const sportData = SUMMARY_SPORTS.map(sport => {
    const recs   = filtered.filter(r => r.sport === sport);
    const bet    = recs.reduce((s, r) => s + (r.bet    || 0), 0);
    const payout = recs.reduce((s, r) => s + (r.payout || 0), 0);
    return { sport, profit: payout - bet, bet };
  }).filter(d => d.bet > 0);

  if (!sportData.length) { setNoData(canvasId, wrapId); return; }
  clearNoData(canvasId, wrapId);

  const labels = sportData.map(d => d.sport);
  const vals   = sportData.map(d => d.profit);
  const colors = vals.map(v => v >= 0 ? GREEN : RED);

  const labelPlugin = {
    id: 'indivSportLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const p    = vals[i];
        const text = (p >= 0 ? '+¥' : '-¥') + Math.abs(p).toLocaleString('ja-JP');
        ctx.save(); ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillStyle = '#1e293b'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(text, bar.x + 5, bar.y); ctx.restore();
      });
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'bar', plugins: [labelPlugin],
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 130 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => { const p = vals[ctx.dataIndex]; return `収支: ${p >= 0 ? '+¥' : '-¥'}${Math.abs(p).toLocaleString('ja-JP')}`; } } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748b' } }
      }
    }
  });
}

// ── 今伊個人別 / 場別ROI横棒グラフ ────────────────────────
function renderIndividualVenueChart(filtered, canvasId = 'chart-ind-venue', wrapId = 'wrap-ind-venue') {
  const venueStats = {};
  filtered.forEach(r => {
    const key = r.venue || '(未設定)';
    if (!venueStats[key]) venueStats[key] = { bet: 0, payout: 0, count: 0 };
    venueStats[key].bet    += r.bet    || 0;
    venueStats[key].payout += r.payout || 0;
    venueStats[key].count++;
  });
  const entries = Object.entries(venueStats).filter(([, s]) => s.bet > 0)
    .map(([venue, s]) => ({ venue, roi: s.payout / s.bet * 100, count: s.count }))
    .sort((a, b) => b.roi - a.roi);
  const wrapEl = document.getElementById(wrapId);
  if (wrapEl) wrapEl.style.height = Math.max(120, entries.length * 32) + 'px';
  renderHBar(canvasId, wrapId, entries.map(e => e.venue), entries.map(e => e.roi), entries.map(e => e.count), 3);
}

// ── 月別収支推移（全体タブ） ─────────────────────────────
function renderMonthlyTrendChart(filtered) {
  const canvasId = 'chart-monthly-trend', wrapId = 'wrap-monthly-trend';
  const monthMap = {};
  filtered.forEach(r => {
    const ym = getYearMonth(r.date); if (!ym) return;
    if (!monthMap[ym]) monthMap[ym] = { bet: 0, payout: 0 };
    monthMap[ym].bet    += r.bet    || 0;
    monthMap[ym].payout += r.payout || 0;
  });
  const months = Object.keys(monthMap).sort();
  if (!months.length) { setNoData(canvasId, wrapId); return; }
  clearNoData(canvasId, wrapId);

  const profits = months.map(m => monthMap[m].payout - monthMap[m].bet);
  const rois    = months.map(m => monthMap[m].bet > 0 ? monthMap[m].payout / monthMap[m].bet * 100 : 0);
  const colors  = profits.map(p => p >= 0 ? GREEN : RED);
  const labels  = months.map(m => { const [y, mo] = m.split('-'); return `${y.slice(2)}/${parseInt(mo)}`; });

  const profitLabelPlugin = {
    id: 'monthlyTrendLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        const p = profits[i];
        const text = (p >= 0 ? '+¥' : '-¥') + Math.abs(p).toLocaleString('ja-JP');
        ctx.save(); ctx.font = 'bold 9px -apple-system,sans-serif';
        ctx.fillStyle = colors[i]; ctx.textAlign = 'center';
        ctx.textBaseline = p >= 0 ? 'bottom' : 'top';
        ctx.fillText(text, bar.x, p >= 0 ? bar.y - 2 : bar.y + bar.height + 2); ctx.restore();
      });
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'bar', plugins: [profitLabelPlugin],
    data: { labels, datasets: [{ data: rois, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 22, bottom: 22 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => { const p = profits[ctx.dataIndex]; return [`ROI: ${ctx.raw.toFixed(1)}%`, `収支: ${p >= 0 ? '+¥' : '-¥'}${Math.abs(p).toLocaleString('ja-JP')}`]; } } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' }, beginAtZero: true }
      }
    }
  });
}

// ── 回収率移動平均（全体タブ・直近30件） ──────────────────
function renderMovingAvgChart() {
  const canvasId = 'chart-moving-avg';
  const canvas   = document.getElementById(canvasId);
  if (!canvas) return;

  const completed = [...getNoriOnly(getCompleted())]
    .sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt - b.createdAt)
    .slice(-30);

  if (!completed.length) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    canvas.style.display = 'none';
    const wrap = canvas.parentElement;
    if (!wrap.querySelector('.no-data-msg')) {
      const msg = document.createElement('div'); msg.className = 'no-data-msg'; msg.textContent = 'データなし'; wrap.appendChild(msg);
    }
    return;
  }
  canvas.parentElement?.querySelectorAll('.no-data-msg').forEach(el => el.remove());
  canvas.style.display = '';

  const rois   = completed.map(r => r.bet > 0 ? parseFloat((r.payout / r.bet * 100).toFixed(1)) : 0);
  const labels = completed.map(r => {
    const s = String(r.date || '').split('T')[0]; const parts = s.split('-');
    return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : '';
  });

  const baselinePlugin = {
    id: 'movingAvgBaseline',
    afterDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      const y = scales.y.getPixelForValue(100);
      if (y < chartArea.top || y > chartArea.bottom) return;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.restore();
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line', plugins: [baselinePlugin],
    data: { labels, datasets: [{ data: rois, borderColor: '#0ea5c8', backgroundColor: 'rgba(14,165,200,0.08)', borderWidth: 2, pointRadius: completed.length <= 15 ? 4 : 2, pointBackgroundColor: '#0ea5c8', tension: 0.3, fill: true }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `ROI: ${ctx.raw.toFixed(1)}%` } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, color: '#64748b', maxRotation: 45 } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' }, beginAtZero: true }
      }
    }
  });
}

// ── Monthly chart（年度別） ─────────────────────────────
function renderMonthlyChart(recs, year) {
  const canvas = document.getElementById('chart-monthly');
  if (!canvas) return;

  const monthData = Array.from({ length: 12 }, (_, i) => {
    const ym  = `${year}-${String(i+1).padStart(2,'0')}`;
    const mrs = recs.filter(r => getYearMonth(r.date)?.startsWith(ym));
    const bet  = mrs.reduce((s, r) => s + (r.bet    || 0), 0);
    const pay  = mrs.reduce((s, r) => s + (r.payout || 0), 0);
    return { roi: bet > 0 ? pay / bet * 100 : null, profit: pay - bet };
  });

  const labels  = Array.from({ length: 12 }, (_, i) => `${i+1}月`);
  const vals    = monthData.map(d => d.roi !== null ? parseFloat(d.roi.toFixed(1)) : 0);
  const colors  = monthData.map(d => d.roi === null ? '#e2e8f0' : roiColor(d.roi));
  const profits = monthData.map(d => d.profit);

  const profitLabelPlugin = {
    id: 'profitLabel',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        if (monthData[i].roi === null) return;
        const bal  = profits[i];
        const text = (bal >= 0 ? '+¥' : '-¥') + Math.abs(bal).toLocaleString('ja-JP');
        ctx.save(); ctx.font = 'bold 9px -apple-system,sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = bal >= 0 ? GREEN : RED;
        ctx.fillText(text, bar.x, bar.y - 2); ctx.restore();
      });
    }
  };

  const baselinePlugin = {
    id: 'baseline',
    afterDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      const y = scales.y.getPixelForValue(100);
      if (y < chartArea.top || y > chartArea.bottom) return;
      ctx.save(); ctx.beginPath();
      ctx.moveTo(chartArea.left, y); ctx.lineTo(chartArea.right, y);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.stroke(); ctx.restore();
    }
  };

  canvas.style.display = '';
  canvas.parentElement?.querySelectorAll('.no-data-msg').forEach(el => el.remove());

  if (charts['chart-monthly']) charts['chart-monthly'].destroy();
  charts['chart-monthly'] = new Chart(canvas.getContext('2d'), {
    type: 'bar', plugins: [profitLabelPlugin, baselinePlugin],
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => { const d = monthData[ctx.dataIndex]; if (d.roi === null) return 'データなし'; const sign = d.profit >= 0 ? '+¥' : '-¥'; return [`ROI: ${ctx.raw.toFixed(1)}%`, `収支: ${sign}${Math.abs(d.profit).toLocaleString('ja-JP')}`]; } } } },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' }, beginAtZero: true }
      }
    }
  });
}

// ── Render: History ─────────────────────────────────────────
function renderHistoryFilters() {
  const bar = document.getElementById('history-filter-bar');
  if (!bar) return;

  const today    = todayStr();
  const thisMonth = today.slice(0, 7);

  // 期間チップ
  const periodChips = [
    { key: 'period', val: 'all',   label: '全期間' },
    { key: 'period', val: 'today', label: '今日' },
    { key: 'period', val: 'month', label: '今月' }
  ];
  // 競技チップ
  const sportChips = [
    { key: 'sport', val: 'all', label: '全競技' },
    ...SPORTS.map(s => ({ key: 'sport', val: s, label: s }))
  ];
  // ノリ/単騎チップ
  const buyTypeChips = [
    { key: 'buyType', val: 'all',  label: '全て' },
    { key: 'buyType', val: 'ノリ', label: 'ノリ' },
    { key: 'buyType', val: '単騎', label: '単騎' }
  ];
  // 的中/ハズレチップ
  const resultChips = [
    { key: 'result', val: 'all',     label: '全結果' },
    { key: 'result', val: 'hit',     label: '的中' },
    { key: 'result', val: 'miss',    label: 'ハズレ' },
    { key: 'result', val: 'pending', label: '結果待ち' }
  ];
  // メンバーチップ
  const memberChips = [
    { key: 'member', val: 'all', label: '全員' },
    ...MEMBERS.map(m => ({ key: 'member', val: m, label: m }))
  ];

  const allChips = [...periodChips, ...buyTypeChips, ...resultChips, ...memberChips, ...sportChips];

  bar.innerHTML = allChips.map(c => {
    const active = historyFilter[c.key] === c.val;
    return `<button class="history-chip ${active ? 'active' : ''}" data-key="${esc(c.key)}" data-val="${esc(c.val)}">${esc(c.label)}</button>`;
  }).join('');

  bar.querySelectorAll('.history-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      historyFilter[btn.dataset.key] = btn.dataset.val;
      renderHistoryList();
    });
  });
}

function applyHistoryFilter(recs) {
  const today    = todayStr();
  const thisMonth = today.slice(0, 7);
  return recs.filter(r => {
    // 期間
    if (historyFilter.period === 'today' && normalizeDate(r.date) !== today) return false;
    if (historyFilter.period === 'month' && !normalizeDate(r.date).startsWith(thisMonth)) return false;
    // 競技
    if (historyFilter.sport !== 'all' && r.sport !== historyFilter.sport) return false;
    // ノリ/単騎
    if (historyFilter.buyType !== 'all') {
      const bt = normalizeBuyType(r.buyType) || 'ノリ';
      if (bt !== historyFilter.buyType) return false;
    }
    // 的中/ハズレ
    if (historyFilter.result !== 'all') {
      if (historyFilter.result === 'pending' && r.payout !== null) return false;
      if (historyFilter.result === 'hit'     && !(r.payout !== null && r.payout > 0)) return false;
      if (historyFilter.result === 'miss'    && !(r.payout !== null && r.payout === 0)) return false;
    }
    // メンバー
    if (historyFilter.member !== 'all') {
      const bt = normalizeBuyType(r.buyType) || 'ノリ';
      if (bt === '単騎') {
        if (r.member !== historyFilter.member) return false;
      } else {
        // ノリ: noriMembersに含まれるかチェック
        let members;
        try { members = r.noriMembers ? JSON.parse(r.noriMembers) : MEMBERS; }
        catch { members = MEMBERS; }
        if (!members.includes(historyFilter.member)) return false;
      }
    }
    return true;
  });
}

function renderHistoryList() {
  renderHistoryFilters();

  const sorted = [...records].sort((a, b) =>
    a.date !== b.date ? (a.date > b.date ? -1 : 1) : (b.createdAt || 0) - (a.createdAt || 0)
  );
  const filtered   = applyHistoryFilter(sorted);
  const container  = document.getElementById('history-list');
  const emptyEl    = document.getElementById('history-empty');

  if (filtered.length === 0) {
    container.innerHTML = ''; emptyEl.style.display = 'flex'; return;
  }
  emptyEl.style.display = 'none';

  container.innerHTML = filtered.map(r => {
    const isPending = r.payout === null;
    const isHit     = !isPending && r.payout > 0;
    const diff      = isPending ? null : r.payout - r.bet;
    const statusCls = isPending ? 'pending' : isHit ? 'hit' : 'miss';
    const statusTxt = isPending ? '結果待ち' : isHit ? '的中' : 'ハズレ';
    const diffHtml  = diff !== null
      ? `<div class="record-balance ${diff >= 0 ? 'positive' : 'negative'}">${diff >= 0 ? '+' : '−'}${fmtMoney(Math.abs(diff))}</div>`
      : '';
    const bt = normalizeBuyType(r.buyType) || 'ノリ';
    const buyLabel = bt === '単騎'
      ? `<span class="record-sport" style="color:#7c3aed">単騎(${esc(r.member || '')})</span>`
      : '';
    const rd = raceDisplay(r);
    // 勝利コメント表示ロジック: 的中かつコメントあり→コメント、それ以外→メモ
    const displayNote = isHit && r.victoryComment
      ? `<div class="record-memo record-victory">🎉 ${esc(r.victoryComment)}</div>`
      : (r.memo ? `<div class="record-memo">${esc(r.memo)}</div>` : '');

    return `
    <div class="record-card" data-id="${r.id}">
      <div class="record-main">
        <div class="record-meta">
          <span class="record-date">${formatDate(r.date)}（${getDayOfWeek(r.date)}）</span>
          <span class="record-sport">${esc(r.sport)}</span>
          ${r.venue ? `<span class="record-venue">${esc(r.venue)}</span>` : ''}
          ${rd ? `<span class="badge-race">${esc(rd)}</span>` : ''}
          ${buyLabel}
        </div>
        <div class="record-amounts">
          <span class="record-bet">${fmtMoney(r.bet)}</span>
          ${!isPending ? `<span class="record-payout">→ ${fmtMoney(r.payout)}</span>` : ''}
          <span class="record-status ${statusCls}">${statusTxt}</span>
        </div>
        ${diffHtml}
        ${displayNote}
      </div>
    </div>`;
  }).join('');

  container.querySelectorAll('.record-card').forEach(card => {
    card.addEventListener('click', () => openEditModal(card.dataset.id));
  });
}

// ── Payout Modal ────────────────────────────────────────────
function openPayoutModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  currentPayoutId = id;
  const rd = raceDisplay(r);
  document.getElementById('payout-info').innerHTML =
    `<span>${esc(r.sport)}</span><span>${formatDate(r.date)}（${getDayOfWeek(r.date)}）</span>` +
    `<span>${r.venue ? esc(r.venue) : ''}${rd ? '　' + esc(rd) : ''}</span>` +
    `<span>掛け金：${fmtMoney(r.bet)}</span>`;
  document.getElementById('payout-input').value = '';
  document.getElementById('predictor-row').style.display      = 'none';
  document.getElementById('victory-comment-row').style.display = 'none';
  document.getElementById('predictor-select').value = r.predictor || '';
  document.getElementById('victory-comment-input').value = '';
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

  const r = records.find(x => x.id === currentPayoutId);
  const isNori = r && (!r.buyType || r.buyType === 'ノリ');
  const predictor      = (isNori && payout > 0) ? (document.getElementById('predictor-select').value || null) : null;
  const victoryComment = payout > 0 ? (document.getElementById('victory-comment-input').value.trim() || null) : null;

  const updates = { payout };
  if (predictor      !== null) updates.predictor      = predictor;
  if (victoryComment !== null) updates.victoryComment  = victoryComment;
  else                         updates.victoryComment  = null;

  updateRec(currentPayoutId, updates);
  showToast(payout > 0 ? `的中！ ${fmtMoney(payout)} を確定しました` : 'ハズレを確定しました');
  renderPendingList();
  closePayoutModal();
}

// ── Edit Modal ───────────────────────────────────────────────
function openEditModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  currentEditId = id;

  const buyTypeSel = document.getElementById('modal-buytype');
  buyTypeSel.value = normalizeBuyType(r.buyType) || 'ノリ';
  const memberRow  = document.getElementById('modal-member-row');
  memberRow.style.display = buyTypeSel.value === '単騎' ? '' : 'none';
  document.getElementById('modal-member').value = r.member || '';
  buyTypeSel.onchange = () => {
    memberRow.style.display = buyTypeSel.value === '単騎' ? '' : 'none';
  };

  // 競技セレクト
  const sportSel = document.getElementById('modal-sport');
  sportSel.innerHTML = SPORTS.map(s =>
    `<option value="${esc(s)}" ${s === r.sport ? 'selected' : ''}>${esc(s)}</option>`
  ).join('');

  // 場名: パチンコ・スロット / その他 はテキスト入力
  updateEditModalVenueRace(r.sport, r.venue, r.race);
  sportSel.onchange = () => updateEditModalVenueRace(sportSel.value, '', '');

  document.getElementById('modal-date').value   = r.date || '';
  document.getElementById('modal-bet').value    = r.bet  || '';
  document.getElementById('modal-payout').value = r.payout !== null ? r.payout : '';
  document.getElementById('modal-memo').value   = r.memo || '';
  document.getElementById('modal-victory-comment').value = r.victoryComment || '';
  document.getElementById('modal-overlay').style.display = 'flex';
}

function updateEditModalVenueRace(sport, venue, race) {
  const isPachi  = sport === 'パチンコ・スロット';
  const isOther  = sport === 'その他';
  const isNormal = !isPachi && !isOther;

  // 場名行: normal=dropdown, パチンコ=text, その他=non
  document.getElementById('modal-venue-row-select').style.display = isNormal ? '' : 'none';
  document.getElementById('modal-venue-row-text').style.display   = isPachi  ? '' : 'none';
  document.getElementById('modal-venue-row-none').style.display   = isOther  ? '' : 'none';

  // レース行
  document.getElementById('modal-race-row-select').style.display  = isNormal ? '' : 'none';
  document.getElementById('modal-race-row-text').style.display    = isPachi  ? '' : 'none';
  document.getElementById('modal-race-row-none').style.display    = isOther  ? '' : 'none';

  if (isNormal) {
    populateVenueSelect(document.getElementById('modal-venue'), sport, venue);
    populateRaceSelect(document.getElementById('modal-race'), race);
  } else if (isPachi) {
    document.getElementById('modal-venue-text').value = venue || '';
    document.getElementById('modal-race-text').value  = race  || '';
  }
}

function closeEditModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  currentEditId = null;
}

function saveEditModal() {
  if (!currentEditId) return;
  const date    = document.getElementById('modal-date').value;
  const buyType = document.getElementById('modal-buytype').value;
  const member  = buyType === '単騎' ? document.getElementById('modal-member').value : null;
  const sport   = document.getElementById('modal-sport').value;
  const bet     = parseInt(document.getElementById('modal-bet').value, 10);
  const payRaw  = document.getElementById('modal-payout').value.trim();
  const payout  = payRaw === '' ? null : parseInt(payRaw, 10);
  const memo    = document.getElementById('modal-memo').value.trim();
  const victoryComment = document.getElementById('modal-victory-comment').value.trim() || null;

  const isPachi  = sport === 'パチンコ・スロット';
  const isOther  = sport === 'その他';

  let venue, race;
  if (isPachi) {
    venue = document.getElementById('modal-venue-text').value.trim();
    race  = document.getElementById('modal-race-text').value.trim() || null;
  } else if (isOther) {
    venue = null; race = null;
  } else {
    venue = document.getElementById('modal-venue').value;
    race  = parseInt(document.getElementById('modal-race').value, 10) || null;
  }

  if (!date || !sport || !bet || bet <= 0) { showToast('必須項目を入力してください', 'error'); return; }
  if (!isOther && !isPachi && !venue) { showToast('場名を選択してください', 'error'); return; }
  if (payout !== null && (isNaN(payout) || payout < 0)) { showToast('払戻金は0以上の数値を入力してください', 'error'); return; }

  updateRec(currentEditId, { date, buyType, member, sport, venue, race, bet, payout, memo, victoryComment });
  closeEditModal();
  showToast('変更を保存しました');
  renderHistoryList();
}

function deleteEditRecord() {
  if (!currentEditId) return;
  if (!confirm('この記録を削除しますか？')) return;
  deleteRec(currentEditId);
  closeEditModal();
  showToast('削除しました');
  renderHistoryList();
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast${type === 'error' ? ' toast-error' : ''} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Step Form ─────────────────────────────────────────────
function showStep(n) {
  currentStep = n;
  for (let i = 1; i <= 4; i++) {
    const panel = document.getElementById(`step-panel-${i}`);
    if (panel) panel.style.display = i === n ? '' : 'none';
    const label = document.getElementById(`slabel-${i}`);
    if (label) label.classList.toggle('active', i <= n);
  }
  const fill = document.getElementById('step-progress-fill');
  if (fill) fill.style.width = (n / 4 * 100) + '%';
  const backBtn = document.getElementById('step-back');
  if (backBtn) backBtn.style.display = n > 1 ? '' : 'none';
}

function updateStep2SportUI(sport) {
  const isPachi  = sport === 'パチンコ・スロット';
  const isOther  = sport === 'その他';
  const isNormal = !isPachi && !isOther;

  document.getElementById('step-venue-section').style.display    = isNormal ? '' : 'none';
  document.getElementById('step-storename-section').style.display = isPachi  ? '' : 'none';
  // その他: 場名不要、ボタンを即有効化
  if (isOther) {
    document.getElementById('step2-next').disabled = false;
  } else if (isPachi) {
    const storeEl = document.getElementById('step-storename');
    document.getElementById('step2-next').disabled = !(storeEl.value.trim());
  } else {
    // venue grid: enabled when venue selected
    document.getElementById('step2-next').disabled = !stepFormData.venue;
  }
}

function updateStep3RaceUI(sport) {
  const isPachi  = sport === 'パチンコ・スロット';
  const isOther  = sport === 'その他';
  document.getElementById('step-race-section').style.display    = (!isPachi && !isOther) ? '' : 'none';
  document.getElementById('step-machine-section').style.display = isPachi  ? '' : 'none';
}

function initStepForm() {
  stepFormData = {
    buyType: 'ノリ', noriMembers: [...MEMBERS],
    member: null, sport: null, venue: null,
    date: todayStr(), race: null, bet: null, memo: ''
  };

  // Reset buytype
  document.querySelectorAll('.buytype-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.buytype === 'ノリ');
  });
  document.getElementById('nori-member-section').style.display  = '';
  document.getElementById('tanki-member-section').style.display = 'none';

  // ノリ全員アクティブ
  document.querySelectorAll('#nori-member-grid .member-select-btn').forEach(btn => btn.classList.add('active'));
  document.querySelectorAll('#tanki-member-grid .member-select-btn').forEach(btn => btn.classList.remove('active'));

  // Race grid
  const raceGrid = document.getElementById('step-race-grid');
  if (raceGrid && !raceGrid.dataset.initialized) {
    raceGrid.dataset.initialized = '1';
    raceGrid.innerHTML = RACES.map(r => `<button class="race-btn" data-race="${r}">R${r}</button>`).join('');
    raceGrid.querySelectorAll('.race-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        raceGrid.querySelectorAll('.race-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        stepFormData.race = parseInt(btn.dataset.race);
      });
    });
  } else if (raceGrid) {
    raceGrid.querySelectorAll('.race-btn').forEach(b => b.classList.remove('active'));
  }
  stepFormData.race = null;

  // Sport grid
  const sportGrid = document.getElementById('step-sport-grid');
  if (sportGrid && !sportGrid.dataset.initialized) {
    sportGrid.dataset.initialized = '1';
    sportGrid.innerHTML = SPORTS.map(s =>
      `<button class="sport-grid-btn" data-sport="${esc(s)}">${esc(s)}</button>`
    ).join('');
    sportGrid.querySelectorAll('.sport-grid-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sportGrid.querySelectorAll('.sport-grid-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        stepFormData.sport = btn.dataset.sport;
        stepFormData.venue = null;

        const venueGrid = document.getElementById('step-venue-grid');
        venueGrid.innerHTML = (VENUES[btn.dataset.sport] || []).map(v =>
          `<button class="venue-btn" data-venue="${esc(v)}">${esc(v)}</button>`
        ).join('');
        venueGrid.querySelectorAll('.venue-btn').forEach(vbtn => {
          vbtn.addEventListener('click', () => {
            venueGrid.querySelectorAll('.venue-btn').forEach(b => b.classList.remove('active'));
            vbtn.classList.add('active');
            stepFormData.venue = vbtn.dataset.venue;
            document.getElementById('step2-next').disabled = false;
          });
        });

        // パチンコ・スロット / その他 の店舗名 input
        document.getElementById('step-storename').value = '';

        updateStep2SportUI(btn.dataset.sport);
      });
    });
  } else if (sportGrid) {
    sportGrid.querySelectorAll('.sport-grid-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('step-venue-section').style.display    = 'none';
    document.getElementById('step-storename-section').style.display = 'none';
    document.getElementById('step2-next').disabled = true;
  }

  // 日付
  const dateEl = document.getElementById('step-date');
  if (dateEl) dateEl.value = todayStr();
  const betEl  = document.getElementById('step-bet');
  const memoEl = document.getElementById('step-memo');
  const machineEl = document.getElementById('step-machine');
  if (betEl)    betEl.value    = '';
  if (memoEl)   memoEl.value   = '';
  if (machineEl) machineEl.value = '';

  showStep(1);
}

function registerFromStep() {
  const d = stepFormData;
  const isPachi  = d.sport === 'パチンコ・スロット';
  const isOther  = d.sport === 'その他';

  if (!d.date || !d.sport || !d.bet || d.bet <= 0) {
    showToast('必須項目が未入力です', 'error'); return;
  }
  if (d.buyType === '単騎' && !d.member) {
    showToast('メンバーを選択してください', 'error'); return;
  }
  if (d.buyType === 'ノリ' && d.noriMembers.length === 0) {
    showToast('参加メンバーを選択してください', 'error'); return;
  }
  if (!isOther && !isPachi && !d.venue) {
    showToast('場名を選択してください', 'error'); return;
  }
  if (!isOther && !d.race && !isPachi) {
    showToast('レース番号を選択してください', 'error'); return;
  }

  let venueVal = d.venue;
  let raceVal  = d.race;

  if (isPachi) {
    venueVal = document.getElementById('step-storename').value.trim() || null;
    raceVal  = document.getElementById('step-machine').value.trim()   || null;
  } else if (isOther) {
    venueVal = null; raceVal = null;
  }

  const payRaw = document.getElementById('step-payout')?.value?.trim();
  const payout = payRaw ? parseInt(payRaw, 10) : null;

  addRecord({
    date:        d.date,
    buyType:     d.buyType,
    noriMembers: d.buyType === 'ノリ' ? JSON.stringify(d.noriMembers) : null,
    member:      d.buyType === '単騎' ? d.member : null,
    sport:       d.sport,
    venue:       venueVal,
    race:        raceVal,
    bet:         d.bet,
    payout:      payout !== null && !isNaN(payout) ? payout : null,
    memo:        d.memo || ''
  });

  showToast('登録しました');
  initStepForm();
}

// ── Init ─────────────────────────────────────────────────
function init() {
  loadStorage();
  initStepForm();

  // Buytype toggle
  document.querySelectorAll('.buytype-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.buytype-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      stepFormData.buyType = btn.dataset.buytype;
      const isNori = btn.dataset.buytype === 'ノリ';
      document.getElementById('nori-member-section').style.display  = isNori ? '' : 'none';
      document.getElementById('tanki-member-section').style.display = isNori ? 'none' : '';
    });
  });

  // ノリ member multi-select
  document.querySelectorAll('#nori-member-grid .member-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const member = btn.dataset.member;
      if (member === '全員') {
        const allActive = stepFormData.noriMembers.length === MEMBERS.length;
        const next = !allActive;
        document.querySelectorAll('#nori-member-grid .member-select-btn:not(.wide-btn)').forEach(b => b.classList.toggle('active', next));
        btn.classList.toggle('active', next);
        stepFormData.noriMembers = next ? [...MEMBERS] : [];
      } else {
        btn.classList.toggle('active');
        const selected = [...document.querySelectorAll('#nori-member-grid .member-select-btn:not(.wide-btn).active')].map(b => b.dataset.member);
        stepFormData.noriMembers = selected;
        const allBtn = document.querySelector('#nori-member-grid .wide-btn');
        if (allBtn) allBtn.classList.toggle('active', selected.length === MEMBERS.length);
      }
    });
  });

  // 単騎 member single-select
  document.querySelectorAll('#tanki-member-grid .member-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tanki-member-grid .member-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      stepFormData.member = btn.dataset.member;
    });
  });

  // Step back
  document.getElementById('step-back').addEventListener('click', () => {
    if (currentStep > 1) showStep(currentStep - 1);
  });

  // Step1 next
  document.getElementById('step1-next').addEventListener('click', () => {
    if (stepFormData.buyType === '単騎' && !stepFormData.member) {
      showToast('メンバーを選択してください', 'error'); return;
    }
    if (stepFormData.buyType === 'ノリ' && stepFormData.noriMembers.length === 0) {
      showToast('参加メンバーを選択してください', 'error'); return;
    }
    showStep(2);
  });

  // Step2 next
  document.getElementById('step2-next').addEventListener('click', () => {
    if (!stepFormData.sport) { showToast('競技を選択してください', 'error'); return; }
    const isPachi = stepFormData.sport === 'パチンコ・スロット';
    const isOther = stepFormData.sport === 'その他';
    if (!isOther && !isPachi && !stepFormData.venue) {
      showToast('場名を選択してください', 'error'); return;
    }
    if (isPachi) {
      const store = document.getElementById('step-storename').value.trim();
      if (!store) { showToast('店舗名を入力してください', 'error'); return; }
    }
    updateStep3RaceUI(stepFormData.sport);
    showStep(3);
  });

  // Step-storename input → enable step2-next
  const storenameEl = document.getElementById('step-storename');
  if (storenameEl) {
    storenameEl.addEventListener('input', () => {
      if (stepFormData.sport === 'パチンコ・スロット') {
        document.getElementById('step2-next').disabled = !storenameEl.value.trim();
      }
    });
  }

  // Step3 next
  document.getElementById('step3-next').addEventListener('click', () => {
    const date = document.getElementById('step-date').value;
    const bet  = parseInt(document.getElementById('step-bet').value, 10);
    const memo = document.getElementById('step-memo').value.trim();

    if (!date) { showToast('日付を入力してください', 'error'); return; }
    if (!bet || bet <= 0) { showToast('掛け金を入力してください', 'error'); return; }

    const isPachi = stepFormData.sport === 'パチンコ・スロット';
    const isOther = stepFormData.sport === 'その他';

    if (!isOther && !isPachi && !stepFormData.race) {
      showToast('レース番号を選択してください', 'error'); return;
    }

    stepFormData.date = date;
    stepFormData.bet  = bet;
    stepFormData.memo = memo;

    // 確認テーブル
    const bt = stepFormData.buyType;
    const buyTypeLabel = bt === 'ノリ'
      ? `ノリ（${stepFormData.noriMembers.join('・')}）`
      : `単騎（${stepFormData.member}）`;

    let venueLabel_, raceLabel_;
    if (isPachi) {
      venueLabel_ = document.getElementById('step-storename').value.trim() || '—';
      raceLabel_  = document.getElementById('step-machine').value.trim()   || '—';
    } else if (isOther) {
      venueLabel_ = '—'; raceLabel_ = '—';
    } else {
      venueLabel_ = stepFormData.venue || '—';
      raceLabel_  = stepFormData.race ? `R${stepFormData.race}` : '—';
    }

    const venueKey = isPachi ? '店舗名' : '場名';
    const raceKey  = isPachi ? '機種名' : 'レース番号';

    const rows = [
      ['種別',    buyTypeLabel],
      ['競技',    stepFormData.sport],
      [venueKey,  venueLabel_],
      ['日付',    stepFormData.date],
      [raceKey,   raceLabel_],
      ['掛け金',  fmtMoney(stepFormData.bet)],
      ['メモ',    stepFormData.memo || '—']
    ].filter(([key]) => !(isOther && (key === '場名' || key === 'レース番号' || key === '店舗名' || key === '機種名')));

    const confirmTable = document.getElementById('confirm-table');
    if (confirmTable) {
      confirmTable.innerHTML = rows.map(([label, value]) =>
        `<div class="confirm-row"><span class="confirm-label">${esc(label)}</span><span class="confirm-value">${esc(value)}</span></div>`
      ).join('');
    }
    const payoutEl = document.getElementById('step-payout');
    if (payoutEl) payoutEl.value = '';
    showStep(4);
  });

  document.getElementById('step-modify').addEventListener('click', () => showStep(1));
  document.getElementById('step-register').addEventListener('click', registerFromStep);

  // Badge
  updateBadge(getPending().length);

  // Tab nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Top tabs
  document.querySelectorAll('.top-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.top-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTopTab = btn.dataset.toptab;
      renderSummary();
    });
  });

  // Period filter
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period; selectedPeriodValue = null;
      renderSummary();
    });
  });
  document.getElementById('period-select').addEventListener('change', function () {
    selectedPeriodValue = this.value; renderSummary();
  });

  // Payout modal
  document.getElementById('payout-save').addEventListener('click', savePayoutModal);
  document.getElementById('payout-close').addEventListener('click', closePayoutModal);
  document.getElementById('payout-input').addEventListener('keydown', e => { if (e.key === 'Enter') savePayoutModal(); });
  document.getElementById('payout-input').addEventListener('input', () => {
    const r = records.find(x => x.id === currentPayoutId);
    const isNori = r && (!r.buyType || r.buyType === 'ノリ');
    const val = parseInt(document.getElementById('payout-input').value) || 0;
    document.getElementById('predictor-row').style.display       = isNori && val > 0 ? '' : 'none';
    document.getElementById('victory-comment-row').style.display = val > 0 ? '' : 'none';
  });
  document.getElementById('payout-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('payout-overlay')) closePayoutModal();
  });

  // Edit modal
  document.getElementById('modal-save').addEventListener('click', saveEditModal);
  document.getElementById('modal-delete').addEventListener('click', deleteEditRecord);
  document.getElementById('modal-close').addEventListener('click', closeEditModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeEditModal();
  });

  // 同期ボタン
  document.querySelectorAll('.btn-sync').forEach(btn => {
    btn.addEventListener('click', () => loadFromGAS(true));
  });

  // Online/offline
  window.addEventListener('online', async () => { await syncWithGAS(); await loadFromGAS(); });
  window.addEventListener('offline', () => updateSyncIndicator('オフライン'));

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }

  // 起動時: pending flush → 全件取得
  if (navigator.onLine && gasUrl()) {
    syncWithGAS().then(() => loadFromGAS());
  }
}

document.addEventListener('DOMContentLoaded', init);
