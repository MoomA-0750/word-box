// lib/snippets.js
// 定型文（スニペット/変数）管理モジュール

const fs = require('fs-extra');

const SNIPPETS_FILE = './content/snippets.json';
const MAX_EXPANSION_DEPTH = 10;

// インメモリキャッシュ
let snippetsCache = {};

// スニペットをファイルから読み込みキャッシュに保持
async function loadSnippets() {
  try {
    if (await fs.pathExists(SNIPPETS_FILE)) {
      const data = await fs.readFile(SNIPPETS_FILE, 'utf8');
      snippetsCache = JSON.parse(data);
    } else {
      snippetsCache = {};
    }
  } catch (err) {
    console.error('Failed to load snippets:', err);
    snippetsCache = {};
  }
  console.log(`Snippets loaded: ${Object.keys(snippetsCache).length} entries.`);
}

// 全スニペットを取得
function getSnippets() {
  return { ...snippetsCache };
}

// 単一スニペットを取得（未定義ならnull）
function getSnippet(key) {
  return snippetsCache[key] !== undefined ? snippetsCache[key] : null;
}

// 全スニペットをファイルに保存しキャッシュを更新
async function saveSnippets(snippets) {
  await fs.ensureDir('./content');
  await fs.writeFile(SNIPPETS_FILE, JSON.stringify(snippets, null, 2), 'utf8');
  snippetsCache = { ...snippets };
}

// スニペットを1件追加/更新
async function setSnippet(key, value) {
  snippetsCache[key] = value;
  await saveSnippets(snippetsCache);
}

// スニペットを1件削除
async function deleteSnippet(key) {
  if (snippetsCache[key] === undefined) return false;
  delete snippetsCache[key];
  await saveSnippets(snippetsCache);
  return true;
}

// テキスト内の {% key %} をスニペット値で展開する
// ネスト対応（循環参照検出 + 最大深度制限）
function expandSnippets(text) {
  if (!text) return text;

  const regex = /\{%\s*(\w+)\s*%\}/g;

  function expand(input, depth, seen) {
    if (depth > MAX_EXPANSION_DEPTH) return input;

    return input.replace(regex, (match, key) => {
      if (seen.has(key)) return match;

      const value = snippetsCache[key];
      if (value === undefined) return match;

      const newSeen = new Set(seen);
      newSeen.add(key);
      return expand(value, depth + 1, newSeen);
    });
  }

  return expand(text, 0, new Set());
}

module.exports = {
  loadSnippets,
  getSnippets,
  getSnippet,
  setSnippet,
  deleteSnippet,
  saveSnippets,
  expandSnippets
};
