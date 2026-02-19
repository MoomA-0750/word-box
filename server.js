// server.js
const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const { parseFrontMatter } = require('./lib/frontmatter');
const { parseMarkdown } = require('./lib/markdown');
const searchEngine = require('./lib/search');
const { handleAdminRequest } = require('./lib/admin-router');

const PORT = 3000;
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
  console.log('Loading templates...');
  try {
    templates.index = await fs.readFile('./templates/index.html', 'utf8');
    templates.layout = await fs.readFile('./templates/layout.html', 'utf8');
    templates.post = await fs.readFile('./templates/post.html', 'utf8');
    templates.search = await fs.readFile('./templates/search.html', 'utf8');
    templates.dictionary = await fs.readFile('./templates/dictionary.html', 'utf8');
    templates.dictionaryEntry = await fs.readFile('./templates/dictionary-entry.html', 'utf8');
    console.log('Templates loaded.');
  } catch (err) {
    console.error('Error loading templates:', err);
  }
}

// 検索インデックス構築
async function buildSearchIndex() {
  console.log('Building search index...');
  searchEngine.clear();

  // 記事
  const postsDir = './content/posts';
  if (await fs.pathExists(postsDir)) {
    const files = await fs.readdir(postsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(`${postsDir}/${file}`, 'utf8');
      const { metadata, content: body } = parseFrontMatter(content);
      if (metadata.listed === false) continue;

      searchEngine.addDocument({
        id: file.replace('.md', ''),
        title: metadata.title || 'Untitled',
        content: body,
        tags: metadata.tags || [],
        keywords: metadata.keywords || [],
        type: 'post',
        emoji: metadata.emoji || '📄',
        date: metadata.date
      });
    }
  }

  // トピック
  const topicsDir = './content/topics';
  if (await fs.pathExists(topicsDir)) {
    const files = await fs.readdir(topicsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(`${topicsDir}/${file}`, 'utf8');
      const { metadata, content: body } = parseFrontMatter(content);
      if (metadata.listed === false) continue;

      searchEngine.addDocument({
        id: file.replace('.md', ''),
        title: metadata.title || 'Untitled',
        content: body,
        tags: metadata.tags || [],
        keywords: metadata.keywords || [],
        type: 'topic',
        emoji: metadata.emoji || '📝',
        date: metadata.date
      });
    }
  }

  // 辞書
  const dictDir = './content/dictionary';
  if (await fs.pathExists(dictDir)) {
    const files = await fs.readdir(dictDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(`${dictDir}/${file}`, 'utf8');
      const { metadata, content: body } = parseFrontMatter(content);
      if (metadata.listed === false) continue;

      searchEngine.addDocument({
        id: file.replace('.md', ''),
        title: metadata.title || 'Untitled',
        content: body,
        tags: metadata.category ? [metadata.category] : [],
        type: 'dictionary',
        emoji: metadata.emoji || '📖',
        date: ''
      });
    }
  }

  // マガジン
  const magsDir = './content/magazines';
  if (await fs.pathExists(magsDir)) {
    const files = await fs.readdir(magsDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const content = await fs.readFile(`${magsDir}/${file}`, 'utf8');
      const { metadata, content: body } = parseFrontMatter(content);
      if (metadata.listed === false) continue;

      searchEngine.addDocument({
        id: file.replace('.md', ''),
        title: metadata.title || 'Untitled',
        content: body,
        tags: [],
        type: 'magazine',
        emoji: metadata.emoji || '📚'
      });
    }
  }

  console.log(`Index built with ${searchEngine.documents.length} documents.`);
}

// テンプレート適用
function applyTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return result;
}

// 記事一覧取得（汎用）
// onlyListed: trueの場合、listed: falseの記事を除外
async function getPostsFromDir(dir, onlyListed = false) {
  const files = await fs.readdir(dir);
  const posts = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const content = await fs.readFile(`${dir}/${file}`, 'utf8');
    const { metadata } = parseFrontMatter(content);

    // listedがfalseの場合、一覧から除外（デフォルトはtrue）
    const listed = metadata.listed !== false;
    if (onlyListed && !listed) continue;

    posts.push({
      slug: file.replace('.md', ''),
      title: metadata.title || 'Untitled',
      date: metadata.date || '',
      emoji: metadata.emoji || '📄',
      tags: metadata.tags || [],
      quicklook: metadata.quicklook || '',
      listed: listed,
      related: metadata.related || [],
      keywords: metadata.keywords || [],
      file: file
    });
  }

  // 日付でソート（新しい順）
  posts.sort((a, b) => b.date.localeCompare(a.date));

  return posts;
}

// 記事一覧取得
async function getPosts(onlyListed = false) {
  return getPostsFromDir('./content/posts', onlyListed);
}

