/**
 * Google Apps Script — レース収支管理バックエンド
 *
 * 使い方:
 *  1. Google スプレッドシートを新規作成し、シート名を「records」に変更
 *  2. 拡張機能 → Apps Script を開き、このファイルの内容をすべて貼り付けて保存
 *  3. デプロイ → 新しいデプロイ（または既存デプロイを「バージョン管理」から更新）
 *     種類: ウェブアプリ
 *     次のユーザーとして実行: 自分
 *     アクセスできるユーザー: 全員
 *  4. デプロイURLを config.js の GAS_URL に設定
 *
 * スキーマ（列順）:
 *   id, date, sport, venue, race, invest, recover, memo,
 *   pending, createdAt, buyType, member, noriMembers,
 *   predictor, victoryComment, updatedAt
 */

const SHEET_NAME = 'records';
const HEADERS = [
  'id', 'date', 'sport', 'venue', 'race',
  'invest', 'recover', 'memo', 'pending', 'createdAt',
  'buyType', 'member', 'noriMembers', 'predictor',
  'victoryComment', 'updatedAt'
];

// ── CORS ヘルパー ─────────────────────────────────────────
function addCors(output) {
  return output;  // GAS の ContentService は自動で CORS 対応
}

// ── GET: 全レコード取得 ──────────────────────────────────
function doGet(e) {
  try {
    const sheet = getSheet();
    ensureHeaders(sheet);

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return respond({ status: 'success', records: [] });
    }

    const records = data.slice(1).map(row => {
      const obj = {};
      HEADERS.forEach((h, i) => {
        let v = row[i];
        if (v === '' || v === null || v === undefined) {
          v = null;
        } else if (v instanceof Date) {
          // JST で YYYY-MM-DD に変換
          const y = v.getFullYear();
          const m = String(v.getMonth() + 1).padStart(2, '0');
          const d = String(v.getDate()).padStart(2, '0');
          v = `${y}-${m}-${d}`;
        }
        obj[h] = v;
      });

      // 数値変換
      if (obj.race !== null && !isNaN(Number(obj.race)) && String(obj.race).match(/^\d+$/)) {
        obj.race = Number(obj.race);
      }
      if (obj.invest  !== null) obj.invest  = Number(obj.invest);
      if (obj.recover !== null) obj.recover = Number(obj.recover);

      // フロントエンド互換: bet / payout エイリアス
      obj.bet    = obj.invest;
      obj.payout = obj.recover;

      return obj;
    }).filter(r => r.id);

    return respond({ status: 'success', records });
  } catch (err) {
    return respond({ status: 'error', message: err.toString() });
  }
}

// ── POST: 追加 / 更新 / 削除 ─────────────────────────────
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const payload = JSON.parse(e.postData.contents);
    const { action, record } = payload;
    const sheet = getSheet();
    ensureHeaders(sheet);

    if (action === 'add') {
      // pending フラグを自動設定
      const row = HEADERS.map(h => {
        if (h === 'pending') return record.payout == null ? 'TRUE' : 'FALSE';
        return record[h] ?? '';
      });
      sheet.appendRow(row);
      return respond({ status: 'success' });
    }

    if (action === 'update') {
      const rowIdx = findRowById(sheet, record.id);
      if (rowIdx < 0) return respond({ status: 'error', message: 'Record not found: ' + record.id });
      HEADERS.forEach((h, i) => {
        let val = record[h] ?? '';
        if (h === 'pending') val = record.payout == null ? 'TRUE' : 'FALSE';
        sheet.getRange(rowIdx, i + 1).setValue(val);
      });
      return respond({ status: 'success' });
    }

    if (action === 'delete') {
      const rowIdx = findRowById(sheet, record.id);
      if (rowIdx < 0) return respond({ status: 'error', message: 'Record not found: ' + record.id });
      sheet.deleteRow(rowIdx);
      return respond({ status: 'success' });
    }

    return respond({ status: 'error', message: 'Unknown action: ' + action });

  } catch (err) {
    return respond({ status: 'error', message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ── Helpers ──────────────────────────────────────────────
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  return sheet;
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#e8f4f8');
  }
}

function findRowById(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(id)) return i + 1;
  }
  return -1;
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
