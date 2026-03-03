const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const { parseFrontMatter } = require('./lib/frontmatter');
const { parseMarkdown } = require('./lib/markdown');
const searchEngine = require('./lib/search');
const { loadSnippets, expandSnippets } = require('./lib/snippets');
const { handleAdminRequest } = require('./lib/admin-router');
const { createLogger } = require('./lib/logger');
const config = require('./lib/config');
const { listFiles, readMatchingFiles } = require('./lib/files');
const ms = require('ms');
const { LRUCache } = require('lru-cache');
const tinyRelativeDate = require('tiny-relative-date');
const { onExit } = require('signal-exit');

// ロガー
const log = createLogger('server');

// LRU キャッシュ: 記事ページのレンダリング結果をキャッシュ
// maxSize 50件、TTL 5分（開発中は短めに設定）
const pageCache = new LRUCache({
  max: 50,
  ttl: 5 * 60 * 1000,
});

// LRU キャッシュ: 記事一覧の取得結果をキャッシュ
const listCache = new LRUCache({
  max: 20,
  ttl: 3 * 60 * 1000,
});

// キャッシュ無効化（記事更新時に呼ぶ）
function invalidateCache() {
  pageCache.clear();
  listCache.clear();
  log.log('Cache invalidated');
}

const PORT = config.server.port;
const CONTENT_DIRS = config.content;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

// テンプレートキャッシュ
const templates = {
  index: '',
  layout: '',
  post: '',
  search: '',
  dictionary: '',
  dictionaryEntry: ''
};

// テンプレート読み込み
async function loadTemplates() {
  log.log('Loading templates...');
  try {
    templates.index = await fs.readFile('./templates/index.html', 'utf8');
    templates.layout = await fs.readFile('./templates/layout.html', 'utf8');
    templates.post = await fs.readFile('./templates/post.html', 'utf8');
    templates.search = await fs.readFile('./templates/search.html', 'utf8');
    templates.dictionary = await fs.readFile('./templates/dictionary.html', 'utf8');
    templates.dictionaryEntry = await fs.readFile('./templates/dictionary-entry.html', 'utf8');
    log.log('Templates loaded.');
  } catch (err) {
    log.error('Error loading templates:', err);
  }
}

// 検索インデックス構築（readMatchingFiles で並列読み込み）
async function buildSearchIndex() {
  log.log('Building search index...');
  const startTime = Date.now();
  searchEngine.clear();
  invalidateCache(); // インデックス再構築時にキャッシュも無効化

  // 記事
  const postFiles = await readMatchingFiles(CONTENT_DIRS.postsDir, '*.md');
  for (const { filename, content } of postFiles) {
    const { metadata, content: body } = parseFrontMatter(content);
    if (metadata.listed === false) continue;

    searchEngine.addDocument({
      id: filename.replace('.md', ''),
      title: metadata.title || 'Untitled',
      content: body,
      tags: metadata.tags || [],
      keywords: metadata.keywords || [],
      type: 'post',
      emoji: metadata.emoji || '📄',
      date: metadata.date
    });
  }

  // トピック
  const topicFiles = await readMatchingFiles(CONTENT_DIRS.topicsDir, '*.md');
  for (const { filename, content } of topicFiles) {
    const { metadata, content: body } = parseFrontMatter(content);
    if (metadata.listed === false) continue;

    searchEngine.addDocument({
      id: filename.replace('.md', ''),
      title: metadata.title || 'Untitled',
      content: body,
      tags: metadata.tags || [],
      keywords: metadata.keywords || [],
      type: 'topic',
      emoji: metadata.emoji || '📝',
      date: metadata.date
    });
  }

  // 辞書
  const dictFiles = await readMatchingFiles(CONTENT_DIRS.dictionaryDir, '*.md');
  for (const { filename, content } of dictFiles) {
    const { metadata, content: body } = parseFrontMatter(content);
    if (metadata.listed === false) continue;

    searchEngine.addDocument({
      id: filename.replace('.md', ''),
      title: metadata.title || 'Untitled',
      content: body,
      tags: metadata.category ? [metadata.category] : [],
      type: 'dictionary',
      emoji: metadata.emoji || '📖',
      date: ''
    });
  }

  // マガジン
  const magFiles = await readMatchingFiles(CONTENT_DIRS.magazinesDir, '*.md');
  for (const { filename, content } of magFiles) {
    const { metadata, content: body } = parseFrontMatter(content);
    if (metadata.listed === false) continue;

    searchEngine.addDocument({
      id: filename.replace('.md', ''),
      title: metadata.title || 'Untitled',
      content: body,
      tags: [],
      type: 'magazine',
      emoji: metadata.emoji || '📚'
    });
  }

  log.timedLog(`Index built with ${searchEngine.documents.length} documents`, startTime);
}

