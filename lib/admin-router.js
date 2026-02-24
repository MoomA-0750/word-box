// lib/admin-router.js
// 管理画面用ルーター

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { parseFrontMatter } = require('./frontmatter');
const { parseMarkdown } = require('./markdown');
const auth = require('./admin-auth');
const snippets = require('./snippets');

// コンテンツディレクトリ
const CONTENT_DIRS = {
  posts: './content/posts',
  topics: './content/topics',
  magazines: './content/magazines',
  dictionary: './content/dictionary'
};
const IMAGES_DIR = './static/images';
const IMAGE_METADATA_FILE = './static/images/metadata.json';
const FILES_DIR = './static/files';
const FILE_METADATA_FILE = './static/files/metadata.json';

// テンプレートキャッシュ
let loginTemplate = null;
let dashboardTemplate = null;

// テンプレート読み込み
async function loadAdminTemplates() {
  loginTemplate = await fs.readFile('./templates/admin/login.html', 'utf8');
  dashboardTemplate = await fs.readFile('./templates/admin/dashboard.html', 'utf8');
}

// JSONレスポンス送信
function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// エラーレスポンス送信
function sendError(res, message, status = 400) {
  sendJson(res, { error: message }, status);
}

// リクエストボディをパース
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      // 10MB制限
      if (body.length > 10 * 1024 * 1024) {
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// マルチパートデータをパース（画像アップロード用）
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
      return reject(new Error('No boundary found'));
    }
    const boundary = boundaryMatch[1];

    const chunks = [];
    let aborted = false;

    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      if (aborted) return;
      const buffer = Buffer.concat(chunks);
      const parts = [];
      const boundaryBuffer = Buffer.from(`--${boundary}`);

      let start = 0;
      let pos = buffer.indexOf(boundaryBuffer, start);

      while (pos !== -1) {
        const nextPos = buffer.indexOf(boundaryBuffer, pos + boundaryBuffer.length);
        if (nextPos === -1) break;

        const partBuffer = buffer.slice(pos + boundaryBuffer.length + 2, nextPos - 2);
        const headerEnd = partBuffer.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
          const headers = partBuffer.slice(0, headerEnd).toString();
          const content = partBuffer.slice(headerEnd + 4);

          const nameMatch = headers.match(/name="([^"]+)"/);
          const filenameMatch = headers.match(/filename="([^"]+)"/);
          const contentTypeMatch = headers.match(/Content-Type:\s*(.+)/i);

          parts.push({
            name: nameMatch ? nameMatch[1] : '',
            filename: filenameMatch ? filenameMatch[1] : null,
            contentType: contentTypeMatch ? contentTypeMatch[1].trim() : null,
            data: content
          });
        }

        pos = nextPos;
      }

      resolve(parts);
    });
    req.on('error', (err) => {
      aborted = true;
      reject(err);
    });
    req.on('aborted', () => {
      aborted = true;
      reject(new Error('Request aborted by client'));
    });
    // Node.js v25+: 'close' event fires on early disconnect
    req.on('close', () => {
      if (!req.complete && !aborted) {
        aborted = true;
        reject(new Error('Request closed before completion'));
      }
    });
  });
}

// 記事一覧を取得
async function getArticles(type) {
  const dir = CONTENT_DIRS[type];
  if (!dir || !await fs.pathExists(dir)) {
    return [];
  }

  const files = await fs.readdir(dir);
  const articles = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const content = await fs.readFile(path.join(dir, file), 'utf8');
    const { metadata, content: body } = parseFrontMatter(content);

    articles.push({
      id: file.replace('.md', ''),
      filename: file,
      title: metadata.title || 'Untitled',
      date: metadata.date || '',
      emoji: metadata.emoji || (type === 'magazines' ? '📚' : type === 'dictionary' ? '📖' : '📄'),
      tags: metadata.tags || [],
      listed: metadata.listed !== false,
      quicklook: metadata.quicklook || '',
      description: metadata.description || '',
      articles: metadata.articles || [],
      bodyLength: body.length
    });
  }

  // 日付でソート
  articles.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return articles;
}

// 記事詳細を取得
async function getArticle(type, id) {
  const dir = CONTENT_DIRS[type];
  const filePath = path.join(dir, `${id}.md`);

  if (!await fs.pathExists(filePath)) {
    return null;
  }

  const content = await fs.readFile(filePath, 'utf8');
  const { metadata, content: body } = parseFrontMatter(content);

  return {
    id,
    filename: `${id}.md`,
    metadata,
    body
  };
}

