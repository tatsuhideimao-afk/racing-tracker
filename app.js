'use strict';

// ── Constants ─────────────────────────────────────────────
const VENUES = {
  '競馬（中央）': ['札幌','函館','福島','新潟','中山','東京','中京','京都','阪神','小倉'],
  '競馬（地方）': ['帯広','門別','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','園田','姫路','高知','佐賀'],
  '競輪': ['函館','青森','いわき平','弥彦','前橋','取手','宇都宮','大宮','西武園','京王閣','立川','松戸','千葉','川崎','横浜','平塚','小田原','伊東','静岡','浜松','豊橋','岐阜','大垣','四日市','大津','奈良','向日町','和歌山','岸和田','玉野','広島','防府','高松','観音寺','小松島','高知','松山','久留米','小倉','直方','飯塚','武雄','佐世保','熊本','別府'],
  'オートレース': ['船橋','川口','伊勢崎','浜松','山陽','飯塚','川越'],
  '競艇': ['桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑','津','三国','琵琶湖','住之江','尼崎','鳴門','丸亀','児島','宮島','徳山','下関','若松','芦屋','福岡','唐津','大村']
};
const SPORTS   = Object.keys(VENUES);
const RACES    = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS     = ['日','月','火','水','木','金','土'];
const MEMBERS  = ['大迫', '今伊', '今尾', '藤原'];
const BUY_TYPES = ['ノリ', '単舞'];
const GREEN    = '#3a9c2e';
const RED      = '#e24b4a';
const GREY     = '#aab2bb';
const STORAGE_KEY = 'racingTracker';

// ── State ──────────────────────────────────────────────────
let records       = [];
let pendingSyncs  = [];
let currentPeriod = 'month';
let currentSport  = 'all';
let selectedPeriodValue = null;   // YYYY-MM or YYYY
let currentEditId   = null;
let currentPayoutId = null;
let currentMember   = '大迫';
let charts = {};
let toastTimer = null;

// ── Storage ────────────────────────────────────────────────
function loadStorage() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    records      = data.records      || [];
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

function formatDate(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).split('T')[0];   // ISO datetime の T 以降を除去
  const parts = s.split('-');
  if (parts.length !== 3) return String(dateStr);
  const result = parts[0] + '/' + parts[1] + '/' + parts[2];
  console.log('日付変換前:', dateStr, '変換後:', result);
  return result;
}

function getDayOfWeek(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).split('T')[0];
  const [y, m, d] = s.split('-').map(Number);
  const result = DAYS[new Date(y, m - 1, d).getDay()]; // new Date(y,m,d) は常にローカル時刻
  console.log('曜日変換前:', dateStr, '変換後:', result);
  return result;
}

function getYearMonth(dateStr) {
  if (!dateStr) return '';
  const s = String(dateStr).split('T')[0];
  return s.slice(0, 7); // 'YYYY-MM'
}

// 後方互換エイリアス（古い呼び出し箇所を一括置換するまでの橋渡し）
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

// ── GAS Sync ───────────────────────────────────────────────
function gasUrl() { return window.CONFIG?.GAS_URL || ''; }

async function gasFetch(opts = {}) {
  const url = gasUrl();
  if (!url) {
    console.log('[GAS] GAS_URL が未設定です');
    return null;
  }
  console.log('[GAS] URL:', url);
  if (opts.body) console.log('[GAS] 送信データ:', opts.body);

  try {
    const res = await fetch(url, {
      mode: 'cors',
      redirect: 'follow',
      ...opts
    });
    console.log('[GAS] レスポンスステータス:', res.status, res.statusText);
    const data = await res.json();
    console.log('[GAS] レスポンスデータ:', data);
    return data;
  } catch (err) {
    console.error('[GAS] fetchエラー:', err);
    return null;
  }
}

// 同期ボタンのスピン制御
function setSyncSpinning(spinning) {
  document.querySelectorAll('.btn-sync').forEach(btn => {
    btn.classList.toggle('spinning', spinning);
    btn.disabled = spinning;
  });
}