// テンプレート適用
function applyTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

// 日付文字列から相対日付を生成 (tiny-relative-date)
function relativeDate(dateStr) {
  if (!dateStr) return '';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    return tinyRelativeDate(date);
  } catch {
    return '';
  }
}

// 記事一覧取得（汎用）- listFiles で micromatch ベースのフィルタリング + LRU キャッシュ
async function getPostsFromDir(dir, onlyListed = false) {
  const cacheKey = `posts:${dir}:${onlyListed}`;
  const cached = listCache.get(cacheKey);
  if (cached) return cached;

  const mdFiles = await listFiles(dir, '*.md');
  if (mdFiles.length === 0) return [];

  const posts = [];

  // Promise.all で並列読み込み
  const fileContents = await Promise.all(
    mdFiles.map(async (file) => {
      const content = await fs.readFile(path.join(dir, file), 'utf8');
      return { file, content };
    })
  );

  for (const { file, content } of fileContents) {
    const { metadata } = parseFrontMatter(content);
    const listed = metadata.listed !== false;
    if (onlyListed && !listed) continue;

    posts.push({
      slug: file.replace('.md', ''),
      title: metadata.title || 'Untitled',
      date: metadata.date || '',
      relativeDate: relativeDate(metadata.date),
      emoji: metadata.emoji || '📄',
      tags: metadata.tags || [],
      quicklook: metadata.quicklook || '',
      listed: listed,
      related: metadata.related || [],
      keywords: metadata.keywords || [],
      file: file
    });
  }

  posts.sort((a, b) => b.date.localeCompare(a.date));
  listCache.set(cacheKey, posts);
  return posts;
}

// 記事一覧取得
async function getPosts(onlyListed = false) {
  return getPostsFromDir(CONTENT_DIRS.postsDir, onlyListed);
}

// トピック一覧取得
async function getTopics(onlyListed = false) {
  return getPostsFromDir(CONTENT_DIRS.topicsDir, onlyListed);
}

// 辞書一覧取得
async function getDictionaryEntries(onlyListed = false) {
  const dir = CONTENT_DIRS.dictionaryDir;
  const mdFiles = await listFiles(dir, '*.md');
  if (mdFiles.length === 0) return [];

  const entries = [];

  const fileContents = await Promise.all(
    mdFiles.map(async (file) => {
      const content = await fs.readFile(path.join(dir, file), 'utf8');
      return { file, content };
    })
  );

  for (const { file, content } of fileContents) {
    const { metadata, content: body } = parseFrontMatter(content);
    const listed = metadata.listed !== false;
    if (onlyListed && !listed) continue;

    entries.push({
      slug: file.replace('.md', ''),
      title: metadata.title || 'Untitled',
      emoji: metadata.emoji || '📖',
      reading: metadata.reading || '',
      category: metadata.category || '',
      description: metadata.description || '',
      related: metadata.related || [],
      listed: listed
    });
  }

  entries.sort((a, b) => (a.reading || a.title).localeCompare(b.reading || b.title, 'ja'));
  return entries;
}