// トピック一覧取得
async function getTopics(onlyListed = false) {
  return getPostsFromDir('./content/topics', onlyListed);
}

// 辞書一覧取得
async function getDictionaryEntries(onlyListed = false) {
  const dir = './content/dictionary';
  if (!await fs.pathExists(dir)) return [];

  const files = await fs.readdir(dir);
  const entries = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const content = await fs.readFile(`${dir}/${file}`, 'utf8');
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

  // 読みでソート（五十音順）
  entries.sort((a, b) => (a.reading || a.title).localeCompare(b.reading || b.title, 'ja'));

  return entries;
}

// マガジン一覧取得
async function getMagazines(onlyListed = false) {
  const dir = './content/magazines';
  const files = await fs.readdir(dir);
  const magazines = [];

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    const content = await fs.readFile(`${dir}/${file}`, 'utf8');
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
  return `<div class="tags">${tags.map(tag =>
    `<a href="/tags/${encodeURIComponent(tag)}" class="tag">${tag}</a>`
  ).join('')}</div>`;
}

// 記事カードHTML生成
function renderPostCard(post, urlPrefix) {
  return `<article class="post-list-item">
    <div class="post-emoji">${post.emoji}</div>
    <div class="post-info">
      <h3><a href="${urlPrefix}/${post.slug}">${post.title}</a></h3>
      <div class="post-meta">
        <time>${post.date}</time>
        ${renderTagsHtml(post.tags)}
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

  // 全記事を統合（posts/topics）
  const allArticles = [
    ...allPosts.map(p => ({ ...p, type: 'posts' })),
    ...allTopics.map(p => ({ ...p, type: 'topics' }))
  ];

  // バナーカード形式でレンダリング
  const renderCard = (article) => {
    const urlPrefix = article.type === 'posts' ? '/posts' : '/topics';
    const tagsHtml = article.tags.length > 0
      ? `<div class="tags tags-small">${article.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
      : '';
    const subtitleHtml = article.quicklook
      ? `<span class="article-quicklook">${escapeHtml(article.quicklook)}</span>`
      : `<time>${escapeHtml(article.date)}</time>`;
    return `<a href="${urlPrefix}/${article.slug}" class="article-card">
      <div class="article-icon">${article.emoji}</div>
      <div class="article-content">
        <div class="article-title">${escapeHtml(article.title)}</div>
        <div class="article-meta">
          ${subtitleHtml}
          ${tagsHtml}
        </div>
      </div>
      <div class="article-arrow">→</div>
    </a>`;
  };

  let html = '';

  // 手動指定の関連記事
  const manualRelated = relatedSlugs.map(relSlug => {
    return allArticles.find(a => a.slug === relSlug);
  }).filter(a => a);

  if (manualRelated.length > 0) {
    html += `<div class="related-section">
      <h3 class="related-section-heading">関連記事</h3>
      <div class="related-section-list">${manualRelated.map(renderCard).join('')}</div>
    </div>`;
  }

  // 同タグの記事を自動取得（自分自身と手動指定分を除く）
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
      html += `<div class="related-section">
        <h3 class="related-section-heading">同じタグを持つ記事</h3>
        <div class="related-section-list">${tagRelated.map(renderCard).join('')}</div>
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

  const allPosts = await getPosts();
  const allMagazines = await getMagazines();
  const allDictEntries = await getDictionaryEntries();
  const html = await parseMarkdown(markdown, allPosts, allMagazines, allDictEntries);

  // マガジン情報を取得（postsディレクトリの記事のみ）
  let magazineTocHtml = '';
  let magazineNavHtml = '';
  if (dir === './content/posts') {
    const magazineInfo = await getMagazineForArticle(slug);
    magazineTocHtml = renderMagazineToc(magazineInfo, allPosts);
    magazineNavHtml = renderMagazineNav(magazineInfo, allPosts);
  }

  // 関連記事のHTML生成
  const allTopics = await getTopics();
  const currentType = dir === './content/posts' ? 'posts' : 'topics';
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
  try {
    console.log(`${req.method} ${req.url}`);

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
            console.error('Failed to read file metadata:', err);
          }
        }

        // Content-Dispositionヘッダーで元のファイル名を指定
        // RFC 5987に準拠したUTF-8ファイル名のエンコーディング
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
        return `<article class="magazine-card">
          <div class="magazine-emoji">${mag.emoji}</div>
          <div class="magazine-info">
            <h3><a href="/magazines/${mag.slug}">${mag.title}</a></h3>
            <p class="magazine-description">${mag.description}</p>
            <div class="magazine-meta">
              <span>${articleCount}件の記事</span>
            </div>
          </div>
        </article>`;
      }).join('\n');

      const content = `
        <div class="magazine-page">
          <h2>マガジン</h2>
          <div class="magazine-list">
            ${magazinesHtml || '<p>マガジンはまだありません。</p>'}
          </div>
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

      // 記事リストを順序通りに生成
      const articlesHtml = magazine.articles.map((articleSlug, index) => {
        const post = allPosts.find(p => p.slug === articleSlug);
        if (post) {
          return `<div class="magazine-article-item">
            <span class="magazine-article-number">${index + 1}</span>
            <div class="magazine-article-info">
              <a href="/posts/${post.slug}">${post.title}</a>
              <time>${post.date}</time>
            </div>
          </div>`;
        } else {
          return `<div class="magazine-article-item magazine-article-notfound">
            <span class="magazine-article-number">${index + 1}</span>
            <div class="magazine-article-info">
              <span>${articleSlug} (見つかりません)</span>
            </div>
          </div>`;
        }
      }).join('\n');

      // マガジン本文をMarkdownパース
      const bodyHtml = magazine.body ? await parseMarkdown(magazine.body, allPosts) : '';

      const content = `
        <div class="magazine-detail">
          <header class="magazine-header">
            <div class="magazine-header-emoji">${magazine.emoji}</div>
            <div class="magazine-header-text">
              <h1>${magazine.title}</h1>
              <p class="magazine-description">${magazine.description}</p>
              <div class="magazine-meta">
                <span>${magazine.articles.length}件の記事</span>
              </div>
            </div>
          </header>
          ${bodyHtml ? `<div class="magazine-body content">${bodyHtml}</div>` : ''}
          <div class="magazine-articles">
            <h2>収録記事</h2>
            <div class="magazine-article-list">
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
      return renderArticlePage('./content/topics', slug, res);
    }

    // 辞書一覧ページ
    if (req.url === '/dictionary' || req.url === '/dictionary/') {
      const entries = await getDictionaryEntries(true);

      // カテゴリでグループ化
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
          entriesHtml += `<a href="/dictionary/${entry.slug}" class="dictionary-entry-card">
            <div class="dictionary-entry-emoji">${entry.emoji}</div>
            <div class="dictionary-entry-info">
              <div class="dictionary-entry-title">${escapeHtml(entry.title)}</div>
              ${entry.reading ? `<div class="dictionary-entry-reading">${escapeHtml(entry.reading)}</div>` : ''}
              <div class="dictionary-entry-desc">${escapeHtml(entry.description)}</div>
            </div>
            <div class="dictionary-entry-arrow">→</div>
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
      const mdFile = `./content/dictionary/${slug}.md`;

      if (!await fs.pathExists(mdFile)) {
        res.writeHead(404);
        return res.end('Not Found');
      }

      const content = await fs.readFile(mdFile, 'utf8');
      const { metadata, content: markdown } = parseFrontMatter(content);

      const allPosts = await getPosts();
      const allMagazines = await getMagazines();
      const allDictEntries = await getDictionaryEntries();
      const bodyHtml = await parseMarkdown(markdown, allPosts, allMagazines, allDictEntries);

      // 関連用語のHTML
      let relatedHtml = '';
      if (metadata.related && metadata.related.length > 0) {
        const relatedItems = metadata.related.map(relSlug => {
          const relEntry = allDictEntries.find(e => e.slug === relSlug);
          if (relEntry) {
            return `<a href="/dictionary/${relEntry.slug}" class="dictionary-related-item">
              <span class="dictionary-related-emoji">${relEntry.emoji}</span>
              <span class="dictionary-related-title">${escapeHtml(relEntry.title)}</span>
            </a>`;
          }
          return '';
        }).filter(h => h).join('');
        relatedHtml = `<div class="dictionary-related">
          <h3>関連用語</h3>
          <div class="dictionary-related-list">${relatedItems}</div>
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
      return renderArticlePage('./content/posts', slug, res);
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
        <div class="search-result-item">
          <h3><a href="${url}"><span class="search-result-emoji">${doc.emoji}</span> ${doc.title}</a></h3>
          <div class="search-result-meta">
            <span class="search-result-type">${doc.type}</span>
            ${doc.date ? `<time>${doc.date}</time>` : ''}
          </div>
          <div class="search-result-snippet">${r.snippet}</div>
        </div>`;
      }).join('\n') || '<p>該当する記事が見つかりませんでした。</p>';

      const content = applyTemplate(templates.search, {
        query: escapeHtml(query), // XSS対策
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
    console.error(err);
    res.writeHead(500);
    res.end('Server Error: ' + err.message);
  }
}).listen(PORT, async () => {
  await loadTemplates();
  await buildSearchIndex();
  console.log(`Server running at http://localhost:${PORT}`);
});

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// プロセスレベルのエラーハンドリング（サーバークラッシュ防止）
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
