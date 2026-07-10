const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function defaultData() {
  return { tests: {}, sessions: {} };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(defaultData());
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return defaultData();
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// Простая защита от параллельной записи в рамках одного процесса
let queue = Promise.resolve();
function update(fn) {
  queue = queue.then(() => {
    const data = load();
    const result = fn(data);
    save(data);
    return result;
  });
  return queue;
}

module.exports = { load, save, update };
