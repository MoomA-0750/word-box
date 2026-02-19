// lib/syntax-highlight.js
// GitHub Desktop 同梱の CodeMirror を Node.js 上で使い、
// コードブロックをシンタックスハイライト済みHTMLに変換する。

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// CodeMirror の API を保持するオブジェクト
let cmAPI = null;

// 言語名 → 拡張子マッピング
const LANG_EXT_MAP = {
  'javascript': '.js', 'js': '.js',
  'typescript': '.ts', 'ts': '.ts',
  'json': '.json',
  'tsx': '.tsx', 'jsx': '.jsx',
  'html': '.html', 'htm': '.htm',
  'css': '.css', 'scss': '.scss', 'less': '.less',
  'vue': '.vue',
  'markdown': '.md', 'md': '.md',
  'yaml': '.yaml', 'yml': '.yml',
  'xml': '.xml', 'svg': '.svg',
  'csharp': '.cs', 'cs': '.cs',
  'java': '.java',
  'kotlin': '.kt', 'kt': '.kt',
  'c': '.c', 'cpp': '.cpp', 'c++': '.cpp',
  'objectivec': '.m', 'objc': '.m',
  'scala': '.scala',
  'swift': '.swift',
  'python': '.py', 'py': '.py',
  'ruby': '.rb', 'rb': '.rb',
  'go': '.go',
  'rust': '.rs', 'rs': '.rs',
  'elixir': '.ex', 'ex': '.ex',
  'haxe': '.hx',
  'r': '.r',
  'perl': '.pl', 'pl': '.pl',
  'php': '.php',
  'sql': '.sql',
  'shell': '.sh', 'bash': '.sh', 'sh': '.sh',
  'coffeescript': '.coffee',
  'clojure': '.clj',
  'ocaml': '.ml', 'fsharp': '.fs',
  'cypher': '.cql',
  'jsp': '.jsp',
  'text': null,
};

// 拡張子 → MIME マッピング（highlighter.js 内と同じ）
const EXT_MIME_MAP = {
  '.ts': 'text/typescript',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.coffee': 'text/x-coffeescript',
  '.tsx': 'text/typescript-jsx',
  '.jsx': 'text/jsx',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.jsp': 'application/x-jsp',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  '.vue': 'text/x-vue',
  '.md': 'text/x-markdown',
  '.markdown': 'text/x-markdown',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.xml': 'text/xml',
  '.svg': 'text/xml',
  '.m': 'text/x-objectivec',
  '.scala': 'text/x-scala',
  '.cs': 'text/x-csharp',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++src',
  '.hpp': 'text/x-c++src',
  '.kt': 'text/x-kotlin',
  '.ml': 'text/x-ocaml',
  '.fs': 'text/x-fsharp',
  '.swift': 'text/x-swift',
  '.sh': 'text/x-sh',
  '.sql': 'text/x-sql',
  '.cql': 'application/x-cypher-query',
  '.go': 'text/x-go',
  '.pl': 'text/x-perl',
  '.php': 'application/x-httpd-php',
  '.py': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.clj': 'text/x-clojure',
  '.rs': 'text/x-rustsrc',
  '.ex': 'text/x-elixir',
  '.exs': 'text/x-elixir',
  '.hx': 'text/x-haxe',
  '.r': 'text/x-rsrc',
};

/**
 * CodeMirror のモード定義を読み込む（初回のみ）
 */