// GAS から全件取得してローカルを上書き
async function loadFromGAS(manual = false) {
  if (!navigator.onLine || !gasUrl()) {
    if (manual) showToast('同期に失敗しました', 'error');
    return;
  }
  setSyncSpinning(true);
  updateSyncIndicator('同期中…');
  try {
    const res = await fetch(gasUrl(), {
      method: 'GET',
      mode: 'cors',
      redirect: 'follow'
    });
    const data = await res.json();
    if (data?.status === 'success' && Array.isArray(data.records)) {
      // GAS が buyType/member を返さない場合（列未追加）、ローカルの値を保持してマージ
      const localById = new Map(records.map(r => [r.id, r]));
      records = data.records.map(gasRec => {
        const local = localById.get(gasRec.id);
        if (local) {
          if (gasRec.buyType == null && local.buyType != null) gasRec.buyType = local.buyType;
          if (gasRec.member  == null && local.member  != null) gasRec.member  = local.member;
        }
        return gasRec;
      });
      saveStorage();
      updateBadge(getPending().length);
      const activeTab = document.querySelector('.tab-content.active')?.id?.replace('tab-', '');
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
    console.log('GAS再送信 (pending):', item.action, item.record?.id);
    try {
      const res = await fetch(gasUrl(), {
        method: 'POST',
        mode: 'cors',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(item)
      });
      const data = await res.json();
      if (data?.status !== 'success') {
        console.error('GAS再送信失敗:', data);
        failed.push(item);
      } else {
        console.log('GAS再送信成功:', item.action);
      }
    } catch (err) {
      console.error('GAS再送信エラー:', err);
      failed.push(item);
    }
  }
  pendingSyncs = failed;
  saveStorage();
  updateSyncIndicator(failed.length ? `未同期 ${failed.length}件` : '');
}

// GAS に直接 POST する（失敗時は pendingSyncs に積む）
async function gasPost(action, record) {
  const url = gasUrl();
  const payload = { action, record };
  console.log('GAS送信:', url, payload);

  if (!url) {
    console.warn('GAS送信スキップ: GAS_URL が未設定');
    pendingSyncs.push(payload);
    saveStorage();
    updateSyncIndicator(`未同期 ${pendingSyncs.length}件`);
    return;
  }
  if (!navigator.onLine) {
    console.warn('GAS送信スキップ: オフライン');
    pendingSyncs.push(payload);
    saveStorage();
    updateSyncIndicator(`未同期 ${pendingSyncs.length}件`);
    return;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    console.log('[GAS] レスポンスステータス:', res.status, res.statusText);
    const data = await res.json();
    console.log('[GAS] レスポンスデータ:', data);
    if (data?.status !== 'success') {
      console.error('GAS送信失敗:', data);
      pendingSyncs.push(payload);
      saveStorage();
      updateSyncIndicator(`未同期 ${pendingSyncs.length}件`);
    } else {
      updateSyncIndicator('');
    }
  } catch (err) {
    console.error('GAS送信失敗:', err);
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
  records[i] = { ...records[i], ...updates };
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
    case 'today': return recs.filter(r => r.date === today);
    case 'month': return recs.filter(r => r.date?.startsWith(today.slice(0,7)));
    case 'select-month': return selectedPeriodValue ? recs.filter(r => r.date?.startsWith(selectedPeriodValue)) : recs;
    case 'year':  return selectedPeriodValue ? recs.filter(r => r.date?.startsWith(selectedPeriodValue)) : recs;
    default:      return recs;
  }
}

function filterBySport(recs) {
  if (currentSport === 'all') return recs;
  return recs.filter(r => r.sport === currentSport);
}

function getNoriOnly(recs) { return recs.filter(r => !r.buyType || r.buyType === 'ノリ'); }
function getFiltered() { return filterBySport(filterByPeriod(getNoriOnly(getCompleted()))); }
function getIndividualFiltered() {
  // getCompleted() ではなく records 全件から検索（結果待ちも表示対象）
  let recs = records.filter(r => r.buyType === '単舞' && r.member === currentMember);
  if (currentMember === '今伊') recs = recs.filter(r => r.sport === '競艇');
  const periodFiltered = filterByPeriod(recs);

  // ── デバッグログ ──
  console.log('[個人別] 全レコード数:', records.length);
  console.log('[個人別] buyType=単舞 のレコード数:', records.filter(r => r.buyType === '単舞').length);
  console.log('[個人別] 選択中のメンバー:', currentMember);
  console.log('[個人別] メンバーフィルター後:', recs.length, '件  期間フィルター後:', periodFiltered.length, '件');
  if (records.length > 0) {
    console.log('[個人別] 先頭3件サンプル:', records.slice(0, 3).map(r => ({
      buyType: JSON.stringify(r.buyType),
      member:  JSON.stringify(r.member),
      payout:  r.payout,
      date:    r.date
    })));
  }

  return periodFiltered;
}

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

// ── Venue select helpers ────────────────────────────────────
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

// ── Render: Pending list ───────────────────────────────────
function renderPendingList() {
  const pending = getPending().sort((a,b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.race - b.race);
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
          <span class="record-date">${formatDate(r.date)}（${getDayOfWeek(r.date)}）</span>
          <span class="record-sport">${esc(r.sport)}</span>
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

// ── Render: Period selects ──────────────────────────────────
function populatePeriodSelect() {
  const sel = document.getElementById('period-select');
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

// ── Render: Sport tabs ─────────────────────────────────────
function renderSportTabs() {
  const bar = document.getElementById('sport-tab-bar');
  const tabs = [
    { value: 'individual', label: '個人別' },
    { value: 'all', label: '全体' },
    ...SPORTS.map(s => ({ value: s, label: s }))
  ];
  bar.innerHTML = tabs.map(t =>
    `<button class="sport-tab ${currentSport === t.value ? 'active' : ''}" data-sport="${esc(t.value)}">${esc(t.label)}</button>`
  ).join('');
  bar.querySelectorAll('.sport-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSport = btn.dataset.sport;
      renderSummary();
    });
  });
}

// ── Render: Member selector ────────────────────────────────
function renderMemberSelector() {
  const container = document.getElementById('member-selector');
  if (!container) return;
  container.innerHTML = MEMBERS.map(m =>
    `<button class="member-btn ${m === currentMember ? 'active' : ''}" data-member="${esc(m)}">${esc(m)}</button>`
  ).join('');
  container.querySelectorAll('.member-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentMember = btn.dataset.member;
      renderSummary();
    });
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
    msg.className = 'no-data-msg';
    msg.textContent = 'データなし';
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
        ctx.save();
        ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bar.x + 4, bar.y);
        ctx.restore();
      });
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'bar',
    plugins: [roiLabelPlugin],
    data: {
      labels,
      datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 52 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => rois[ctx.dataIndex] === null ? 'データなし' : `ROI: ${ctx.raw.toFixed(1)}%` } }
      },
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
      const msg = document.createElement('div');
      msg.className = 'no-data-msg';
      msg.textContent = 'データなし';
      wrap.appendChild(msg);
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
        const text = topLabels[i];
        ctx.save();
        ctx.font = 'bold 9px -apple-system,sans-serif';
        ctx.fillStyle = colors[i];
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, bar.x, bar.y - 2);
        ctx.restore();
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
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(chart.chartArea.left, y);
      ctx.lineTo(chart.chartArea.right, y);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }
  };

  const roiTopPlugin = !topLabels ? {
    id: 'roiTop',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      chart.getDatasetMeta(0).data.forEach((bar, i) => {
        if (rois[i] === null) return;
        ctx.save();
        ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(vals[i].toFixed(1) + '%', bar.x, bar.y - 2);
        ctx.restore();
      });
    }
  } : null;

  const plugins = [baselineLine];
  if (topLabels) plugins.push(topLabelPlugin);
  else plugins.push(roiTopPlugin);

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    plugins,
    data: {
      labels,
      datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => rois[ctx.dataIndex] === null ? 'データなし' : `ROI: ${ctx.raw.toFixed(1)}%` } }
      },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' }, beginAtZero: true }
      }
    }
  });
}

