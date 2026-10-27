const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  '1AUYS2mF28aLeHb8LSq6FNXZD9lM7Qva4ey4t79vGHJo';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const CACHE_MS = Number(process.env.CATALOG_CACHE_MS || 60_000);
const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const TAB = {
  demos: process.env.SHEET_TAB_DEMOS || 'Demo Tracker',
  profiles: process.env.SHEET_TAB_PROFILES || 'SA Profiles',
  kb: process.env.SHEET_TAB_KB || 'KB',
  blog: process.env.SHEET_TAB_BLOG || 'Blog post',
};

let cache = { at: 0, payload: null, source: 'none' };

function cell(v) {
  if (v == null) return '';
  return String(v).trim();
}

function isHttp(u) {
  return /^https?:\/\//i.test(String(u || '').trim());
}

function sanitizeNotes(notes) {
  const n = cell(notes);
  if (/1password|vault|password|credential/i.test(n)) return '';
  return n;
}

function parseDemos(rows) {
  if (!rows?.length) return [];
  let headerIdx = rows.findIndex(
    (r) => cell(r[0]).includes('Owner') && cell(r[1]).includes('Demo')
  );
  if (headerIdx < 0) headerIdx = 0;
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const owner = cell(r[0]);
    const name = cell(r[1]);
    if (!owner || !name) continue;
    out.push({
      owner,
      name,
      stage: cell(r[2]),
      use_case: cell(r[3]),
      industry: cell(r[4]),
      products: cell(r[5]),
      pain_value: cell(r[6]),
      brief: cell(r[7]),
      demo_link: cell(r[8]),
      github: cell(r[9]),
      recording: cell(r[10]),
      status: cell(r[11]) || 'Idea',
      date: cell(r[12]),
      feedback: cell(r[13]),
      notes: sanitizeNotes(r[14]),
    });
  }
  return out;
}

function parseProfiles(rows) {
  const profiles = {};
  if (!rows?.length) return profiles;
  let headerIdx = rows.findIndex((r) => /^name$/i.test(cell(r[0])));
  if (headerIdx < 0) headerIdx = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const name = cell(r[0]);
    if (!name) continue;
    profiles[name] = {
      title: cell(r[1]) || 'Solutions Architect',
      location: cell(r[2]),
      bio: cell(r[3]),
      photo: isHttp(r[4]) ? cell(r[4]) : '',
      linkedin: isHttp(r[5]) ? cell(r[5]) : '',
      github: isHttp(r[6]) ? cell(r[6]) : '',
    };
  }
  return profiles;
}

function parseContent(rows, type) {
  if (!rows?.length) return [];
  let headerIdx = rows.findIndex((r) => cell(r[0]).includes('Owner'));
  if (headerIdx < 0) headerIdx = 0;
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const owner = cell(r[0]);
    const title = cell(r[1]);
    if (!owner || !title) continue;
    out.push({
      type,
      owner,
      title,
      link: cell(r[2]),
      use_case: cell(r[3]),
      industry: cell(r[4]),
      products: cell(r[5]),
    });
  }
  return out;
}

function loadFallback() {
  const demos = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'demos.json'), 'utf8'));
  const profiles = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'profiles.json'), 'utf8'));
  const content = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'content.json'), 'utf8'));
  return {
    demos,
    profiles,
    content,
    sheetUrl: SHEET_URL,
    source: 'local-json',
    fetchedAt: new Date().toISOString(),
  };
}

function serviceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Allow base64-encoded JSON for App Platform env convenience.
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64 JSON');
    }
  }
}

async function fetchSheetRanges() {
  const creds = serviceAccountCredentials();
  if (!creds) return null;

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const ranges = [TAB.demos, TAB.profiles, TAB.kb, TAB.blog].map((t) => `'${t}'`);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges,
    majorDimension: 'ROWS',
  });
  const valueRanges = res.data.valueRanges || [];
  const byTitle = {};
  valueRanges.forEach((vr, i) => {
    const title = [TAB.demos, TAB.profiles, TAB.kb, TAB.blog][i];
    byTitle[title] = vr.values || [];
  });
  return byTitle;
}

async function buildCatalog() {
  try {
    const byTitle = await fetchSheetRanges();
    if (byTitle) {
      const demos = parseDemos(byTitle[TAB.demos]);
      const profiles = parseProfiles(byTitle[TAB.profiles]);
      const content = [
        ...parseContent(byTitle[TAB.kb], 'KB'),
        ...parseContent(byTitle[TAB.blog], 'Blog'),
      ];
      return {
        demos,
        profiles,
        content,
        sheetUrl: SHEET_URL,
        source: 'google-sheets',
        fetchedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    console.error('[catalog] Sheets fetch failed, using local JSON fallback:', err.message);
  }
  return loadFallback();
}

async function getCatalog({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.payload && now - cache.at < CACHE_MS) {
    return { ...cache.payload, cached: true };
  }
  const payload = await buildCatalog();
  cache = { at: now, payload, source: payload.source };
  return { ...payload, cached: false };
}

module.exports = { getCatalog, SHEET_URL, SHEET_ID };