function initCodeMirror() {
  if (cmAPI) return; // すでに初期化済み

  const highlighterPath = path.resolve(__dirname, '..', 'static', 'highlighter.js');
  const commonPath = path.resolve(__dirname, '..', 'static', 'highlighter', 'common.js');

  const highlighterCode = fs.readFileSync(highlighterPath, 'utf8');
  const commonCode = fs.readFileSync(commonPath, 'utf8');

  // Worker グローバルスコープをエミュレート
  const workerGlobal = {
    self: null,
    postMessage: function() {},
    importScripts: function() {
      // highlighter.js 内部から呼ばれる importScripts("highlighter/common.js") を処理
      vm.runInContext(commonCode, ctx);
    },
    console: console,
    Promise: Promise,
    Set: Set,
    Map: Map,
    Object: Object,
    Array: Array,
    Error: Error,
    Math: Math,
    String: String,
    Number: Number,
    RegExp: RegExp,
    JSON: JSON,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    isFinite: isFinite,
    undefined: undefined,
    Infinity: Infinity,
    NaN: NaN,
  };
  workerGlobal.self = workerGlobal;

  const ctx = vm.createContext(workerGlobal);

  // highlighter.js を実行（CodeMirror のモード定義が登録される）
  vm.runInContext(highlighterCode, ctx);

  // テストメッセージを送ってモードの読み込みをトリガー
  // onmessage を直接呼んで全言語モードを登録させる
  if (typeof workerGlobal.onmessage === 'function') {
    // ダミーの呼び出しで common.js のモード定義をロードさせる
    workerGlobal.postMessage = function() {}; // 結果を無視
    workerGlobal.onmessage({ data: { extension: '.js', contents: '', tabSize: 4, addModeClass: false } });
  }

  // CodeMirror API を取得（webpack モジュールキャッシュから）
  // highlighter.js 内の webpack exports からCodeMirror APIを探す
  const moduleCache = workerGlobal.self;

  // runMode と getMode は c(0).exports に存在する
  // webpack のモジュールキャッシュを走査
  let foundAPI = null;
  if (ctx.require) {
    // require は存在しない（webpackバンドル）
  }

  // onmessage は async 関数だが、importScripts が同期的に解決されるため
  // Node.js 環境では実質同期で完了する。同期版と非同期版の両方を用意する。
  cmAPI = {
    // 非同期版
    highlightAsync: async function(code, extension) {
      const mime = EXT_MIME_MAP[extension];
      if (!mime) return null;

      let result = null;
      workerGlobal.postMessage = function(tokenMap) {
        result = tokenMap;
      };

      if (typeof workerGlobal.onmessage === 'function') {
        await workerGlobal.onmessage({
          data: { extension, contents: code, tabSize: 4, addModeClass: false }
        });
      }

      return result;
    },

    // 同期版（初回呼び出しで common.js がロード済みなら同期で動く）
    highlightSync: function(code, extension) {
      const mime = EXT_MIME_MAP[extension];
      if (!mime) return null;

      let result = null;
      workerGlobal.postMessage = function(tokenMap) {
        result = tokenMap;
      };

      if (typeof workerGlobal.onmessage === 'function') {
        // async 関数を呼ぶが、importScripts は同期なので
        // Promise が同期的に解決される（microqueue で postMessage が呼ばれる）
        workerGlobal.onmessage({
          data: { extension, contents: code, tabSize: 4, addModeClass: false }
        });
      }

      return result;
    }
  };

  // 初回に common.js をロードさせるため、ダミー呼び出し（await する）
  if (typeof workerGlobal.onmessage === 'function') {
    const dummyPromise = workerGlobal.onmessage({
      data: { extension: '.js', contents: '', tabSize: 4, addModeClass: false }
    });
    // common.js のロードは importScripts で同期なので、ここで完了している
  }

  console.log('Syntax highlighter initialized.');
}

/**
 * HTMLエスケープ
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * コードをハイライトしてHTMLに変換する
 * @param {string} code - ソースコード
 * @param {string} language - 言語名（例: 'javascript'）
 * @returns {string} ハイライト済みHTML
 */
async function highlightCode(code, language) {
  initCodeMirror();

  const langLower = (language || '').toLowerCase();
  const extension = LANG_EXT_MAP[langLower];
  if (!extension) {
    // 対応言語でなければプレーンテキストを返す
    return escapeHtml(code);
  }

  try {
    const tokenMap = await cmAPI.highlightAsync(code, extension);
    if (!tokenMap || Object.keys(tokenMap).length === 0) {
      return escapeHtml(code);
    }

    return applyTokenMap(code, tokenMap);
  } catch (e) {
    console.error('Highlight error:', e.message);
    return escapeHtml(code);
  }
}

/**
 * トークンマップを適用してHTMLを生成
 */
function applyTokenMap(code, tokenMap) {
  const lines = code.split('\n');
  const htmlLines = lines.map((line, lineIdx) => {
    const lineTokens = tokenMap[lineIdx];
    if (!lineTokens) {
      return escapeHtml(line);
    }

    const positions = Object.keys(lineTokens).map(Number).sort((a, b) => a - b);
    let result = '';
    let cursor = 0;

    for (const start of positions) {
      const { length, token } = lineTokens[start];
      if (cursor < start) {
        result += escapeHtml(line.slice(cursor, start));
      }
      const classes = token.split(' ').map(t => 'cm-' + t).join(' ');
      result += `<span class="${classes}">${escapeHtml(line.slice(start, start + length))}</span>`;
      cursor = start + length;
    }

    if (cursor < line.length) {
      result += escapeHtml(line.slice(cursor));
    }

    return result;
  });

  return htmlLines.join('\n');
}

module.exports = { highlightCode };
