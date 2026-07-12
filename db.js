const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const GIST_FILENAME = 'db.json';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GIST_ID = process.env.GITHUB_GIST_ID;
const USE_GIST = !!(GITHUB_TOKEN && GIST_ID);

function defaultData() {
  return { tests: {}, sessions: {} };
}

let cache = defaultData();
let initialized = false;

async function fetchFromGist() {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json'
    }
  });
  if (!res.ok) throw new Error(`GitHub Gist: не удалось загрузить (HTTP ${res.status})`);
  const json = await res.json();
  const file = json.files && json.files[GIST_FILENAME];
  if (!file || !file.content) return defaultData();
  try {
    return JSON.parse(file.content);
  } catch {
    return defaultData();
  }
}

async function saveToGist(data) {
  const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      files: { [GIST_FILENAME]: { content: JSON.stringify(data, null, 2) } }
    })
  });
  if (!res.ok) throw new Error(`GitHub Gist: не удалось сохранить (HTTP ${res.status})`);
}

function loadLocal() {
  if (!fs.existsSync(DB_PATH)) saveLocal(defaultData());
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch {
    return defaultData();
  }
}

function saveLocal(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

async function initCache() {
  if (initialized) return;
  if (USE_GIST) {
    try {
      cache = await fetchFromGist();
      console.log('[db] Постоянное хранилище: GitHub Gist — данные загружены');
    } catch (e) {
      console.error('[db] Не удалось загрузить данные из Gist, старт с пустой базой:', e.message);
      cache = defaultData();
    }
  } else {
    cache = loadLocal();
    console.log('[db] Постоянное хранилище не настроено (GITHUB_TOKEN/GITHUB_GIST_ID отсутствуют) — используется локальный файл data/db.json');
  }
  initialized = true;
}

function load() {
  return cache;
}

let queue = Promise.resolve();
function update(fn) {
  queue = queue.then(async () => {
    const result = fn(cache);
    try {
      if (USE_GIST) {
        await saveToGist(cache);
      } else {
        saveLocal(cache);
      }
    } catch (e) {
      console.error('[db] Ошибка сохранения:', e.message);
    }
    return result;
  });
  return queue;
}

module.exports = { load, update, initCache };