// ── Render: Summary ─────────────────────────────────────────
function renderSummary() {
  populatePeriodSelect();
  renderSportTabs();

  const isYear       = currentPeriod === 'year';
  const isAll        = currentSport === 'all';
  const isIndividual = currentSport === 'individual';

  let filtered;
  if (isIndividual) {
    renderMemberSelector();
    filtered = getIndividualFiltered();
  } else {
    filtered = getFiltered();
  }

  const kpi = calcKPI(filtered);

  // KPI values
  document.getElementById('kpi-bet').textContent    = fmtMoney(kpi.totalBet);
  document.getElementById('kpi-payout').textContent = fmtMoney(kpi.totalPayout);

  const profitEl = document.getElementById('kpi-profit');
  profitEl.textContent  = kpi.profit >= 0 ? '+' + fmtMoney(kpi.profit) : '−' + fmtMoney(kpi.profit);
  profitEl.className    = 'kpi-value ' + (kpi.profit > 0 ? 'positive' : kpi.profit < 0 ? 'negative' : '');

  const roiEl = document.getElementById('kpi-roi');
  roiEl.textContent = kpi.roi != null ? kpi.roi.toFixed(1) + '%' : '—';
  roiEl.className   = 'kpi-value ' + (kpi.roi == null ? '' : kpi.roi >= 100 ? 'positive' : 'negative');

  document.getElementById('kpi-hitrate').textContent = kpi.hitRate != null ? kpi.hitRate.toFixed(1) + '%' : '—';

  const isImai = isIndividual && currentMember === '今伊';

  // section visibility
  document.getElementById('section-member-select').style.display       = isIndividual ? '' : 'none';
  document.getElementById('section-individual-sport').style.display    = isIndividual && !isImai ? '' : 'none';
  document.getElementById('section-individual-venue').style.display    = isImai ? '' : 'none';
  document.getElementById('section-monthly').style.display             = !isAll && !isIndividual && isYear ? '' : 'none';
  document.getElementById('section-sport-roi').style.display           = isAll ? '' : 'none';
  document.getElementById('section-monthly-trend').style.display       = isAll ? '' : 'none';
  document.getElementById('section-moving-avg').style.display          = isAll ? '' : 'none';
  document.getElementById('section-venue').style.display               = !isAll && !isIndividual && !isYear ? '' : 'none';
  document.getElementById('section-race').style.display                = !isAll && !isIndividual && !isYear ? '' : 'none';
  document.getElementById('section-day').style.display                 = !isAll && !isIndividual && !isYear ? '' : 'none';

  if (isIndividual) {
    if (isImai) {
      renderIndividualVenueChart(filtered);
    } else {
      renderIndividualSportChart(filtered);
    }
    return;
  }

  if (isAll) {
    renderSportROIChart(filtered);
    renderMonthlyTrendChart(filtered);
    renderMovingAvgChart();
    return;
  }

  if (isYear) {
    renderMonthlyChart(filtered, selectedPeriodValue);
    return;
  }

  // 場別ROI（横棒・ROI高い順・3件未満グレー）
  const venueStats = {};
  filtered.forEach(r => {
    if (!venueStats[r.venue]) venueStats[r.venue] = { bet: 0, payout: 0, count: 0 };
    venueStats[r.venue].bet    += r.bet;
    venueStats[r.venue].payout += r.payout;
    venueStats[r.venue].count++;
  });
  const venueEntries = Object.entries(venueStats)
    .filter(([, s]) => s.bet > 0)
    .map(([venue, s]) => ({ venue, roi: s.payout / s.bet * 100, count: s.count }))
    .sort((a, b) => b.roi - a.roi);

  const wrapH = Math.max(120, venueEntries.length * 32);
  const wrapVenue = document.getElementById('wrap-venue');
  if (wrapVenue) wrapVenue.style.height = wrapH + 'px';

  renderHBar('chart-venue', 'wrap-venue',
    venueEntries.map(e => e.venue),
    venueEntries.map(e => e.roi),
    venueEntries.map(e => e.count), 3
  );

  // レース番号別ROI（横棒）
  const raceStats = {};
  RACES.forEach(r => { raceStats[`R${r}`] = { bet: 0, payout: 0 }; });
  filtered.filter(r => r.race >= 1 && r.race <= 12).forEach(r => {
    raceStats[`R${r.race}`].bet    += r.bet;
    raceStats[`R${r.race}`].payout += r.payout;
  });
  const raceKeys = RACES.map(r => `R${r}`);
  const raceRois = raceKeys.map(k => raceStats[k].bet > 0 ? raceStats[k].payout / raceStats[k].bet * 100 : null);
  renderHBar('chart-race', 'wrap-race', raceKeys, raceRois, null, 0);

  // 曜日別ROI（縦棒）
  const dayStats = DAYS.map((_, i) => {
    const recs = filtered.filter(r => {
      if (!r.date) return false;
      const s = String(r.date).split('T')[0];
      const [ry, rm, rd] = s.split('-').map(Number);
      return new Date(ry, rm - 1, rd).getDay() === i;
    });
    const bet  = recs.reduce((s, r) => s + r.bet, 0);
    const pay  = recs.reduce((s, r) => s + r.payout, 0);
    return { roi: bet > 0 ? pay / bet * 100 : null };
  });
  renderVBar('chart-day', DAYS, dayStats.map(d => d.roi), null);
}

