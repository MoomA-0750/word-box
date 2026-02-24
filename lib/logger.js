// debug + ms + chalk ベースの構造化ロギングモジュール
//
// 使い方:
//   DEBUG=wordbox:* node server.js   ← 全ログを表示
//   DEBUG=wordbox:server node server.js ← サーバーログのみ
//   (DEBUG 未設定時は常に console.log / console.error で出力)
//
// chalk (ESM) を動的 import で非同期読み込み。
// 読み込み完了前のログはプレーンテキストで出力される。

const debug = require('debug');
const ms = require('ms');

// chalk を非同期で読み込み（ESM モジュールのため）
let chalk = null;
const chalkReady = import('chalk').then(m => {
  chalk = m.default;
}).catch(() => {
  // chalk が読み込めない場合はプレーンテキストで出力
  chalk = null;
});

// 名前空間ごとの色を決定（ハッシュベース）
const NAMESPACE_COLORS = ['cyan', 'green', 'yellow', 'blue', 'magenta'];
function getNamespaceColor(namespace) {
  let hash = 0;
  for (let i = 0; i < namespace.length; i++) {
    hash = ((hash << 5) - hash) + namespace.charCodeAt(i);
    hash |= 0;
  }
  return NAMESPACE_COLORS[Math.abs(hash) % NAMESPACE_COLORS.length];
}

// 名前空間ごとのロガーを生成
function createLogger(namespace) {
  const d = debug(`wordbox:${namespace}`);
  const nsColor = getNamespaceColor(namespace);

  function formatPrefix() {
    if (chalk) {
      const colorFn = chalk[nsColor] || chalk.white;
      return colorFn(`[${namespace}]`);
    }
    return `[${namespace}]`;
  }

  // debug が有効でない場合でも最低限の出力を保証するラッパー
  function log(message, ...args) {
    if (d.enabled) {
      d(message, ...args);
    } else {
      console.log(`${formatPrefix()} ${message}`, ...args);
    }
  }

  function error(message, ...args) {
    // エラーは常に出力（赤色）
    const prefix = chalk ? chalk.red(`[${namespace}] ERROR:`) : `[${namespace}] ERROR:`;
    console.error(`${prefix} ${message}`, ...args);
  }

  function warn(message, ...args) {
    if (d.enabled) {
      d('WARN: ' + message, ...args);
    } else {
      const prefix = chalk ? chalk.yellow(`[${namespace}] WARN:`) : `[${namespace}] WARN:`;
      console.warn(`${prefix} ${message}`, ...args);
    }
  }

  // リクエスト処理時間の計測ヘルパー
  function timedLog(label, startTime) {
    const elapsed = Date.now() - startTime;
    const timeStr = ms(elapsed);
    const coloredTime = chalk
      ? (elapsed > 1000 ? chalk.red(timeStr) : elapsed > 100 ? chalk.yellow(timeStr) : chalk.green(timeStr))
      : timeStr;
    log(`${label} (${coloredTime})`);
  }

  return { log, error, warn, timedLog, debug: d };
}

// chalk の読み込み完了を待つための Promise をエクスポート
module.exports = { createLogger, chalkReady };
