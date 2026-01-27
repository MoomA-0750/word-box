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
      listed: listed,
      file: file
    });
  }

  // 日付でソート（新しい順）
  posts.sort((a, b) => b.date.localeCompare(a.date));

  return posts;
}

// 記事一覧取得（後方互換）
async function getPosts(onlyListed = false) {
  return getPostsFromDir('./posts', onlyListed);
}

// トピック一覧取得
async function getTopics(onlyListed = false) {
  return getPostsFromDir('./topics', onlyListed);
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
  const html = parseMarkdown(markdown, allPosts);

  const postTemplate = await fs.readFile('./templates/post.html', 'utf8');
  const postHtml = applyTemplate(postTemplate, {
    title: metadata.title || 'Untitled',
    date: metadata.date || '',
    emoji: metadata.emoji || '📄',
    tags: renderTagsHtml(metadata.tags),
    content: html
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
      const filteredPosts = allPosts.filter(p => p.tags.includes(tag));
      const postsHtml = filteredPosts.map(p => renderPostCard(p, '/posts')).join('\n');

      const content = `
        <div class="tag-page">
          <h2>タグ: ${tag}</h2>
          <p>${filteredPosts.length}件の記事</p>
          <div class="post-list">
            ${postsHtml || '<p>このタグの記事はありません。</p>'}
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
      return renderArticlePage('./topics', slug, res);
    }

    // 記事ページ
    if (req.url.startsWith('/posts/')) {
      const slug = req.url.replace('/posts/', '');
      return renderArticlePage('./posts', slug, res);
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
