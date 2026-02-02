// server.js
const http = require('http');
const fs = require('fs-extra');
const path = require('path');
const { parseFrontMatter } = require('./lib/frontmatter');
const { parseMarkdown } = require('./lib/markdown');

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
  const html = parseMarkdown(markdown, allPosts, allMagazines);

  // マガジン情報を取得（postsディレクトリの記事のみ）
  let magazineTocHtml = '';
  let magazineNavHtml = '';
  if (dir === './content/posts') {
    const magazineInfo = await getMagazineForArticle(slug);
    magazineTocHtml = renderMagazineToc(magazineInfo, allPosts);
    magazineNavHtml = renderMagazineNav(magazineInfo, allPosts);
  }

  const postTemplate = await fs.readFile('./templates/post.html', 'utf8');
  const postHtml = applyTemplate(postTemplate, {
    title: metadata.title || 'Untitled',
    date: metadata.date || '',
    emoji: metadata.emoji || '📄',
    tags: renderTagsHtml(metadata.tags),
    content: html,
    magazineToc: magazineTocHtml,
    magazineNav: magazineNavHtml
  });

  const layoutTemplate = await fs.readFile('./templates/layout.html', 'utf8');
  const finalHtml = applyTemplate(layoutTemplate, {
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

    // 静的ファイル
    if (req.url.startsWith('/static/')) {
      const filePath = `.${req.url}`;
      const ext = path.extname(filePath);
      const content = await fs.readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return res.end(content);
    }

    // トップページ
    if (req.url === '/' || req.url === '/index.html') {
      const posts = await getPosts(true);
      const postsHtml = posts.map(p => renderPostCard(p, '/posts')).join('\n');

      const indexTemplate = await fs.readFile('./templates/index.html', 'utf8');
      const indexHtml = applyTemplate(indexTemplate, { posts: postsHtml });

      const layoutTemplate = await fs.readFile('./templates/layout.html', 'utf8');
      const html = applyTemplate(layoutTemplate, {
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

      const layoutTemplate = await fs.readFile('./templates/layout.html', 'utf8');
      const html = applyTemplate(layoutTemplate, {
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

      const layoutTemplate = await fs.readFile('./templates/layout.html', 'utf8');
      const html = applyTemplate(layoutTemplate, {
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
      const bodyHtml = magazine.body ? parseMarkdown(magazine.body, allPosts) : '';

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

      const layoutTemplate = await fs.readFile('./templates/layout.html', 'utf8');
      const html = applyTemplate(layoutTemplate, {
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

      const layoutTemplate = await fs.readFile('./templates/layout.html', 'utf8');
      const html = applyTemplate(layoutTemplate, {
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

    // 記事ページ
    if (req.url.startsWith('/posts/')) {
      const slug = req.url.replace('/posts/', '');
      return renderArticlePage('./content/posts', slug, res);
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');

  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end('Server Error: ' + err.message);
  }
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