// マガジン一覧取得
async function getMagazines(onlyListed = false) {
  const dir = CONTENT_DIRS.magazinesDir;
  const mdFiles = await listFiles(dir, '*.md');
  if (mdFiles.length === 0) return [];

  const magazines = [];

  const fileContents = await Promise.all(
    mdFiles.map(async (file) => {
      const content = await fs.readFile(path.join(dir, file), 'utf8');
      return { file, content };
    })
  );

  for (const { file, content } of fileContents) {
    const { metadata, content: body } = parseFrontMatter(content);
    const listed = metadata.listed !== false;
    if (onlyListed && !listed) continue;

    magazines.push({
      slug: file.replace('.md', ''),
      title: metadata.title || 'Untitled',
      emoji: metadata.emoji || '📚',
      description: metadata.description || '',
      articles: metadata.articles || [],
      listed: listed,
      body: body.trim()
    });
  }

  return magazines;
}

// 特定の記事が含まれるマガジンを取得
async function getMagazineForArticle(articleSlug) {
  const magazines = await getMagazines();
  for (const magazine of magazines) {
    const index = magazine.articles.indexOf(articleSlug);
    if (index !== -1) {
      return {
        magazine,
        currentIndex: index,
        prevSlug: index > 0 ? magazine.articles[index - 1] : null,
        nextSlug: index < magazine.articles.length - 1 ? magazine.articles[index + 1] : null
      };
    }
  }
  return null;
}

// タグHTML生成
function renderTagsHtml(tags) {
  if (!tags || tags.length === 0) return '';
  return tags.map(tag =>
    `<a href="/tags/${encodeURIComponent(tag)}" class="badge rounded-pill text-decoration-none tag">${tag}</a>`
  ).join('');
}

// 記事カードHTML生成（tiny-relative-date で相対日付を表示）
function renderPostCard(post, urlPrefix) {
  const relDateHtml = post.relativeDate
    ? `<span class="text-muted small ms-1" title="${post.date}">${post.relativeDate}</span>`
    : '';
  return `<article class="card mb-3 shadow-sm post-list-item">
    <div class="card-body d-flex align-items-center gap-3 py-3">
      <div class="flex-shrink-0 lh-1" style="font-size:2.5rem">${post.emoji}</div>
      <div class="flex-grow-1">
        <h3 class="h5 mb-1"><a href="${urlPrefix}/${post.slug}" class="text-decoration-none post-title">${post.title}</a></h3>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <time class="text-muted small">${post.date}</time>${relDateHtml}
          ${renderTagsHtml(post.tags)}
        </div>
      </div>
    </div>
  </article>`;
}

// マガジン目次HTML生成（記事ページトップ用）
function renderMagazineToc(magazineInfo, allPosts) {
  if (!magazineInfo) return '';

  const { magazine, currentIndex } = magazineInfo;

  const tocItems = magazine.articles.map((articleSlug, index) => {
    const post = allPosts.find(p => p.slug === articleSlug);
    const title = post ? post.title : articleSlug;
    const isCurrent = index === currentIndex;

    if (isCurrent) {
      return `<li class="magazine-toc-item magazine-toc-current">
        <span class="magazine-toc-number">${index + 1}</span>
        <span class="magazine-toc-title">${title}</span>
        <span class="magazine-toc-reading">読んでいます</span>
      </li>`;
    } else {
      return `<li class="magazine-toc-item">
        <span class="magazine-toc-number">${index + 1}</span>
        <a href="/posts/${articleSlug}" class="magazine-toc-title">${title}</a>
      </li>`;
    }
  }).join('\n');

  return `<div class="magazine-toc">
    <div class="magazine-toc-header">
      <a href="/magazines/${magazine.slug}" class="magazine-toc-magazine-link">
        <span class="magazine-toc-emoji">${magazine.emoji}</span>
        <span class="magazine-toc-magazine-title">${magazine.title}</span>
      </a>
    </div>
    <ol class="magazine-toc-list">
      ${tocItems}
    </ol>
  </div>`;
}