// 記事を保存
async function saveArticle(type, id, metadata, body) {
  const dir = CONTENT_DIRS[type];
  await fs.ensureDir(dir);

  // Front Matterを生成
  let frontMatter = '---\n';
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      frontMatter += `${key}: ${JSON.stringify(value)}\n`;
    } else if (typeof value === 'boolean') {
      frontMatter += `${key}: ${value}\n`;
    } else {
      frontMatter += `${key}: ${value}\n`;
    }
  }
  frontMatter += '---\n\n';

  const content = frontMatter + body;
  const filePath = path.join(dir, `${id}.md`);

  await fs.writeFile(filePath, content, 'utf8');
  return { id, filename: `${id}.md` };
}

// 記事を削除
async function deleteArticle(type, id) {
  const dir = CONTENT_DIRS[type];
  const filePath = path.join(dir, `${id}.md`);

  if (!await fs.pathExists(filePath)) {
    return false;
  }

  await fs.remove(filePath);
  return true;
}

// 記事をリネーム（ID変更）
async function renameArticle(type, oldId, newId) {
  const dir = CONTENT_DIRS[type];
  const oldPath = path.join(dir, `${oldId}.md`);
  const newPath = path.join(dir, `${newId}.md`);

  if (!await fs.pathExists(oldPath)) {
    return { error: 'Source file not found' };
  }
  if (await fs.pathExists(newPath)) {
    return { error: 'Target file already exists' };
  }

  await fs.rename(oldPath, newPath);
  return { id: newId, filename: `${newId}.md` };
}

// 画像メタデータを読み込み
async function loadImageMetadata() {
  try {
    if (await fs.pathExists(IMAGE_METADATA_FILE)) {
      const data = await fs.readFile(IMAGE_METADATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load image metadata:', err);
  }
  return {};
}

// 画像メタデータを保存
async function saveImageMetadata(metadata) {
  await fs.ensureDir(IMAGES_DIR);
  await fs.writeFile(IMAGE_METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf8');
}

// 画像一覧を取得
async function getImages() {
  await fs.ensureDir(IMAGES_DIR);
  const files = await fs.readdir(IMAGES_DIR);
  const metadata = await loadImageMetadata();
  const images = [];

  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!imageExtensions.includes(ext)) continue;

    const filePath = path.join(IMAGES_DIR, file);
    const stats = await fs.stat(filePath);

    const meta = metadata[file] || {};

    images.push({
      filename: file,
      url: `/static/images/${file}`,
      size: stats.size,
      modified: stats.mtime,
      name: meta.name || '',
      tags: meta.tags || [],
      description: meta.description || '',
      alt: meta.alt || '',
      originalFilename: meta.originalFilename || file
    });
  }

  // 更新日時でソート（新しい順）
  images.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return images;
}

// 画像をアップロード
async function uploadImage(filename, data) {
  await fs.ensureDir(IMAGES_DIR);

  // ファイル名をサニタイズしてUUIDベースに
  const ext = path.extname(filename).toLowerCase();
  const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

  if (!allowedExtensions.includes(ext)) {
    return { error: 'Invalid file type' };
  }

  const newFilename = `${uuidv4()}${ext}`;
  const filePath = path.join(IMAGES_DIR, newFilename);

  await fs.writeFile(filePath, data);

  // メタデータを保存
  const metadata = await loadImageMetadata();
  metadata[newFilename] = {
    name: '',
    tags: [],
    description: '',
    alt: '',
    originalFilename: filename,
    uploadedAt: new Date().toISOString()
  };
  await saveImageMetadata(metadata);

  return {
    filename: newFilename,
    url: `/static/images/${newFilename}`,
    originalFilename: filename
  };
}

// 画像を削除
async function deleteImage(filename) {
  // ディレクトリトラバーサル防止
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { error: 'Invalid filename' };
  }

  const filePath = path.join(IMAGES_DIR, filename);

  if (!await fs.pathExists(filePath)) {
    return { error: 'File not found' };
  }

  await fs.remove(filePath);

  // メタデータからも削除
  const metadata = await loadImageMetadata();
  delete metadata[filename];
  await saveImageMetadata(metadata);

  return { success: true };
}

// 画像メタデータを更新
async function updateImageMetadata(filename, updates) {
  // ディレクトリトラバーサル防止
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { error: 'Invalid filename' };
  }

  const filePath = path.join(IMAGES_DIR, filename);
  if (!await fs.pathExists(filePath)) {
    return { error: 'File not found' };
  }

  const metadata = await loadImageMetadata();

  // 既存のメタデータとマージ
  metadata[filename] = {
    ...metadata[filename],
    name: updates.name || '',
    tags: updates.tags || [],
    description: updates.description || '',
    alt: updates.alt || ''
  };

  await saveImageMetadata(metadata);
  return { success: true, metadata: metadata[filename] };
}

