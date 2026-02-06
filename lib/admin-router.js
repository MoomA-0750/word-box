// lib/admin-router.js
// 管理画面用ルーター

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { parseFrontMatter } = require('./frontmatter');
const auth = require('./admin-auth');

// コンテンツディレクトリ
const CONTENT_DIRS = {
  posts: './content/posts',
  topics: './content/topics',
  magazines: './content/magazines'
};
const IMAGES_DIR = './static/images';

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
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
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
    req.on('error', reject);
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
      emoji: metadata.emoji || (type === 'magazines' ? '📚' : '📄'),
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

// 画像一覧を取得
async function getImages() {
  await fs.ensureDir(IMAGES_DIR);
  const files = await fs.readdir(IMAGES_DIR);
  const images = [];

  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!imageExtensions.includes(ext)) continue;

    const filePath = path.join(IMAGES_DIR, file);
    const stats = await fs.stat(filePath);

    images.push({
      filename: file,
      url: `/static/images/${file}`,
      size: stats.size,
      modified: stats.mtime
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
  return { success: true };
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

  // 認証チェック（ログインページ以外）
  const sessionId = auth.getSessionIdFromCookie(req.headers.cookie);
  const isAuthenticated = auth.validateSession(sessionId);

  // ログインページ
  if (urlPath === '/admin/login') {
    if (method === 'GET') {
      return serveLoginPage(res);
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
    return serveAdminPage(res);
  }

  // API: 記事一覧
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines)$/) && method === 'GET') {
    const type = urlPath.split('/')[3];
    const articles = await getArticles(type);
    return sendJson(res, articles);
  }

  // API: 記事詳細
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines)\/[^/]+$/) && method === 'GET') {
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
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines)$/) && method === 'POST') {
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
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines)\/[^/]+$/) && method === 'PUT') {
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
  if (urlPath.match(/^\/admin\/api\/(posts|topics|magazines)\/[^/]+$/) && method === 'DELETE') {
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

  // 管理画面の静的ファイル
  if (urlPath.startsWith('/admin/static/')) {
    return serveAdminStatic(res, urlPath);
  }

  // 404
  return sendError(res, 'Not found', 404);
}

// ログインページHTML
function serveLoginPage(res) {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ログイン - WordBox Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #1a1a2e;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .login-box {
      background: #16213e;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      width: 100%;
      max-width: 400px;
    }
    h1 {
      color: #e94560;
      margin-bottom: 30px;
      text-align: center;
      font-size: 24px;
    }
    .form-group {
      margin-bottom: 20px;
    }
    label {
      display: block;
      color: #a0a0a0;
      margin-bottom: 8px;
      font-size: 14px;
    }
    input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      border: 2px solid #0f3460;
      background: #0f3460;
      color: #fff;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    input[type="password"]:focus {
      outline: none;
      border-color: #e94560;
    }
    button {
      width: 100%;
      padding: 14px;
      background: #e94560;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #d63651;
    }
    .error {
      color: #ff6b6b;
      text-align: center;
      margin-top: 15px;
      font-size: 14px;
      display: none;
    }
  </style>