// マガジンナビゲーションHTML生成（記事ページ下部用）
function renderMagazineNav(magazineInfo, allPosts) {
  if (!magazineInfo) return '';

  const { magazine, currentIndex, prevSlug, nextSlug } = magazineInfo;
  const prevPost = prevSlug ? allPosts.find(p => p.slug === prevSlug) : null;
  const nextPost = nextSlug ? allPosts.find(p => p.slug === nextSlug) : null;

  let navHtml = `<nav class="magazine-nav">
    <div class="magazine-nav-header">
      <a href="/magazines/${magazine.slug}" class="magazine-nav-title">
        <span class="magazine-nav-emoji">${magazine.emoji}</span>
        <span>${magazine.title}</span>
      </a>
      <span class="magazine-nav-progress">${currentIndex + 1} / ${magazine.articles.length}</span>
    </div>
    <div class="magazine-nav-links">`;

  if (prevPost) {
    navHtml += `<a href="/posts/${prevPost.slug}" class="magazine-nav-prev">
      <span class="magazine-nav-label">前の記事</span>
      <span class="magazine-nav-article-title">${prevPost.title}</span>
    </a>`;
  } else {
    navHtml += `<div class="magazine-nav-prev magazine-nav-disabled"></div>`;
  }

  if (nextPost) {
    navHtml += `<a href="/posts/${nextPost.slug}" class="magazine-nav-next">
      <span class="magazine-nav-label">次の記事</span>
      <span class="magazine-nav-article-title">${nextPost.title}</span>
    </a>`;
  } else {
    navHtml += `<div class="magazine-nav-next magazine-nav-disabled"></div>`;
  }

  navHtml += `</div></nav>`;
  return navHtml;
}

// 関連記事のHTML生成
function renderRelatedArticles(currentSlug, currentType, metadata, allPosts, allTopics) {
  const relatedSlugs = metadata.related || [];
  const currentTags = metadata.tags || [];

  const allArticles = [
    ...allPosts.map(p => ({ ...p, type: 'posts' })),
    ...allTopics.map(p => ({ ...p, type: 'topics' }))
  ];

  const renderCard = (article) => {
    const urlPrefix = article.type === 'posts' ? '/posts' : '/topics';
    const tagsHtml = article.tags.length > 0
      ? article.tags.map(tag => `<span class="badge rounded-pill bg-secondary tag">${escapeHtml(tag)}</span>`).join('')
      : '';
    const subtitleHtml = article.quicklook
      ? `<span class="text-muted small">${escapeHtml(article.quicklook)}</span>`
      : `<time class="text-muted small">${escapeHtml(article.date)}</time>`;
    return `<a href="${urlPrefix}/${article.slug}" class="d-flex align-items-center gap-3 p-3 border rounded mb-2 text-decoration-none article-card">
      <div class="flex-shrink-0 lh-1" style="font-size:2rem">${article.emoji}</div>
      <div class="flex-grow-1">
        <div class="fw-semibold article-title">${escapeHtml(article.title)}</div>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          ${subtitleHtml}
          ${tagsHtml}
        </div>
      </div>
      <span class="text-muted flex-shrink-0">→</span>
    </a>`;
  };

  let html = '';

  const manualRelated = relatedSlugs.map(relSlug => {
    return allArticles.find(a => a.slug === relSlug);
  }).filter(a => a);

  if (manualRelated.length > 0) {
    html += `<div class="related-section mt-4 pt-3 border-top">
      <h3 class="h5 mb-3">関連記事</h3>
      <div>${manualRelated.map(renderCard).join('')}</div>
    </div>`;
  }

  const manualSlugs = new Set(relatedSlugs);
  if (currentTags.length > 0) {
    let tagRelated = allArticles.filter(a => {
      if (a.slug === currentSlug) return false;
      if (manualSlugs.has(a.slug)) return false;
      return a.tags.some(tag => currentTags.includes(tag));
    });
    tagRelated.sort((a, b) => {
      const aCommon = a.tags.filter(t => currentTags.includes(t)).length;
      const bCommon = b.tags.filter(t => currentTags.includes(t)).length;
      return bCommon - aCommon;
    });
    tagRelated = tagRelated.slice(0, 5);

    if (tagRelated.length > 0) {
      html += `<div class="related-section mt-4 pt-3 border-top">
        <h3 class="h5 mb-3">同じタグを持つ記事</h3>
        <div>${tagRelated.map(renderCard).join('')}</div>
      </div>`;
    }
  }

  return html;
}

