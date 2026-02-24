// micromatch + graceful-fs を使ったファイル操作ユーティリティ
//
// fs-extra の代わりに graceful-fs を内部で使うことで、
// EMFILE (too many open files) エラーを防止しつつ
// micromatch でディレクトリ内のファイルをパターンマッチングで絞り込める。

const fs = require('graceful-fs');
const fsExtra = require('fs-extra');
const path = require('path');
const micromatch = require('micromatch');
const { createLogger } = require('./logger');

const log = createLogger('files');

/**
 * ディレクトリ内のファイルを glob パターンで絞り込んで返す
 * @param {string} dir - 対象ディレクトリ
 * @param {string|string[]} pattern - micromatch パターン（例: '*.md', '*.{md,txt}'）
 * @returns {Promise<string[]>} マッチしたファイル名の配列
 */
async function listFiles(dir, pattern = '*') {
  if (!await fsExtra.pathExists(dir)) return [];

  const allFiles = await fsExtra.readdir(dir);
  return micromatch(allFiles, pattern);
}

/**
 * ディレクトリ内のマッチするファイルを全て読み込む
 * @param {string} dir - 対象ディレクトリ
 * @param {string|string[]} pattern - micromatch パターン
 * @returns {Promise<{filename: string, content: string}[]>}
 */
async function readMatchingFiles(dir, pattern = '*.md') {
  const files = await listFiles(dir, pattern);
  const results = await Promise.all(
    files.map(async (filename) => {
      const content = await fsExtra.readFile(path.join(dir, filename), 'utf8');
      return { filename, content };
    })
  );
  return results;
}

/**
 * ファイルを安全に書き込む（ディレクトリがなければ自動作成）
 * mkdirp の代わりに fs-extra.ensureDir を使用（内部で mkdirp 相当の処理）
 * @param {string} filePath - 書き込み先パス
 * @param {*} data - 書き込むデータ
 * @param {string} encoding - エンコーディング（デフォルト: 'utf8'）
 */
async function safeWriteFile(filePath, data, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  await fsExtra.ensureDir(dir);
  await fsExtra.writeFile(filePath, data, encoding);
}

/**
 * 画像やアップロードファイルの拡張子をチェック
 * @param {string} filename - ファイル名
 * @param {string[]} allowedPatterns - 許可するパターン配列（例: ['*.png','*.jpg']）
 * @returns {boolean}
 */
function isAllowedFile(filename, allowedPatterns) {
  return micromatch.isMatch(filename, allowedPatterns);
}

module.exports = {
  listFiles,
  readMatchingFiles,
  safeWriteFile,
  isAllowedFile,
};