// ファイルメタデータを読み込み
async function loadFileMetadata() {
  try {
    if (await fs.pathExists(FILE_METADATA_FILE)) {
      const data = await fs.readFile(FILE_METADATA_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load file metadata:', err);
  }
  return {};
}

// ファイルメタデータを保存
async function saveFileMetadata(metadata) {
  await fs.ensureDir(FILES_DIR);
  await fs.writeFile(FILE_METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf8');
}

// ファイル一覧を取得
async function getFiles() {
  await fs.ensureDir(FILES_DIR);
  const files = await fs.readdir(FILES_DIR);
  const metadata = await loadFileMetadata();
  const fileList = [];

  for (const file of files) {
    if (file === 'metadata.json') continue;

    const filePath = path.join(FILES_DIR, file);
    const stats = await fs.stat(filePath);

    const meta = metadata[file] || {};

    fileList.push({
      filename: file,
      url: `/static/files/${file}`,
      size: stats.size,
      modified: stats.mtime,
      name: meta.name || '',
      tags: meta.tags || [],
      description: meta.description || '',
      originalFilename: meta.originalFilename || file
    });
  }

  // 更新日時でソート（新しい順）
  fileList.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return fileList;
}

// ファイルをアップロード
async function uploadFile(filename, data) {
  await fs.ensureDir(FILES_DIR);

  // ファイル名をサニタイズしてUUIDベースに
  const ext = path.extname(filename).toLowerCase();
  const baseName = path.basename(filename, ext);

  const newFilename = `${uuidv4()}${ext}`;
  const filePath = path.join(FILES_DIR, newFilename);

  await fs.writeFile(filePath, data);

  // メタデータを保存
  const metadata = await loadFileMetadata();
  metadata[newFilename] = {
    name: '',
    tags: [],
    description: '',
    originalFilename: filename,
    uploadedAt: new Date().toISOString()
  };
  await saveFileMetadata(metadata);

  return {
    filename: newFilename,
    url: `/static/files/${newFilename}`,
    originalFilename: filename
  };
}

// ファイルを削除
async function deleteFile(filename) {
  // ディレクトリトラバーサル防止
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { error: 'Invalid filename' };
  }

  const filePath = path.join(FILES_DIR, filename);

  if (!await fs.pathExists(filePath)) {
    return { error: 'File not found' };
  }

  await fs.remove(filePath);

  // メタデータからも削除
  const metadata = await loadFileMetadata();
  delete metadata[filename];
  await saveFileMetadata(metadata);

  return { success: true };
}

// ファイルメタデータを更新
async function updateFileMetadata(filename, updates) {
  // ディレクトリトラバーサル防止
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { error: 'Invalid filename' };
  }

  const filePath = path.join(FILES_DIR, filename);
  if (!await fs.pathExists(filePath)) {
    return { error: 'File not found' };
  }

  const metadata = await loadFileMetadata();

  // 既存のメタデータとマージ
  metadata[filename] = {
    ...metadata[filename],
    name: updates.name || '',
    tags: updates.tags || [],
    description: updates.description || ''
  };

  await saveFileMetadata(metadata);
  return { success: true, metadata: metadata[filename] };
}

// タグ一覧を取得
async function getTags() {
  const tagCounts = {};

  for (const type of ['posts', 'topics']) {
    const articles = await getArticles(type);
    for (const article of articles) {
      for (const tag of article.tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }
  }

  return Object.entries(tagCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

// 管理画面ルーターのハンドラ
async function handleAdminRequest(req, res, urlPath, rebuildSearchIndex) {
  const method = req.method;

  // テンプレートが未読み込みなら読み込む
  if (!loginTemplate || !dashboardTemplate) {
    await loadAdminTemplates();
  }

  // 認証チェック（ログインページ以外）
  const sessionId = auth.getSessionIdFromCookie(req.headers.cookie);
  const isAuthenticated = auth.validateSession(sessionId);

  // ログインページ
  if (urlPath === '/admin/login') {
    if (method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(loginTemplate);
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      if (auth.verifyPassword(body.password)) {
        const newSessionId = auth.createSession();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': auth.createSessionCookie(newSessionId)
        });
        return res.end(JSON.stringify({ success: true }));
      }
      return sendError(res, 'Invalid password', 401);
    }
  }

  // ログアウト
  if (urlPath === '/admin/logout') {
    if (sessionId) auth.destroySession(sessionId);
    res.writeHead(302, {
      'Location': '/admin/login',
      'Set-Cookie': auth.createLogoutCookie()
    });
    return res.end();
  }

  // 認証が必要なページ
  if (!isAuthenticated) {
    if (urlPath.startsWith('/admin/api/')) {
      return sendError(res, 'Unauthorized', 401);
    }
    res.writeHead(302, { 'Location': '/admin/login' });
    return res.end();
  }

  // 管理画面トップ
  if (urlPath === '/admin' || urlPath === '/admin/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(dashboardTemplate);
  }

  // API: 記事一覧
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines|dictionary)$/) && method === 'GET') {
    const type = urlPath.split('/')[3];
    const articles = await getArticles(type);
    return sendJson(res, articles);
  }

  // API: 記事詳細
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines|dictionary)\/[^/]+$/) && method === 'GET') {
    const parts = urlPath.split('/');
    const type = parts[3];
    const id = decodeURIComponent(parts[4]);
    const article = await getArticle(type, id);
    if (!article) {
      return sendError(res, 'Not found', 404);
    }
    return sendJson(res, article);
  }

  // API: 記事作成
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines|dictionary)$/) && method === 'POST') {
    const type = urlPath.split('/')[3];
    const body = await parseBody(req);

    // 新規IDを生成（UUIDベース）
    const id = body.id || uuidv4();

    const result = await saveArticle(type, id, body.metadata || {}, body.body || '');

    // 検索インデックスを再構築
    if (rebuildSearchIndex) await rebuildSearchIndex();

    return sendJson(res, result, 201);
  }

  // API: 記事更新
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines|dictionary)\/[^/]+$/) && method === 'PUT') {
    const parts = urlPath.split('/');
    const type = parts[3];
    const id = decodeURIComponent(parts[4]);
    const body = await parseBody(req);

    // IDの変更があればリネーム
    if (body.newId && body.newId !== id) {
      const renameResult = await renameArticle(type, id, body.newId);
      if (renameResult.error) {
        return sendError(res, renameResult.error);
      }
      const result = await saveArticle(type, body.newId, body.metadata || {}, body.body || '');
      if (rebuildSearchIndex) await rebuildSearchIndex();
      return sendJson(res, result);
    }

    const result = await saveArticle(type, id, body.metadata || {}, body.body || '');
    if (rebuildSearchIndex) await rebuildSearchIndex();
    return sendJson(res, result);
  }

  // API: 記事削除
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines|dictionary)\/[^/]+$/) && method === 'DELETE') {
    const parts = urlPath.split('/');
    const type = parts[3];
    const id = decodeURIComponent(parts[4]);
    const success = await deleteArticle(type, id);
    if (!success) {
      return sendError(res, 'Not found', 404);
    }
    if (rebuildSearchIndex) await rebuildSearchIndex();
    return sendJson(res, { success: true });
  }

  // API: 画像一覧
  if (urlPath === '/admin/api/images' && method === 'GET') {
    const images = await getImages();
    return sendJson(res, images);
  }

  // API: 画像アップロード
  if (urlPath === '/admin/api/images' && method === 'POST') {
    try {
      const parts = await parseMultipart(req);
      const filePart = parts.find(p => p.name === 'file' && p.filename);

      if (!filePart) {
        return sendError(res, 'No file uploaded');
      }

      const result = await uploadImage(filePart.filename, filePart.data);
      if (result.error) {
        return sendError(res, result.error);
      }
      return sendJson(res, result, 201);
    } catch (err) {
      console.error('Image upload error:', err.message);
      if (!res.headersSent) {
        return sendError(res, 'Upload failed: ' + err.message, 500);
      }
      return;
    }
  }

  // API: 画像削除
  if (urlPath.match(/^\/admin\/api\/images\/[^/]+$/) && method === 'DELETE') {
    const filename = decodeURIComponent(urlPath.split('/')[4]);
    const result = await deleteImage(filename);
    if (result.error) {
      return sendError(res, result.error, 404);
    }
    return sendJson(res, result);
  }

  // API: 画像メタデータ更新
  if (urlPath.match(/^\/admin\/api\/images\/[^/]+\/metadata$/) && method === 'PUT') {
    const filename = decodeURIComponent(urlPath.split('/')[4]);
    const body = await parseBody(req);
    const result = await updateImageMetadata(filename, body);
    if (result.error) {
      return sendError(res, result.error, 404);
    }
    return sendJson(res, result);
  }

  // API: ファイル一覧
  if (urlPath === '/admin/api/files' && method === 'GET') {
    const files = await getFiles();
    return sendJson(res, files);
  }

  // API: ファイルアップロード
  if (urlPath === '/admin/api/files' && method === 'POST') {
    try {
      const parts = await parseMultipart(req);
      const filePart = parts.find(p => p.name === 'file' && p.filename);

      if (!filePart) {
        return sendError(res, 'No file uploaded');
      }

      const result = await uploadFile(filePart.filename, filePart.data);
      if (result.error) {
        return sendError(res, result.error);
      }
      return sendJson(res, result, 201);
    } catch (err) {
      console.error('File upload error:', err.message);
      if (!res.headersSent) {
        return sendError(res, 'Upload failed: ' + err.message, 500);
      }
      return;
    }
  }

  // API: ファイル削除
  if (urlPath.match(/^\/admin\/api\/files\/[^/]+$/) && method === 'DELETE') {
    const filename = decodeURIComponent(urlPath.split('/')[4]);
    const result = await deleteFile(filename);
    if (result.error) {
      return sendError(res, result.error, 404);
    }
    return sendJson(res, result);
  }

  // API: ファイルメタデータ更新
  if (urlPath.match(/^\/admin\/api\/files\/[^/]+\/metadata$/) && method === 'PUT') {
    const filename = decodeURIComponent(urlPath.split('/')[4]);
    const body = await parseBody(req);
    const result = await updateFileMetadata(filename, body);
    if (result.error) {
      return sendError(res, result.error, 404);
    }
    return sendJson(res, result);
  }

  // API: タグ一覧
  if (urlPath === '/admin/api/tags' && method === 'GET') {
    const tags = await getTags();
    return sendJson(res, tags);
  }

  // API: 検索インデックス再構築
  if (urlPath === '/admin/api/rebuild-index' && method === 'POST') {
    if (rebuildSearchIndex) await rebuildSearchIndex();
    return sendJson(res, { success: true });
  }

  // API: Markdownプレビュー
  if (urlPath === '/admin/api/preview' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const markdown = body.markdown || '';
      const expandedMarkdown = snippets.expandSnippets(markdown);
      const html = await parseMarkdown(expandedMarkdown);
      return sendJson(res, { html });
    } catch (err) {
      console.error('Preview error:', err.message);
      return sendError(res, 'Preview failed', 500);
    }
  }

  // API: スニペット一覧
  if (urlPath === '/admin/api/snippets' && method === 'GET') {
    const allSnippets = snippets.getSnippets();
    const list = Object.entries(allSnippets).map(([key, value]) => ({ key, value }));
    return sendJson(res, list);
  }

  // API: スニペット作成
  if (urlPath === '/admin/api/snippets' && method === 'POST') {
    const body = await parseBody(req);
    if (!body.key || typeof body.key !== 'string') {
      return sendError(res, 'Key is required');
    }
    if (!/^\w+$/.test(body.key)) {
      return sendError(res, 'Key must contain only alphanumeric characters and underscores');
    }
    await snippets.setSnippet(body.key, body.value || '');
    return sendJson(res, { success: true, key: body.key }, 201);
  }

  // API: スニペット更新
  if (urlPath.match(/^\/admin\/api\/snippets\/[^/]+$/) && method === 'PUT') {
    const key = decodeURIComponent(urlPath.split('/')[4]);
    const body = await parseBody(req);

    const existing = snippets.getSnippet(key);
    if (existing === null) {
      return sendError(res, 'Snippet not found', 404);
    }

    if (body.newKey && body.newKey !== key) {
      if (!/^\w+$/.test(body.newKey)) {
        return sendError(res, 'Key must contain only alphanumeric characters and underscores');
      }
      await snippets.deleteSnippet(key);
      await snippets.setSnippet(body.newKey, body.value !== undefined ? body.value : existing);
      return sendJson(res, { success: true, key: body.newKey });
    }

    await snippets.setSnippet(key, body.value !== undefined ? body.value : existing);
    return sendJson(res, { success: true, key });
  }

  // API: スニペット削除
  if (urlPath.match(/^\/admin\/api\/snippets\/[^/]+$/) && method === 'DELETE') {
    const key = decodeURIComponent(urlPath.split('/')[4]);
    const success = await snippets.deleteSnippet(key);
    if (!success) {
      return sendError(res, 'Snippet not found', 404);
    }
    return sendJson(res, { success: true });
  }

  // 404
  return sendError(res, 'Not found', 404);
}

module.exports = { handleAdminRequest };
