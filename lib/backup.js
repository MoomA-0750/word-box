// tar ベースのコンテンツバックアップ/エクスポート機能
//
// content/ ディレクトリ全体を tar.gz に圧縮してエクスポートする。
// 管理画面の API エンドポイントから呼び出す。

const tar = require('tar');
const path = require('path');
const fs = require('fs-extra');
const { createLogger } = require('./logger');

const log = createLogger('backup');

/**
 * content/ ディレクトリを tar.gz にバックアップ
 * @param {string} contentDir - コンテンツのルートディレクトリ（デフォルト: './content'）
 * @param {string} outputDir - 出力先ディレクトリ（デフォルト: './backups'）
 * @returns {Promise<{filename: string, path: string, size: number}>}
 */
async function createBackup(contentDir = './content', outputDir = './backups') {
  await fs.ensureDir(outputDir);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `wordbox-backup-${timestamp}.tar.gz`;
  const outputPath = path.join(outputDir, filename);

  log.log(`Creating backup: ${filename}`);
  const startTime = Date.now();

  await tar.create(
    {
      gzip: true,
      file: outputPath,
      cwd: path.dirname(contentDir),
    },
    [path.basename(contentDir)]
  );

  const stats = await fs.stat(outputPath);
  log.timedLog(`Backup created: ${filename} (${formatBytes(stats.size)})`, startTime);

  return {
    filename,
    path: outputPath,
    size: stats.size,
  };
}

/**
 * バックアップ一覧を取得
 * @param {string} outputDir - バックアップディレクトリ
 * @returns {Promise<{filename: string, size: number, created: Date}[]>}
 */
async function listBackups(outputDir = './backups') {
  if (!await fs.pathExists(outputDir)) return [];

  const files = await fs.readdir(outputDir);
  const backups = [];

  for (const file of files) {
    if (!file.endsWith('.tar.gz')) continue;
    const filePath = path.join(outputDir, file);
    const stats = await fs.stat(filePath);
    backups.push({
      filename: file,
      size: stats.size,
      created: stats.mtime,
    });
  }

  backups.sort((a, b) => b.created - a.created);
  return backups;
}

/**
 * バイト数を読みやすい形式に変換
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

module.exports = { createBackup, listBackups, formatBytes };
