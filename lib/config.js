// ini ベースの設定ファイルサポート
//
// wordbox.ini が存在すればそこから設定を読み込み、
// 存在しなければデフォルト値を使用する。
// 環境変数で上書きも可能。

const fs = require('fs');
const path = require('path');
const ini = require('ini');

const CONFIG_PATH = path.resolve('./wordbox.ini');

const DEFAULTS = {
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  content: {
    postsDir: './content/posts',
    topicsDir: './content/topics',
    dictionaryDir: './content/dictionary',
    magazinesDir: './content/magazines',
    snippetsFile: './content/snippets.json',
  },
  admin: {
    password: 'admin',
    sessionExpireHours: 24,
  },
  search: {
    snippetLength: 120,
    snippetContext: 40,
    fuzzyThreshold: 2,       // レーベンシュタイン距離の最大許容値
    fuzzyMinLength: 3,       // ファジー検索を適用する最小検索語長
  },
};

function loadConfig() {
  let fileConfig = {};

  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      fileConfig = ini.parse(raw);
    }
  } catch (err) {
    console.warn('Failed to load wordbox.ini:', err.message);
  }

  // デフォルト → ini ファイル → 環境変数の優先順位でマージ
  const config = {
    server: {
      port: toInt(process.env.WORDBOX_PORT || fileConfig.server?.port) || DEFAULTS.server.port,
      host: process.env.WORDBOX_HOST || fileConfig.server?.host || DEFAULTS.server.host,
    },
    content: {
      postsDir: fileConfig.content?.postsDir || DEFAULTS.content.postsDir,
      topicsDir: fileConfig.content?.topicsDir || DEFAULTS.content.topicsDir,
      dictionaryDir: fileConfig.content?.dictionaryDir || DEFAULTS.content.dictionaryDir,
      magazinesDir: fileConfig.content?.magazinesDir || DEFAULTS.content.magazinesDir,
      snippetsFile: fileConfig.content?.snippetsFile || DEFAULTS.content.snippetsFile,
    },
    admin: {
      password: process.env.WORDBOX_ADMIN_PASSWORD || fileConfig.admin?.password || DEFAULTS.admin.password,
      sessionExpireHours: toInt(fileConfig.admin?.sessionExpireHours) || DEFAULTS.admin.sessionExpireHours,
    },
    search: {
      snippetLength: toInt(fileConfig.search?.snippetLength) || DEFAULTS.search.snippetLength,
      snippetContext: toInt(fileConfig.search?.snippetContext) || DEFAULTS.search.snippetContext,
      fuzzyThreshold: toInt(fileConfig.search?.fuzzyThreshold) ?? DEFAULTS.search.fuzzyThreshold,
      fuzzyMinLength: toInt(fileConfig.search?.fuzzyMinLength) || DEFAULTS.search.fuzzyMinLength,
    },
  };

  return config;
}

function toInt(val) {
  if (val === undefined || val === null) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

// シングルトンとしてエクスポート
const config = loadConfig();

module.exports = config;