// ── ① 競技別ROI比較（全体タブ） ────────────────────────────
function renderSportROIChart(filtered) {
  const canvasId = 'chart-sport-roi';
  const wrapId   = 'wrap-sport-roi';

  const sportData = SPORTS.map(sport => {
    const recs   = filtered.filter(r => r.sport === sport);
    const bet    = recs.reduce((s, r) => s + r.bet, 0);
    const payout = recs.reduce((s, r) => s + r.payout, 0);
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
        const d      = sportData[i];
        const roi    = vals[i].toFixed(1) + '%';
        const profit = (d.profit >= 0 ? '+¥' : '-¥') + Math.abs(d.profit).toLocaleString('ja-JP');
        ctx.save();
        ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${roi}  ${profit}`, bar.x + 5, bar.y);
        ctx.restore();
      });
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'bar',
    plugins: [labelPlugin],
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 140 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `ROI: ${ctx.raw.toFixed(1)}%` } }
      },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748b' } }
      }
    }
  });
}

// ── 個人別 競技別収支横棒グラフ ────────────────────────────
function renderIndividualSportChart(filtered) {
  const canvasId = 'chart-individual-sport';
  const wrapId   = 'wrap-individual-sport';
  // 払戻確定済みのみチャート対象（pending は payout=null のため除外）
  const completed = filtered.filter(r => r.payout !== null);

  const sportData = SPORTS.map(sport => {
    const recs   = completed.filter(r => r.sport === sport);
    const bet    = recs.reduce((s, r) => s + r.bet, 0);
    const payout = recs.reduce((s, r) => s + r.payout, 0);
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
        ctx.save();
        ctx.font = 'bold 10px -apple-system,sans-serif';
        ctx.fillStyle = '#1e293b';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bar.x + 5, bar.y);
        ctx.restore();
      });
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'bar',
    plugins: [labelPlugin],
    data: { labels, datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 130 } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const p = vals[ctx.dataIndex];
          return `収支: ${p >= 0 ? '+¥' : '-¥'}${Math.abs(p).toLocaleString('ja-JP')}`;
        }}}
      },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#64748b' } }
      }
    }
  });
}

// ── 今伊個人別 場別ROI横棒グラフ ───────────────────────────
function renderIndividualVenueChart(filtered) {
  const canvasId = 'chart-individual-venue';
  const wrapId   = 'wrap-individual-venue';
  // 払戻確定済みのみROI計算対象
  const completed = filtered.filter(r => r.payout !== null);

  const venueStats = {};
  completed.forEach(r => {
    if (!venueStats[r.venue]) venueStats[r.venue] = { bet: 0, payout: 0, count: 0 };
    venueStats[r.venue].bet    += r.bet;
    venueStats[r.venue].payout += r.payout;
    venueStats[r.venue].count++;
  });
  const entries = Object.entries(venueStats)
    .filter(([, s]) => s.bet > 0)
    .map(([venue, s]) => ({ venue, roi: s.payout / s.bet * 100, count: s.count }))
    .sort((a, b) => b.roi - a.roi);

  const wrapEl = document.getElementById(wrapId);
  if (wrapEl) wrapEl.style.height = Math.max(120, entries.length * 32) + 'px';

  renderHBar(canvasId, wrapId,
    entries.map(e => e.venue),
    entries.map(e => e.roi),
    entries.map(e => e.count), 3
  );
}

// ── ② 月別収支推移（全体タブ） ─────────────────────────────
function renderMonthlyTrendChart(filtered) {
  const canvasId = 'chart-monthly-trend';
  const wrapId   = 'wrap-monthly-trend';

  const monthMap = {};
  filtered.forEach(r => {
    const ym = getYearMonth(r.date);
    if (!ym) return;
    if (!monthMap[ym]) monthMap[ym] = { bet: 0, payout: 0 };
    monthMap[ym].bet    += r.bet;
    monthMap[ym].payout += r.payout;
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
        const p    = profits[i];
        const text = (p >= 0 ? '+¥' : '-¥') + Math.abs(p).toLocaleString('ja-JP');
        ctx.save();
        ctx.font = 'bold 9px -apple-system,sans-serif';
        ctx.fillStyle = colors[i];
        ctx.textAlign = 'center';
        ctx.textBaseline = p >= 0 ? 'bottom' : 'top';
        ctx.fillText(text, bar.x, p >= 0 ? bar.y - 2 : bar.y + bar.height + 2);
        ctx.restore();
      });
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(document.getElementById(canvasId).getContext('2d'), {
    type: 'bar',
    plugins: [profitLabelPlugin],
    data: { labels, datasets: [{ data: rois, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 22, bottom: 22 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const p = profits[ctx.dataIndex];
              return [`ROI: ${ctx.raw.toFixed(1)}%`, `収支: ${p >= 0 ? '+¥' : '-¥'}${Math.abs(p).toLocaleString('ja-JP')}`];
            }
          }
        }
      },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
        y: {
          grid: { color: '#f1f5f9' },
          ticks: { font: { size: 11 }, color: '#64748b' },
          beginAtZero: true
        }
      }
    }
  });
}

// ── ③ 回収率移動平均（全体タブ・直近30件） ──────────────────
function renderMovingAvgChart() {
  const canvasId = 'chart-moving-avg';
  const canvas   = document.getElementById(canvasId);
  if (!canvas) return;

  // ノリのみ・日付/createdAt 昇順・直近30件
  const completed = [...getNoriOnly(getCompleted())]
    .sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.createdAt - b.createdAt)
    .slice(-30);

  if (!completed.length) {
    if (charts[canvasId]) { charts[canvasId].destroy(); charts[canvasId] = null; }
    canvas.style.display = 'none';
    const wrap = canvas.parentElement;
    if (!wrap.querySelector('.no-data-msg')) {
      const msg = document.createElement('div'); msg.className = 'no-data-msg'; msg.textContent = 'データなし';
      wrap.appendChild(msg);
    }
    return;
  }
  canvas.parentElement?.querySelectorAll('.no-data-msg').forEach(el => el.remove());
  canvas.style.display = '';

  const rois   = completed.map(r => r.bet > 0 ? parseFloat((r.payout / r.bet * 100).toFixed(1)) : 0);
  const labels = completed.map(r => {
    const s = String(r.date || '').split('T')[0];
    const parts = s.split('-');
    return parts.length === 3 ? `${parseInt(parts[1])}/${parseInt(parts[2])}` : '';
  });

  const baselinePlugin = {
    id: 'movingAvgBaseline',
    afterDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      const y = scales.y.getPixelForValue(100);
      if (y < chartArea.top || y > chartArea.bottom) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }
  };

  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(canvas.getContext('2d'), {
    type: 'line',
    plugins: [baselinePlugin],
    data: {
      labels,
      datasets: [{
        data: rois,
        borderColor: '#0ea5c8',
        backgroundColor: 'rgba(14,165,200,0.08)',
        borderWidth: 2,
        pointRadius: completed.length <= 15 ? 4 : 2,
        pointBackgroundColor: '#0ea5c8',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `ROI: ${ctx.raw.toFixed(1)}%` } }
      },
      scales: {
        x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, color: '#64748b', maxRotation: 45 } },
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' }, beginAtZero: true }
      }
    }
  });
}

// ── Monthly chart ───────────────────────────────────────────
function renderMonthlyChart(recs, year) {
  const canvas = document.getElementById('chart-monthly');
  if (!canvas) return;

  const monthData = Array.from({ length: 12 }, (_, i) => {
    const ym  = `${year}-${String(i+1).padStart(2,'0')}`;
    const mrs = recs.filter(r => getYearMonth(r.date)?.startsWith(ym));
    const bet  = mrs.reduce((s, r) => s + r.bet, 0);
    const pay  = mrs.reduce((s, r) => s + r.payout, 0);
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
        ctx.save();
        ctx.font = 'bold 9px -apple-system,sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle    = bal >= 0 ? GREEN : RED;
        ctx.fillText(text, bar.x, bar.y - 2);
        ctx.restore();
      });
    }
  };

  const baselinePlugin = {
    id: 'baseline',
    afterDatasetsDraw(chart) {
      const { ctx, scales, chartArea } = chart;
      const y = scales.y.getPixelForValue(100);
      if (y < chartArea.top || y > chartArea.bottom) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }
  };

  canvas.style.display = '';
  canvas.parentElement?.querySelectorAll('.no-data-msg').forEach(el => el.remove());

  if (charts['chart-monthly']) charts['chart-monthly'].destroy();
  charts['chart-monthly'] = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    plugins: [profitLabelPlugin, baselinePlugin],
    data: {
      labels,
      datasets: [{ data: vals, backgroundColor: colors, borderWidth: 0, borderRadius: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      layout: { padding: { top: 24 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const d = monthData[ctx.dataIndex];
              if (d.roi === null) return 'データなし';
              const sign = d.profit >= 0 ? '+¥' : '-¥';
              return [`ROI: ${ctx.raw.toFixed(1)}%`, `収支: ${sign}${Math.abs(d.profit).toLocaleString('ja-JP')}`];
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

// ── Render: History ─────────────────────────────────────────
function renderHistoryList() {
  const sorted = [...records].sort((a, b) =>
    a.date !== b.date ? (a.date > b.date ? -1 : 1) : b.createdAt - a.createdAt
  );
  const container = document.getElementById('history-list');
  const emptyEl   = document.getElementById('history-empty');

  if (sorted.length === 0) {
    container.innerHTML = ''; emptyEl.style.display = 'flex'; return;
  }
  emptyEl.style.display = 'none';

  container.innerHTML = sorted.map(r => {
    const isPending = r.payout === null;
    const isHit     = !isPending && r.payout > 0;
    const diff      = isPending ? null : r.payout - r.bet;
    const statusCls = isPending ? 'pending' : isHit ? 'hit' : 'miss';
    const statusTxt = isPending ? '結果待ち' : isHit ? '的中' : 'ハズレ';
    const diffHtml  = diff !== null
      ? `<div class="record-balance ${diff >= 0 ? 'positive' : 'negative'}">${diff >= 0 ? '+' : '−'}${fmtMoney(diff)}</div>`
      : '';
    return `
      <div class="record-card" data-id="${r.id}">
        <div class="record-main">
          <div class="record-meta">
            <span class="record-date">${formatDate(r.date)}（${getDayOfWeek(r.date)}）</span>
            <span class="record-sport">${esc(r.sport)}</span>
            <span class="record-venue">${esc(r.venue)}</span>
            <span class="badge-race">R${r.race}</span>
          </div>
          <div class="record-amounts">
            <span class="record-bet">${fmtMoney(r.bet)}</span>
            ${!isPending ? `<span class="record-payout">→ ${fmtMoney(r.payout)}</span>` : ''}
            <span class="record-status ${statusCls}">${statusTxt}</span>
          </div>
          ${diffHtml}
          ${r.memo ? `<div class="record-memo">${esc(r.memo)}</div>` : ''}
        </div>
      </div>
    `;
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
  document.getElementById('payout-info').innerHTML =
    `<span>${esc(r.sport)}</span><span>${formatDate(r.date)}（${getDayOfWeek(r.date)}）</span>` +
    `<span>${esc(r.venue)}　R${r.race}</span><span>掛け金：${fmtMoney(r.bet)}</span>`;
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
  updateRec(currentPayoutId, { payout });
  showToast(payout > 0 ? `的中！ ${fmtMoney(payout)} を確定しました` : 'ハズレを確定しました');
  renderPendingList();
  closePayoutModal();
}

// ── Edit Modal ───────────────────────────────────────────────
function openEditModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  currentEditId = id;

  // buyType / member
  const buyTypeSel = document.getElementById('modal-buytype');
  buyTypeSel.value = r.buyType || 'ノリ';
  const memberRow = document.getElementById('modal-member-row');
  memberRow.style.display = buyTypeSel.value === '単舞' ? '' : 'none';
  const memberSel = document.getElementById('modal-member');
  memberSel.value = r.member || '';
  buyTypeSel.onchange = () => {
    memberRow.style.display = buyTypeSel.value === '単舞' ? '' : 'none';
  };

  // populate sport select
  const sportSel = document.getElementById('modal-sport');
  sportSel.innerHTML = SPORTS.map(s =>
    `<option value="${esc(s)}" ${s === r.sport ? 'selected' : ''}>${esc(s)}</option>`
  ).join('');

  // populate venue based on current sport
  populateVenueSelect(document.getElementById('modal-venue'), r.sport, r.venue);
  populateRaceSelect(document.getElementById('modal-race'), r.race);

  document.getElementById('modal-date').value   = r.date;
  document.getElementById('modal-bet').value    = r.bet;
  document.getElementById('modal-payout').value = r.payout !== null ? r.payout : '';
  document.getElementById('modal-memo').value   = r.memo || '';

  document.getElementById('modal-overlay').style.display = 'flex';

  // sport change → update venue options
  sportSel.onchange = () => populateVenueSelect(document.getElementById('modal-venue'), sportSel.value);
}

function closeEditModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  currentEditId = null;
}

function saveEditModal() {
  if (!currentEditId) return;
  const date    = document.getElementById('modal-date').value;
  const buyType = document.getElementById('modal-buytype').value;
  const member  = buyType === '単舞' ? document.getElementById('modal-member').value : '';
  const sport   = document.getElementById('modal-sport').value;
  const venue   = document.getElementById('modal-venue').value;
  const race    = parseInt(document.getElementById('modal-race').value, 10);
  const bet     = parseInt(document.getElementById('modal-bet').value, 10);
  const payRaw  = document.getElementById('modal-payout').value.trim();
  const payout  = payRaw === '' ? null : parseInt(payRaw, 10);
  const memo    = document.getElementById('modal-memo').value.trim();

  if (!date || !sport || !venue || !race || !bet || bet <= 0) {
    showToast('必須項目を入力してください', 'error'); return;
  }
  if (payout !== null && (isNaN(payout) || payout < 0)) {
    showToast('払戻金は0以上の数値を入力してください', 'error'); return;
  }
  updateRec(currentEditId, { date, buyType, member, sport, venue, race, bet, payout, memo });
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

// ── Register ───────────────────────────────────────────────
function registerRecord() {
  const date    = document.getElementById('input-date').value;
  const buyType = document.getElementById('input-buytype').value;
  const member  = buyType === '単舞' ? document.getElementById('input-member').value : '';
  const sport   = document.getElementById('input-sport').value;
  const venue   = document.getElementById('input-venue').value;
  const race    = parseInt(document.getElementById('input-race').value, 10);
  const bet     = parseInt(document.getElementById('input-bet').value, 10);
  const payRaw  = document.getElementById('input-payout').value.trim();
  const payout  = payRaw !== '' ? parseInt(payRaw, 10) : null;
  const memo    = document.getElementById('input-memo').value.trim();

  if (!date)           { showToast('日付を入力してください', 'error'); return; }
  if (!sport)          { showToast('競技を選択してください', 'error'); return; }
  if (!venue)          { showToast('場名を選択してください', 'error'); return; }
  if (!race)           { showToast('レース番号を選択してください', 'error'); return; }
  if (!bet || bet <= 0){ showToast('掛け金を入力してください', 'error'); return; }
  if (buyType === '単舞' && !member) { showToast('メンバーを選択してください', 'error'); return; }

  addRecord({ date, buyType, member, sport, venue, race, bet, payout, memo });
  showToast('登録しました');

  // reset partial fields
  document.getElementById('input-buytype').value   = 'ノリ';
  document.getElementById('input-member-row').style.display = 'none';
  document.getElementById('input-venue').innerHTML = '<option value="">競技を先に選択</option>';
  document.getElementById('input-venue').disabled  = true;
  document.getElementById('input-sport').value     = '';
  document.getElementById('input-race').value      = '';
  document.getElementById('input-bet').value       = '';
  document.getElementById('input-payout').value    = '';
  document.getElementById('input-memo').value      = '';
}

// ── Init ─────────────────────────────────────────────────
function init() {
  loadStorage();

  // BuyType → member visibility
  const buyTypeSel = document.getElementById('input-buytype');
  buyTypeSel.addEventListener('change', () => {
    document.getElementById('input-member-row').style.display = buyTypeSel.value === '単舞' ? '' : 'none';
  });

  // Sport selects
  const sportSel = document.getElementById('input-sport');
  SPORTS.forEach(s => {
    const o = document.createElement('option');
    o.value = s; o.textContent = s;
    sportSel.appendChild(o);
  });

  // Sport → Venue
  sportSel.addEventListener('change', () => {
    const venueSel = document.getElementById('input-venue');
    if (sportSel.value) {
      populateVenueSelect(venueSel, sportSel.value);
      venueSel.disabled = false;
    } else {
      venueSel.innerHTML = '<option value="">競技を先に選択</option>';
      venueSel.disabled = true;
    }
  });

  // Race select
  populateRaceSelect(document.getElementById('input-race'));

  // Default date
  document.getElementById('input-date').value = todayStr();

  // Badge
  updateBadge(getPending().length);

  // Tab nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Register button
  document.getElementById('btn-register').addEventListener('click', registerRecord);
  document.getElementById('input-bet').addEventListener('keydown', e => { if (e.key === 'Enter') registerRecord(); });

  // Period filter
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod      = btn.dataset.period;
      selectedPeriodValue = null;
      renderSummary();
    });
  });
  document.getElementById('period-select').addEventListener('change', function () {
    selectedPeriodValue = this.value;
    renderSummary();
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
  window.addEventListener('online', async () => {
    await syncWithGAS();   // 未送信分を先に flush
    await loadFromGAS();   // 最新データを取得
  });
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