</head>
<body>
  <div class="login-box">
    <h1>🔐 WordBox Admin</h1>
    <form id="loginForm">
      <div class="form-group">
        <label for="password">パスワード</label>
        <input type="password" id="password" name="password" required autofocus>
      </div>
      <button type="submit">ログイン</button>
      <p class="error" id="error">パスワードが正しくありません</p>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const errorEl = document.getElementById('error');

      try {
        const res = await fetch('/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        if (res.ok) {
          window.location.href = '/admin';
        } else {
          errorEl.style.display = 'block';
        }
      } catch (err) {
        errorEl.textContent = 'エラーが発生しました';
        errorEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// 管理画面メインページHTML
function serveAdminPage(res) {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WordBox Admin</title>
  <link rel="stylesheet" href="/admin/static/admin.css">
</head>
<body>
  <div class="admin-container">
    <aside class="sidebar">
      <div class="sidebar-header">
        <h1>📦 WordBox</h1>
        <span class="badge">Admin</span>
      </div>
      <nav class="sidebar-nav">
        <a href="#" class="nav-item active" data-section="posts">📝 記事</a>
        <a href="#" class="nav-item" data-section="topics">📚 トピック</a>
        <a href="#" class="nav-item" data-section="magazines">📰 マガジン</a>
        <a href="#" class="nav-item" data-section="images">🖼️ 画像</a>
        <a href="#" class="nav-item" data-section="tags">🏷️ タグ</a>
      </nav>
      <div class="sidebar-footer">
        <a href="/" target="_blank" class="nav-item">🌐 サイトを見る</a>
        <a href="/admin/logout" class="nav-item logout">🚪 ログアウト</a>
      </div>
    </aside>

    <main class="main-content">
      <header class="main-header">
        <h2 id="sectionTitle">記事</h2>
        <div class="header-actions">
          <button class="btn btn-primary" id="newBtn">+ 新規作成</button>
          <button class="btn btn-secondary" id="rebuildBtn" title="検索インデックスを再構築">🔄 再構築</button>
        </div>
      </header>

      <div class="content-area">
        <!-- 一覧表示 -->
        <div id="listView" class="list-view">
          <div class="list-header">
            <input type="text" id="searchInput" placeholder="検索..." class="search-input">
          </div>
          <div id="itemList" class="item-list">
            <!-- 動的に生成 -->
          </div>
        </div>

        <!-- エディタ -->
        <div id="editorView" class="editor-view" style="display: none;">
          <div class="editor-header">
            <button class="btn btn-ghost" id="backBtn">← 戻る</button>
            <div class="editor-actions">
              <button class="btn btn-danger" id="deleteBtn">削除</button>
              <button class="btn btn-primary" id="saveBtn">保存</button>
            </div>
          </div>

          <div class="editor-form">
            <div class="form-row">
              <div class="form-group">
                <label>ID (ファイル名)</label>
                <input type="text" id="articleId" placeholder="例: my-first-post">
              </div>
              <div class="form-group form-group-small">
                <label>絵文字</label>
                <input type="text" id="articleEmoji" placeholder="📝">
              </div>
            </div>

            <div class="form-group">
              <label>タイトル</label>
              <input type="text" id="articleTitle" placeholder="記事タイトル">
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>日付</label>
                <input type="date" id="articleDate">
              </div>
              <div class="form-group">
                <label>タグ（カンマ区切り）</label>
                <input type="text" id="articleTags" placeholder="tag1, tag2">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label>説明 (quicklook / description)</label>
                <input type="text" id="articleDescription" placeholder="記事の簡単な説明">
              </div>
              <div class="form-group form-group-small">
                <label>公開</label>
                <label class="toggle">
                  <input type="checkbox" id="articleListed" checked>
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>

            <!-- マガジン専用: 記事リスト -->
            <div class="form-group" id="magazineArticlesGroup" style="display: none;">
              <label>収録記事（1行1スラッグ）</label>
              <textarea id="magazineArticles" rows="5" placeholder="2025-01-22-first&#10;2025-01-23-second"></textarea>
            </div>

            <div class="form-group">
              <label>本文 (Markdown)</label>
              <div class="editor-toolbar">
                <button type="button" class="toolbar-btn" data-action="bold" title="太字">B</button>
                <button type="button" class="toolbar-btn" data-action="italic" title="斜体">I</button>
                <button type="button" class="toolbar-btn" data-action="code" title="コード">&lt;/&gt;</button>
                <button type="button" class="toolbar-btn" data-action="link" title="リンク">🔗</button>
                <button type="button" class="toolbar-btn" data-action="image" title="画像">🖼️</button>
                <button type="button" class="toolbar-btn" data-action="h2" title="見出し2">H2</button>
                <button type="button" class="toolbar-btn" data-action="h3" title="見出し3">H3</button>
              </div>
              <textarea id="articleBody" rows="20" placeholder="Markdown で記述..."></textarea>
            </div>
          </div>
        </div>

        <!-- 画像管理 -->
        <div id="imagesView" class="images-view" style="display: none;">
          <div class="upload-area" id="uploadArea">
            <input type="file" id="fileInput" accept="image/*" multiple style="display: none;">
            <p>📁 ここにドラッグ＆ドロップ、またはクリックしてアップロード</p>
          </div>
          <div id="imageGrid" class="image-grid">
            <!-- 動的に生成 -->
          </div>
        </div>

        <!-- タグ管理 -->
        <div id="tagsView" class="tags-view" style="display: none;">
          <div id="tagList" class="tag-list">
            <!-- 動的に生成 -->
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- 画像選択モーダル -->
  <div id="imageModal" class="modal" style="display: none;">
    <div class="modal-content">
      <div class="modal-header">
        <h3>画像を選択</h3>
        <button class="modal-close" id="closeModal">&times;</button>
      </div>
      <div class="modal-body">
        <div id="modalImageGrid" class="image-grid modal-image-grid">
          <!-- 動的に生成 -->
        </div>
      </div>
    </div>
  </div>

  <script src="/admin/static/admin.js"></script>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// 管理画面用静的ファイルを提供
async function serveAdminStatic(res, urlPath) {
  const filename = urlPath.replace('/admin/static/', '');

  if (filename === 'admin.css') {
    res.writeHead(200, { 'Content-Type': 'text/css' });
    return res.end(getAdminCSS());
  }

  if (filename === 'admin.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(getAdminJS());
  }

  res.writeHead(404);
  res.end('Not found');
}

// 管理画面CSS
function getAdminCSS() {
  return `/* Admin CSS */
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg-dark: #0f0f1a;
  --bg-sidebar: #1a1a2e;
  --bg-main: #16213e;
  --bg-card: #1f2940;
  --bg-input: #0f3460;
  --accent: #e94560;
  --accent-hover: #d63651;
  --text-primary: #ffffff;
  --text-secondary: #a0a0a0;
  --text-muted: #666;
  --border: #2d3a4f;
  --success: #4ade80;
  --warning: #fbbf24;
  --danger: #f87171;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", sans-serif;
  background: var(--bg-dark);
  color: var(--text-primary);
  line-height: 1.6;
}

.admin-container {
  display: flex;
  min-height: 100vh;
}

/* Sidebar */
.sidebar {
  width: 240px;
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}

.sidebar-header {
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--border);
}

.sidebar-header h1 {
  font-size: 18px;
  color: var(--text-primary);
}

.badge {
  background: var(--accent);
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}

.sidebar-nav {
  flex: 1;
  padding: 16px 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all 0.2s;
  border-left: 3px solid transparent;
}

.nav-item:hover {
  background: rgba(233, 69, 96, 0.1);
  color: var(--text-primary);
}

.nav-item.active {
  background: rgba(233, 69, 96, 0.15);
  color: var(--accent);
  border-left-color: var(--accent);
}

.sidebar-footer {
  border-top: 1px solid var(--border);
  padding: 16px 0;
}

.nav-item.logout:hover {
  background: rgba(248, 113, 113, 0.1);
  color: var(--danger);
}

/* Main Content */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 30px;
  background: var(--bg-main);
  border-bottom: 1px solid var(--border);
}

.main-header h2 {
  font-size: 20px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  gap: 10px;
}

/* Buttons */
.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--bg-input);
  color: var(--text-secondary);
}

.btn-secondary:hover {
  background: var(--border);
  color: var(--text-primary);
}

.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  padding: 8px 16px;
}

.btn-ghost:hover {
  background: var(--bg-input);
  color: var(--text-primary);
}

.btn-danger {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
}

.btn-danger:hover {
  background: var(--danger);
  color: white;
}

/* Content Area */
.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px 30px;
}

/* List View */
.list-header {
  margin-bottom: 20px;
}

.search-input {
  width: 100%;
  max-width: 400px;
  padding: 12px 16px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 14px;
}

.search-input:focus {
  outline: none;
  border-color: var(--accent);
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.list-item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: var(--bg-card);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.list-item:hover {
  border-color: var(--accent);
  transform: translateX(4px);
}

.list-item-emoji {
  font-size: 32px;
  width: 48px;
  text-align: center;
}

.list-item-info {
  flex: 1;
}

.list-item-title {
  font-weight: 500;
  margin-bottom: 4px;
}

.list-item-meta {
  font-size: 13px;
  color: var(--text-muted);
  display: flex;
  gap: 12px;
}

.list-item-status {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.status-public {
  background: rgba(74, 222, 128, 0.15);
  color: var(--success);
}

.status-draft {
  background: rgba(251, 191, 36, 0.15);
  color: var(--warning);
}

/* Editor View */
.editor-view {
  max-width: 900px;
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.editor-actions {
  display: flex;
  gap: 10px;
}

.editor-form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.form-row {
  display: flex;
  gap: 20px;
}

.form-group {
  flex: 1;
}

.form-group-small {
  flex: 0 0 120px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.form-group input[type="text"],
.form-group input[type="date"],
.form-group textarea {
  width: 100%;
  padding: 12px 16px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
}

.form-group textarea {
  resize: vertical;
  min-height: 100px;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--accent);
}

#articleBody {
  font-family: 'Consolas', 'Monaco', monospace;
  min-height: 400px;
}

/* Toggle Switch */
.toggle {
  position: relative;
  display: inline-block;
  width: 50px;
  height: 26px;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-input);
  border-radius: 26px;
  transition: 0.3s;
}

.toggle-slider::before {
  content: "";
  position: absolute;
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background: var(--text-muted);
  border-radius: 50%;
  transition: 0.3s;
}

.toggle input:checked + .toggle-slider {
  background: var(--accent);
}

.toggle input:checked + .toggle-slider::before {
  transform: translateX(24px);
  background: white;
}

/* Toolbar */
.editor-toolbar {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
  padding: 8px;
  background: var(--bg-input);
  border-radius: 8px 8px 0 0;
  border: 1px solid var(--border);
  border-bottom: none;
}

.toolbar-btn {
  padding: 6px 12px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
}

.toolbar-btn:hover {
  background: var(--border);
  color: var(--text-primary);
}

#articleBody {
  border-radius: 0 0 8px 8px;
}

/* Images View */
.upload-area {
  border: 2px dashed var(--border);
  border-radius: 12px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 24px;
}

.upload-area:hover {
  border-color: var(--accent);
  background: rgba(233, 69, 96, 0.05);
}

.upload-area p {
  color: var(--text-secondary);
}

.image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}

.image-card {
  background: var(--bg-card);
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border);
  transition: all 0.2s;
}

.image-card:hover {
  border-color: var(--accent);
}

.image-card img {
  width: 100%;
  height: 120px;
  object-fit: cover;
}

.image-card-info {
  padding: 10px;
}

.image-card-name {
  font-size: 12px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
}

.image-card-actions {
  display: flex;
  gap: 8px;
}

.image-card-actions button {
  flex: 1;
  padding: 6px;
  font-size: 11px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.btn-copy {
  background: var(--bg-input);
  color: var(--text-secondary);
}

.btn-copy:hover {
  background: var(--border);
  color: var(--text-primary);
}

.btn-delete-img {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
}

.btn-delete-img:hover {
  background: var(--danger);
  color: white;
}

/* Tags View */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--bg-card);
  border-radius: 20px;
  border: 1px solid var(--border);
}

.tag-item-name {
  color: var(--text-primary);
  font-weight: 500;
}

.tag-item-count {
  background: var(--accent);
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}

/* Modal */
.modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-main);
  border-radius: 12px;
  width: 90%;
  max-width: 800px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid var(--border);
}

.modal-header h3 {
  font-size: 18px;
}

.modal-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 24px;
  cursor: pointer;
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.modal-image-grid .image-card {
  cursor: pointer;
}

.modal-image-grid .image-card:hover {
  border-color: var(--success);
}

/* Toast */
.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 16px 24px;
  background: var(--bg-card);
  border-radius: 8px;
  color: var(--text-primary);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  z-index: 1001;
  animation: slideIn 0.3s ease;
}

.toast.success {
  border-left: 4px solid var(--success);
}

.toast.error {
  border-left: 4px solid var(--danger);
}

@keyframes slideIn {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

/* Responsive */
@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    left: -240px;
    z-index: 100;
    height: 100%;
    transition: left 0.3s;
  }

  .sidebar.open {
    left: 0;
  }

  .form-row {
    flex-direction: column;
    gap: 16px;
  }

  .form-group-small {
    flex: 1;
  }
}
`;
}

// 管理画面JavaScript
function getAdminJS() {
  return `// Admin JavaScript
const state = {
  currentSection: 'posts',
  articles: [],
  images: [],
  tags: [],
  editingId: null,
  isNew: false
};

// DOM要素
const elements = {
  sectionTitle: document.getElementById('sectionTitle'),
  itemList: document.getElementById('itemList'),
  listView: document.getElementById('listView'),
  editorView: document.getElementById('editorView'),
  imagesView: document.getElementById('imagesView'),
  tagsView: document.getElementById('tagsView'),
  searchInput: document.getElementById('searchInput'),
  newBtn: document.getElementById('newBtn'),
  rebuildBtn: document.getElementById('rebuildBtn'),
  backBtn: document.getElementById('backBtn'),
  saveBtn: document.getElementById('saveBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  imageModal: document.getElementById('imageModal'),
  closeModal: document.getElementById('closeModal'),
  uploadArea: document.getElementById('uploadArea'),
  fileInput: document.getElementById('fileInput'),
  imageGrid: document.getElementById('imageGrid'),
  modalImageGrid: document.getElementById('modalImageGrid'),
  tagList: document.getElementById('tagList'),
  magazineArticlesGroup: document.getElementById('magazineArticlesGroup')
};

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  loadSection('posts');
});

// ナビゲーション設定
function setupNavigation() {
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      loadSection(section);
    });
  });
}

// イベントリスナー設定
function setupEventListeners() {
  elements.newBtn.addEventListener('click', () => createNew());
  elements.rebuildBtn.addEventListener('click', () => rebuildIndex());
  elements.backBtn.addEventListener('click', () => showList());
  elements.saveBtn.addEventListener('click', () => saveArticle());
  elements.deleteBtn.addEventListener('click', () => deleteArticle());
  elements.searchInput.addEventListener('input', () => filterList());
  elements.closeModal.addEventListener('click', () => hideModal());

  // 画像アップロード
  elements.uploadArea.addEventListener('click', () => elements.fileInput.click());
  elements.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadArea.style.borderColor = 'var(--accent)';
  });
  elements.uploadArea.addEventListener('dragleave', () => {
    elements.uploadArea.style.borderColor = '';
  });
  elements.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadArea.style.borderColor = '';
    handleFileUpload(e.dataTransfer.files);
  });
  elements.fileInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files);
  });

  // ツールバー
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => handleToolbar(btn.dataset.action));
  });
}

// セクション読み込み
async function loadSection(section) {
  state.currentSection = section;
  showList();

  const titles = {
    posts: '記事',
    topics: 'トピック',
    magazines: 'マガジン',
    images: '画像',
    tags: 'タグ'
  };
  elements.sectionTitle.textContent = titles[section];

  // ビュー切り替え
  elements.listView.style.display = ['posts', 'topics', 'magazines'].includes(section) ? 'block' : 'none';
  elements.imagesView.style.display = section === 'images' ? 'block' : 'none';
  elements.tagsView.style.display = section === 'tags' ? 'block' : 'none';
  elements.newBtn.style.display = ['posts', 'topics', 'magazines'].includes(section) ? 'inline-flex' : 'none';

  if (section === 'images') {
    await loadImages();
  } else if (section === 'tags') {
    await loadTags();
  } else {
    await loadArticles();
  }
}

// 記事一覧読み込み
async function loadArticles() {
  try {
    const res = await fetch(\`/admin/api/\${state.currentSection}\`);
    state.articles = await res.json();
    renderArticleList();
  } catch (err) {
    showToast('読み込みに失敗しました', 'error');
  }
}

// 記事一覧表示
function renderArticleList() {
  const filtered = filterArticles(state.articles);
  elements.itemList.innerHTML = filtered.map(article => \`
    <div class="list-item" data-id="\${article.id}">
      <div class="list-item-emoji">\${article.emoji}</div>
      <div class="list-item-info">
        <div class="list-item-title">\${escapeHtml(article.title)}</div>
        <div class="list-item-meta">
          <span>\${article.date || '日付なし'}</span>
          <span>\${article.id}</span>
        </div>
      </div>
      <div class="list-item-status \${article.listed ? 'status-public' : 'status-draft'}">
        \${article.listed ? '公開' : '下書き'}
      </div>
    </div>
  \`).join('');

  // クリックイベント
  elements.itemList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => editArticle(item.dataset.id));
  });
}

// 記事フィルタリング
function filterArticles(articles) {
  const query = elements.searchInput.value.toLowerCase();
  if (!query) return articles;
  return articles.filter(a =>
    a.title.toLowerCase().includes(query) ||
    a.id.toLowerCase().includes(query) ||
    (a.tags || []).some(t => t.toLowerCase().includes(query))
  );
}

function filterList() {
  renderArticleList();
}

// 新規作成
function createNew() {
  state.isNew = true;
  state.editingId = null;
  showEditor();
  clearForm();

  // デフォルト値
  document.getElementById('articleDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('articleEmoji').value = state.currentSection === 'magazines' ? '📚' : '📝';
}

// 記事編集
async function editArticle(id) {
  try {
    const res = await fetch(\`/admin/api/\${state.currentSection}/\${encodeURIComponent(id)}\`);
    if (!res.ok) throw new Error('Not found');

    const article = await res.json();
    state.isNew = false;
    state.editingId = id;
    showEditor();
    fillForm(article);
  } catch (err) {
    showToast('記事の読み込みに失敗しました', 'error');
  }
}

// エディタ表示
function showEditor() {
  elements.listView.style.display = 'none';
  elements.editorView.style.display = 'block';
  elements.deleteBtn.style.display = state.isNew ? 'none' : 'inline-flex';

  // マガジン用フィールド表示切り替え
  elements.magazineArticlesGroup.style.display = state.currentSection === 'magazines' ? 'block' : 'none';
}

// 一覧表示
function showList() {
  elements.listView.style.display = 'block';
  elements.editorView.style.display = 'none';
}

// フォームクリア
function clearForm() {
  document.getElementById('articleId').value = '';
  document.getElementById('articleTitle').value = '';
  document.getElementById('articleDate').value = '';
  document.getElementById('articleEmoji').value = '';
  document.getElementById('articleTags').value = '';
  document.getElementById('articleDescription').value = '';
  document.getElementById('articleListed').checked = true;
  document.getElementById('articleBody').value = '';
  document.getElementById('magazineArticles').value = '';
}

// フォーム入力
function fillForm(article) {
  document.getElementById('articleId').value = article.id;
  document.getElementById('articleTitle').value = article.metadata.title || '';
  document.getElementById('articleDate').value = article.metadata.date || '';
  document.getElementById('articleEmoji').value = article.metadata.emoji || '';
  document.getElementById('articleTags').value = (article.metadata.tags || []).join(', ');
  document.getElementById('articleDescription').value = article.metadata.quicklook || article.metadata.description || '';
  document.getElementById('articleListed').checked = article.metadata.listed !== false;
  document.getElementById('articleBody').value = article.body || '';

  if (state.currentSection === 'magazines') {
    document.getElementById('magazineArticles').value = (article.metadata.articles || []).join('\\n');
  }
}

// 記事保存
async function saveArticle() {
  const id = document.getElementById('articleId').value.trim();
  if (!id) {
    showToast('IDを入力してください', 'error');
    return;
  }

  const metadata = {
    title: document.getElementById('articleTitle').value,
    date: document.getElementById('articleDate').value,
    emoji: document.getElementById('articleEmoji').value,
    tags: document.getElementById('articleTags').value.split(',').map(t => t.trim()).filter(t => t),
    listed: document.getElementById('articleListed').checked
  };

  // quicklook / description
  const desc = document.getElementById('articleDescription').value;
  if (state.currentSection === 'magazines') {
    metadata.description = desc;
    metadata.articles = document.getElementById('magazineArticles').value.split('\\n').map(s => s.trim()).filter(s => s);
  } else {
    metadata.quicklook = desc;
  }

  const body = document.getElementById('articleBody').value;

  try {
    const url = state.isNew
      ? \`/admin/api/\${state.currentSection}\`
      : \`/admin/api/\${state.currentSection}/\${encodeURIComponent(state.editingId)}\`;

    const method = state.isNew ? 'POST' : 'PUT';
    const payload = state.isNew
      ? { id, metadata, body }
      : { newId: id, metadata, body };

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Save failed');

    showToast('保存しました', 'success');
    await loadArticles();
    showList();
  } catch (err) {
    showToast('保存に失敗しました', 'error');
  }
}

// 記事削除
async function deleteArticle() {
  if (!confirm('本当に削除しますか？')) return;

  try {
    const res = await fetch(\`/admin/api/\${state.currentSection}/\${encodeURIComponent(state.editingId)}\`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Delete failed');

    showToast('削除しました', 'success');
    await loadArticles();
    showList();
  } catch (err) {
    showToast('削除に失敗しました', 'error');
  }
}

// 画像読み込み
async function loadImages() {
  try {
    const res = await fetch('/admin/api/images');
    state.images = await res.json();
    renderImageGrid();
  } catch (err) {
    showToast('画像の読み込みに失敗しました', 'error');
  }
}

// 画像グリッド表示
function renderImageGrid(target = elements.imageGrid, selectable = false) {
  target.innerHTML = state.images.map(img => \`
    <div class="image-card" data-url="\${img.url}" data-filename="\${img.filename}">
      <img src="\${img.url}" alt="\${img.filename}" loading="lazy">
      <div class="image-card-info">
        <div class="image-card-name">\${img.filename}</div>
        \${!selectable ? \`
        <div class="image-card-actions">
          <button class="btn-copy" onclick="copyImageUrl('\${img.url}')">コピー</button>
          <button class="btn-delete-img" onclick="deleteImage('\${img.filename}')">削除</button>
        </div>
        \` : ''}
      </div>
    </div>
  \`).join('');

  if (selectable) {
    target.querySelectorAll('.image-card').forEach(card => {
      card.addEventListener('click', () => {
        const url = card.dataset.url;
        insertImageToEditor(url);
        hideModal();
      });
    });
  }
}

// 画像URL コピー
function copyImageUrl(url) {
  navigator.clipboard.writeText(url);
  showToast('URLをコピーしました', 'success');
}

// 画像削除
async function deleteImage(filename) {
  if (!confirm('この画像を削除しますか？')) return;

  try {
    const res = await fetch(\`/admin/api/images/\${encodeURIComponent(filename)}\`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Delete failed');

    showToast('削除しました', 'success');
    await loadImages();
  } catch (err) {
    showToast('削除に失敗しました', 'error');
  }
}

// ファイルアップロード処理
async function handleFileUpload(files) {
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/admin/api/images', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Upload failed');

      const result = await res.json();
      showToast(\`\${result.originalFilename} をアップロードしました\`, 'success');
    } catch (err) {
      showToast(\`\${file.name} のアップロードに失敗しました\`, 'error');
    }
  }

  await loadImages();
}

// タグ読み込み
async function loadTags() {
  try {
    const res = await fetch('/admin/api/tags');
    state.tags = await res.json();
    renderTagList();
  } catch (err) {
    showToast('タグの読み込みに失敗しました', 'error');
  }
}

// タグ一覧表示
function renderTagList() {
  elements.tagList.innerHTML = state.tags.map(tag => \`
    <div class="tag-item">
      <span class="tag-item-name">\${escapeHtml(tag.name)}</span>
      <span class="tag-item-count">\${tag.count}</span>
    </div>
  \`).join('');
}

// 検索インデックス再構築
async function rebuildIndex() {
  try {
    elements.rebuildBtn.disabled = true;
    elements.rebuildBtn.textContent = '⏳ 処理中...';

    const res = await fetch('/admin/api/rebuild-index', { method: 'POST' });
    if (!res.ok) throw new Error('Rebuild failed');

    showToast('検索インデックスを再構築しました', 'success');
  } catch (err) {
    showToast('再構築に失敗しました', 'error');
  } finally {
    elements.rebuildBtn.disabled = false;
    elements.rebuildBtn.textContent = '🔄 再構築';
  }
}

// ツールバー処理
function handleToolbar(action) {
  const textarea = document.getElementById('articleBody');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);

  let replacement = '';
  let cursorOffset = 0;

  switch (action) {
    case 'bold':
      replacement = \`**\${selected}**\`;
      cursorOffset = selected ? 0 : 2;
      break;
    case 'italic':
      replacement = \`*\${selected}*\`;
      cursorOffset = selected ? 0 : 1;
      break;
    case 'code':
      if (selected.includes('\\n')) {
        replacement = \`\\\`\\\`\\\`\\n\${selected}\\n\\\`\\\`\\\`\`;
      } else {
        replacement = \`\\\`\${selected}\\\`\`;
        cursorOffset = selected ? 0 : 1;
      }
      break;
    case 'link':
      replacement = \`[\${selected || 'リンクテキスト'}](url)\`;
      break;
    case 'image':
      showImageModal();
      return;
    case 'h2':
      replacement = \`## \${selected}\`;
      break;
    case 'h3':
      replacement = \`### \${selected}\`;
      break;
  }

  textarea.value = text.substring(0, start) + replacement + text.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + replacement.length - cursorOffset;
}

// 画像モーダル表示
function showImageModal() {
  elements.imageModal.style.display = 'flex';
  renderImageGrid(elements.modalImageGrid, true);
}

// モーダル非表示
function hideModal() {
  elements.imageModal.style.display = 'none';
}

// エディタに画像挿入
function insertImageToEditor(url) {
  const textarea = document.getElementById('articleBody');
  const start = textarea.selectionStart;
  const text = textarea.value;
  const imageMarkdown = \`![画像](\${url})\`;

  textarea.value = text.substring(0, start) + imageMarkdown + text.substring(start);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + imageMarkdown.length;
}

// トースト表示
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = \`toast \${type}\`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// HTMLエスケープ
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// グローバル関数として公開
window.copyImageUrl = copyImageUrl;
window.deleteImage = deleteImage;
`;
}

module.exports = { handleAdminRequest };