// 記事ページレンダリング
async function renderArticlePage(dir, slug, res) {
  const mdFile = `${dir}/${slug}.md`;

  if (!await fs.pathExists(mdFile)) {
    res.writeHead(404);
    return res.end('Not Found');
  }

  const content = await fs.readFile(mdFile, 'utf8');
  const { metadata, content: markdown } = parseFrontMatter(content);

  const expandedMarkdown = expandSnippets(markdown);

  const allPosts = await getPosts();
  const allMagazines = await getMagazines();
  const allDictEntries = await getDictionaryEntries();
  const html = await parseMarkdown(expandedMarkdown, allPosts, allMagazines, allDictEntries);

  let magazineTocHtml = '';
  let magazineNavHtml = '';
  if (dir === CONTENT_DIRS.postsDir) {
    const magazineInfo = await getMagazineForArticle(slug);
    magazineTocHtml = renderMagazineToc(magazineInfo, allPosts);
    magazineNavHtml = renderMagazineNav(magazineInfo, allPosts);
  }

  const allTopics = await getTopics();
  const currentType = dir === CONTENT_DIRS.postsDir ? 'posts' : 'topics';
  const relatedHtml = renderRelatedArticles(slug, currentType, metadata, allPosts, allTopics);

  const postHtml = applyTemplate(templates.post, {
    title: metadata.title || 'Untitled',
    date: metadata.date || '',
    emoji: metadata.emoji || '📄',
    tags: renderTagsHtml(metadata.tags),
    content: html,
    related: relatedHtml,
    magazineToc: magazineTocHtml,
    magazineNav: magazineNavHtml
  });

  const finalHtml = applyTemplate(templates.layout, {
    title: metadata.title || 'Untitled',
    content: postHtml
  });

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  return res.end(finalHtml);
}

// サーバー起動
http.createServer(async (req, res) => {
  const requestStart = Date.now();

  try {
    log.log(`${req.method} ${req.url}`);

    // 管理画面
    if (req.url.startsWith('/admin')) {
      return await handleAdminRequest(req, res, req.url.split('?')[0], buildSearchIndex);
    }

    // 静的ファイル
    if (req.url.startsWith('/static/')) {
      const filePath = `.${req.url}`;
      const ext = path.extname(filePath);
      const content = await fs.readFile(filePath);

      // ファイル置き場のファイルには元のファイル名をContent-Dispositionヘッダーに設定
      if (req.url.startsWith('/static/files/')) {
        const filename = path.basename(filePath);
        const metadataPath = './static/files/metadata.json';

        let originalFilename = filename;
        if (await fs.pathExists(metadataPath)) {
          try {
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            if (metadata[filename] && metadata[filename].originalFilename) {
              originalFilename = metadata[filename].originalFilename;
            }
          } catch (err) {
            log.error('Failed to read file metadata:', err);
          }
        }

        const encodedFilename = encodeURIComponent(originalFilename);

        res.writeHead(200, {
          'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`
        });
        return res.end(content);
      }

      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return res.end(content);
    }

    // トップページ
    if (req.url === '/' || req.url === '/index.html') {
      const posts = await getPosts(true);
      const postsHtml = posts.map(p => renderPostCard(p, '/posts')).join('\n');

      const indexHtml = applyTemplate(templates.index, { posts: postsHtml });

      const html = applyTemplate(templates.layout, {
        title: 'WordBox',
        content: indexHtml
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // タグページ
    if (req.url.startsWith('/tags/')) {
      const tag = decodeURIComponent(req.url.replace('/tags/', ''));
      const allPosts = await getPosts();
      const allTopics = await getTopics();
      const filteredPosts = allPosts.filter(p => p.tags.includes(tag));
      const filteredTopics = allTopics.filter(p => p.tags.includes(tag));
      const postsHtml = filteredPosts.map(p => renderPostCard(p, '/posts')).join('\n');
      const topicsHtml = filteredTopics.map(p => renderPostCard(p, '/topics')).join('\n');
      const totalCount = filteredPosts.length + filteredTopics.length;

      const content = `
        <div class="tag-page">
          <h2>タグ: ${tag}</h2>
          <p>${totalCount}件の記事</p>
          <div class="post-list">
            ${postsHtml}${topicsHtml || ''}
            ${totalCount === 0 ? '<p>このタグの記事はありません。</p>' : ''}
          </div>
        </div>
      `;

      const html = applyTemplate(templates.layout, {
        title: `タグ: ${tag}`,
        content: content
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // マガジン一覧ページ
    if (req.url === '/magazines' || req.url === '/magazines/') {
      const magazines = await getMagazines(true);
      const allPosts = await getPosts();

      const magazinesHtml = magazines.map(mag => {
        const articleCount = mag.articles.length;
        return `<article class="card mb-3 shadow-sm">
          <div class="card-body d-flex align-items-center gap-3">
            <div class="flex-shrink-0 lh-1" style="font-size:3rem">${mag.emoji}</div>
            <div class="flex-grow-1">
              <h3 class="h5 mb-1"><a href="/magazines/${mag.slug}" class="text-decoration-none">${mag.title}</a></h3>
              <p class="text-muted mb-1 small">${mag.description}</p>
              <span class="badge bg-secondary">${articleCount}件の記事</span>
            </div>
          </div>
        </article>`;
      }).join('\n');

      const content = `
        <div class="magazine-page">
          <h2 class="mb-4">マガジン</h2>
          ${magazinesHtml || '<p>マガジンはまだありません。</p>'}
        </div>
      `;

      const html = applyTemplate(templates.layout, {
        title: 'マガジン - WordBox',
        content: content
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // マガジン詳細ページ
    if (req.url.startsWith('/magazines/')) {
      const slug = req.url.replace('/magazines/', '');
      const magazines = await getMagazines();
      const magazine = magazines.find(m => m.slug === slug);

      if (!magazine) {
        res.writeHead(404);
        return res.end('Not Found');
      }

      const allPosts = await getPosts();

      const articlesHtml = magazine.articles.map((articleSlug, index) => {
        const post = allPosts.find(p => p.slug === articleSlug);
        if (post) {
          return `<a href="/posts/${post.slug}" class="list-group-item list-group-item-action d-flex align-items-center gap-3">
            <span class="badge bg-secondary rounded-pill flex-shrink-0">${index + 1}</span>
            <div class="flex-grow-1">
              <div>${post.title}</div>
              <small class="text-muted">${post.date}</small>
            </div>
          </a>`;
        } else {
          return `<div class="list-group-item d-flex align-items-center gap-3 text-muted">
            <span class="badge bg-secondary rounded-pill flex-shrink-0">${index + 1}</span>
            <span>${articleSlug} (見つかりません)</span>
          </div>`;
        }
      }).join('\n');

      const expandedMagBody = magazine.body ? expandSnippets(magazine.body) : '';
      const bodyHtml = expandedMagBody ? await parseMarkdown(expandedMagBody, allPosts) : '';

      const content = `
        <div class="magazine-detail">
          <div class="d-flex align-items-center gap-3 mb-4 pb-3 border-bottom">
            <div class="flex-shrink-0 lh-1" style="font-size:4rem">${magazine.emoji}</div>
            <div class="flex-grow-1">
              <h1 class="h2 mb-1">${magazine.title}</h1>
              <p class="text-muted mb-1">${magazine.description}</p>
              <span class="badge bg-secondary">${magazine.articles.length}件の記事</span>
            </div>
          </div>
          ${bodyHtml ? `<div class="magazine-body content mb-4">${bodyHtml}</div>` : ''}
          <div class="magazine-articles">
            <h2 class="h4 mb-3">収録記事</h2>
            <div class="list-group">
              ${articlesHtml}
            </div>
          </div>
        </div>
      `;

      const html = applyTemplate(templates.layout, {
        title: `${magazine.title} - WordBox`,
        content: content
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // トピック一覧ページ
    if (req.url === '/topics' || req.url === '/topics/') {
      const topics = await getTopics(true);
      const topicsHtml = topics.map(p => renderPostCard(p, '/topics')).join('\n');

      const content = `
        <div class="topic-page">
          <h2>トピック</h2>
          <div class="post-list">
            ${topicsHtml || '<p>トピックはまだありません。</p>'}
          </div>
        </div>
      `;

      const html = applyTemplate(templates.layout, {
        title: 'トピック - WordBox',
        content: content
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // トピック記事ページ
    if (req.url.startsWith('/topics/')) {
      const slug = req.url.replace('/topics/', '');
      return await renderArticlePage(CONTENT_DIRS.topicsDir, slug, res);
    }

    // 辞書一覧ページ
    if (req.url === '/dictionary' || req.url === '/dictionary/') {
      const entries = await getDictionaryEntries(true);

      const categories = {};
      for (const entry of entries) {
        const cat = entry.category || '未分類';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(entry);
      }

      let entriesHtml = '';
      for (const [category, catEntries] of Object.entries(categories)) {
        entriesHtml += `<div class="dictionary-category">`;
        entriesHtml += `<h3 class="dictionary-category-title">${escapeHtml(category)}</h3>`;
        entriesHtml += `<div class="dictionary-entries">`;
        for (const entry of catEntries) {
          entriesHtml += `<a href="/dictionary/${entry.slug}" class="d-flex align-items-center gap-3 p-3 border rounded mb-2 text-decoration-none dictionary-entry-card">
            <div class="flex-shrink-0 lh-1" style="font-size:2rem">${entry.emoji}</div>
            <div class="flex-grow-1">
              <div class="fw-semibold">${escapeHtml(entry.title)}</div>
              ${entry.reading ? `<div class="text-muted small">${escapeHtml(entry.reading)}</div>` : ''}
              <div class="text-muted small">${escapeHtml(entry.description)}</div>
            </div>
            <span class="text-muted flex-shrink-0">→</span>
          </a>`;
        }
        entriesHtml += `</div></div>`;
      }

      const content = applyTemplate(templates.dictionary, {
        count: entries.length,
        entries: entriesHtml
      });

      const html = applyTemplate(templates.layout, {
        title: '辞書 - WordBox',
        content: content
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // 辞書詳細ページ
    if (req.url.startsWith('/dictionary/')) {
      const slug = req.url.replace('/dictionary/', '');
      const mdFile = `${CONTENT_DIRS.dictionaryDir}/${slug}.md`;

      if (!await fs.pathExists(mdFile)) {
        res.writeHead(404);
        return res.end('Not Found');
      }

      const content = await fs.readFile(mdFile, 'utf8');
      const { metadata, content: markdown } = parseFrontMatter(content);

      const expandedMarkdown = expandSnippets(markdown);

      const allPosts = await getPosts();
      const allMagazines = await getMagazines();
      const allDictEntries = await getDictionaryEntries();
      const bodyHtml = await parseMarkdown(expandedMarkdown, allPosts, allMagazines, allDictEntries);

      let relatedHtml = '';
      if (metadata.related && metadata.related.length > 0) {
        const relatedItems = metadata.related.map(relSlug => {
          const relEntry = allDictEntries.find(e => e.slug === relSlug);
          if (relEntry) {
            return `<a href="/dictionary/${relEntry.slug}" class="d-inline-flex align-items-center gap-1 badge bg-secondary text-decoration-none p-2 me-2 mb-2 fs-6 dictionary-related-item">
              <span>${relEntry.emoji}</span>
              <span>${escapeHtml(relEntry.title)}</span>
            </a>`;
          }
          return '';
        }).filter(h => h).join('');
        relatedHtml = `<div class="dictionary-related mt-4 pt-3 border-top">
          <h3 class="h5 mb-3">関連用語</h3>
          <div>${relatedItems}</div>
        </div>`;
      }

      const entryHtml = applyTemplate(templates.dictionaryEntry, {
        title: metadata.title || 'Untitled',
        emoji: metadata.emoji || '📖',
        reading: metadata.reading || '',
        category: metadata.category || '',
        description: metadata.description || '',
        content: bodyHtml,
        related: relatedHtml
      });

      const finalHtml = applyTemplate(templates.layout, {
        title: `${metadata.title || 'Untitled'} - 辞書 - WordBox`,
        content: entryHtml
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(finalHtml);
    }

    // 記事ページ
    if (req.url.startsWith('/posts/')) {
      const slug = req.url.replace('/posts/', '');
      return await renderArticlePage(CONTENT_DIRS.postsDir, slug, res);
    }

    // 検索ページ
    if (req.url.startsWith('/search')) {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const query = urlObj.searchParams.get('q') || '';

      const results = searchEngine.search(query);

      const resultsHtml = results.map(r => {
        const doc = r.item;
        let url = '';
        if (doc.type === 'post') url = `/posts/${doc.id}`;
        else if (doc.type === 'topic') url = `/topics/${doc.id}`;
        else if (doc.type === 'magazine') url = `/magazines/${doc.id}`;
        else if (doc.type === 'dictionary') url = `/dictionary/${doc.id}`;

        return `
        <div class="card mb-3 search-result-item">
          <div class="card-body">
            <h3 class="h5 mb-1"><a href="${url}" class="text-decoration-none">${doc.emoji} ${doc.title}</a></h3>
            <div class="d-flex align-items-center gap-2 mb-2">
              <span class="badge bg-secondary">${doc.type}</span>
              ${doc.date ? `<time class="text-muted small">${doc.date}</time>` : ''}
            </div>
            <p class="mb-0 text-muted small search-result-snippet">${r.snippet}</p>
          </div>
        </div>`;
      }).join('\n') || '<p>該当する記事が見つかりませんでした。</p>';

      const content = applyTemplate(templates.search, {
        query: escapeHtml(query),
        count: results.length,
        results: resultsHtml
      });

      const html = applyTemplate(templates.layout, {
        title: `検索: ${query} - WordBox`,
        content: content
      });

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');

  } catch (err) {
    log.error(err.message, err.stack);
    res.writeHead(500);
    res.end('Server Error: ' + err.message);
  } finally {
    // リクエスト処理時間をログ出力
    const elapsed = Date.now() - requestStart;
    if (elapsed > 100) {
      log.warn(`Slow request: ${req.method} ${req.url} (${ms(elapsed)})`);
    }
  }
}).listen(PORT, async () => {
  await loadTemplates();
  await loadSnippets();
  await buildSearchIndex();
  log.log(`Server running at http://localhost:${PORT}`);
  log.log(`Config: port=${PORT}, fuzzySearch=${config.search.fuzzyThreshold > 0 ? 'enabled' : 'disabled'}`);
});

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// signal-exit: プロセス終了時のクリーンアップ
onExit((code, signal) => {
  log.log(`Server shutting down (code=${code}, signal=${signal})`);
  log.log(`Cache stats: pageCache=${pageCache.size} entries, listCache=${listCache.size} entries`);
}, { alwaysLast: true });

// プロセスレベルのエラーハンドリング（サーバークラッシュ防止）
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception:', err);
});
