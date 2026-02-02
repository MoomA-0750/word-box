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
    // lib/markdown.js

function parseMarkdown(text, allPosts = []) {
  let html = text;
  
  // コードブロック（先に処理して保護）
  const codeBlocks = [];
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `___CODE_BLOCK_${codeBlocks.length}___`;
    const language = lang || 'text';
    const escapedCode = escapeHtml(code.trim());
    
    const codeBlockHtml = `
<div class="code-block">
  <div class="code-header">
    <span class="code-language">${language}</span>
    <button class="copy-button">コピー</button>
  </div>
  <pre><code class="language-${language}">${escapedCode}</code></pre>
</div>`;
    
    codeBlocks.push(codeBlockHtml);
    return placeholder;
  });
  
  // 外部ブックマークリンク
  const bookmarks = [];
  html = html.replace(/:::bookmark\n([\s\S]*?):::/g, (match, content) => {
    const placeholder = `___BOOKMARK_${bookmarks.length}___`;
    bookmarks.push(createBookmarkCard(content.trim()));
    return placeholder;
  });
  
  // 内部記事リンク
  const articles = [];
  html = html.replace(/:::article\n([^\n]+)\n:::/g, (match, slug) => {
    const placeholder = `___ARTICLE_${articles.length}___`;
    articles.push(createArticleCard(slug.trim(), allPosts));
    return placeholder;
  });

  // 目次プレースホルダー
  let hasContents = false;
  html = html.replace(/:::contents\n:::/g, () => {
    hasContents = true;
    return '___CONTENTS___';
  });

  // GitHubスタイルのコールアウト（引用ブロック内）
  const callouts = [];
  html = html.replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:^>.*\n?)*)/gm, (match, type, content) => {
    const placeholder = `___CALLOUT_${callouts.length}___`;
    // 引用の > を除去してコンテンツを整形
    const cleanContent = content
      .split('\n')
      .map(line => line.replace(/^>\s?/, ''))
      .join('\n')
      .trim();
    callouts.push(createCallout(type, cleanContent));
    return placeholder;
  });

  // テーブルをパース（早期に処理してプレースホルダーで保護）
  const tables = [];
  html = parseTablesWithPlaceholder(html, tables);

  // インラインコード
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 画像（リンクより先に処理！）
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  
  // リンク
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  
  // 見出し（改行考慮）- IDを付与して目次用に収集
  // 文書内の出現順でIDを振るため、すべての見出しを一度に処理
  const headings = [];
  let headingCounter = 0;

  html = html.replace(/^(#{1,5}) (.+)$/gm, (match, hashes, title) => {
    const level = hashes.length;
    const id = `heading-${headingCounter++}`;
    headings.push({ level, title, id });
    return `<h${level} id="${id}">${title}</h${level}>`;
  });
  
  // 水平線（3つ以上のハイフン/アスタリスク/アンダースコア）
  html = html.replace(/\n---+\n/g, '\n<hr>\n');
  html = html.replace(/\n\*\*\*+\n/g, '\n<hr>\n');
  html = html.replace(/\n___+\n/g, '\n<hr>\n');
  
  // ネストされたリストをパース
  html = parseNestedLists(html);
  
  // 打ち消し線
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 強調（**bold**, *italic*）
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  
  // 段落（空行で区切る）
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs.map(p => {
    p = p.trim();
    // すでにタグで囲まれている場合はそのまま
    if (p.match(/^<(h[1-6]|ul|ol|pre|hr|blockquote|img|div|a)/)) {
      return p;
    }
    // プレースホルダーのみの場合はスキップ
    if (p.match(/^___(CODE_BLOCK|BOOKMARK|ARTICLE|CALLOUT|TABLE|CONTENTS)_?\d*___$/) || p === '___CONTENTS___') {
      return p;
    }
    // プレースホルダーを含む複合段落の処理
    if (p.match(/___(CODE_BLOCK|BOOKMARK|ARTICLE|CALLOUT|TABLE|CONTENTS)_?\d*___/)) {
      // プレースホルダーと通常テキストを分離して処理
      const parts = p.split(/(___(CODE_BLOCK|BOOKMARK|ARTICLE|CALLOUT|TABLE|CONTENTS)_?\d*___)/);
      return parts.map(part => {
        if (part.match(/^___(CODE_BLOCK|BOOKMARK|ARTICLE|CALLOUT|TABLE|CONTENTS)_?\d*___$/)) {
          return part;
        }
        if (part.match(/^(CODE_BLOCK|BOOKMARK|ARTICLE|CALLOUT|TABLE|CONTENTS)$/)) {
          return ''; // キャプチャグループの余分なマッチを除去
        }
        const trimmed = part.trim();
        if (!trimmed) return '';
        return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
      }).filter(part => part).join('\n');
    }
    // 空でない場合のみ<p>で囲む
    return p ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '';
  }).join('\n');
  
  // コードブロックを復元
  codeBlocks.forEach((code, i) => {
    html = html.replace(`___CODE_BLOCK_${i}___`, code);
  });
  
  // ブックマークを復元
  bookmarks.forEach((bookmark, i) => {
    html = html.replace(`___BOOKMARK_${i}___`, bookmark);
  });
  
  // 記事カードを復元
  articles.forEach((article, i) => {
    html = html.replace(`___ARTICLE_${i}___`, article);
  });

  // コールアウトを復元
  callouts.forEach((callout, i) => {
    html = html.replace(`___CALLOUT_${i}___`, callout);
  });

  // テーブルを復元
  tables.forEach((table, i) => {
    html = html.replace(`___TABLE_${i}___`, table);
  });

  // 目次を生成して復元
  if (hasContents) {
    const toc = createTableOfContents(headings);
    html = html.replace('___CONTENTS___', toc);
  }

  return html;
}

// コールアウトを生成する関数
function createCallout(type, content) {
  const typeConfig = {
    NOTE: { icon: 'ℹ️', label: 'Note', className: 'callout-note' },
    TIP: { icon: '💡', label: 'Tip', className: 'callout-tip' },
    IMPORTANT: { icon: '❗', label: 'Important', className: 'callout-important' },
    WARNING: { icon: '⚠️', label: 'Warning', className: 'callout-warning' },
    CAUTION: { icon: '🔴', label: 'Caution', className: 'callout-caution' }
  };

  const config = typeConfig[type] || typeConfig.NOTE;
  const escapedContent = escapeHtml(content).replace(/\n/g, '<br>');

  return `
<div class="callout ${config.className}">
  <div class="callout-header">
    <span class="callout-icon">${config.icon}</span>
    <span class="callout-label">${config.label}</span>
  </div>
  <div class="callout-content">${escapedContent}</div>
</div>`;
}

// テーブルをパースしてプレースホルダーに置換する関数
function parseTablesWithPlaceholder(html, tables) {
  const lines = html.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // テーブルヘッダー行かチェック（|で始まり|で終わる）
    if (line.match(/^\|.+\|$/)) {
      // 次の行がセパレータ行かチェック
      if (i + 1 < lines.length && lines[i + 1].match(/^\|[\s\-:|]+\|$/)) {
        // テーブル行を収集
        const tableLines = [];
        while (i < lines.length && lines[i].match(/^\|.+\|$/)) {
          tableLines.push(lines[i]);
          i++;
        }
        // テーブルをHTMLに変換してプレースホルダーに
        const placeholder = `___TABLE_${tables.length}___`;
        tables.push(buildTable(tableLines));
        result.push(placeholder);
        continue;
      }
    }
    result.push(line);
    i++;
  }

  return result.join('\n');
}

// テーブル行からHTMLを構築
function buildTable(lines) {
  if (lines.length < 2) return lines.join('\n');

  // ヘッダー行
  const headerLine = lines[0];
  // セパレータ行（アライメント情報を含む）
  const separatorLine = lines[1];
  // ボディ行
  const bodyLines = lines.slice(2);

  // セルを抽出する関数（エスケープされた \| を考慮）
  function extractCells(line) {
    // まず \| を一時的なプレースホルダーに置換
    const placeholder = '\x00ESCAPED_PIPE\x00';
    const escaped = line.slice(1, -1).replace(/\\\|/g, placeholder);
    // | で分割
    const cells = escaped.split('|');
    // プレースホルダーを | に戻す
    return cells.map(cell => cell.replace(new RegExp(placeholder, 'g'), '|').trim());
  }

  // アライメントを解析
  const alignments = extractCells(separatorLine).map(cell => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });

  // セル内のインライン書式を処理する関数
  function processInlineFormatting(text) {
    let result = text;
    // 打ち消し線
    result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');
    // 強調
    result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // インラインコード
    result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
    return result;
  }

  // ヘッダーを生成
  const headerCells = extractCells(headerLine);
  let tableHtml = '<table>\n<thead>\n<tr>';
  headerCells.forEach((cell, idx) => {
    const align = alignments[idx] || 'left';
    tableHtml += `<th style="text-align: ${align}">${processInlineFormatting(cell)}</th>`;
  });
  tableHtml += '</tr>\n</thead>\n<tbody>';

  // ボディを生成
  for (const bodyLine of bodyLines) {
    const cells = extractCells(bodyLine);
    tableHtml += '\n<tr>';
    cells.forEach((cell, idx) => {
      const align = alignments[idx] || 'left';
      tableHtml += `<td style="text-align: ${align}">${processInlineFormatting(cell)}</td>`;
    });
    tableHtml += '</tr>';
  }

  tableHtml += '\n</tbody>\n</table>';
  return tableHtml;
}

// 目次を生成する関数
function createTableOfContents(headings) {
  // H2〜H4のみを目次に含める
  const tocHeadings = headings.filter(h => h.level >= 2 && h.level <= 4);

  if (tocHeadings.length === 0) {
    return '<div class="toc"><p>見出しがありません</p></div>';
  }

  let tocHtml = '<nav class="toc"><div class="toc-title">目次</div><ul>';

  for (const heading of tocHeadings) {
    const indent = heading.level - 2; // H2=0, H3=1, H4=2
    const indentClass = indent > 0 ? ` class="toc-indent-${indent}"` : '';
    tocHtml += `<li${indentClass}><a href="#${heading.id}">${escapeHtml(heading.title)}</a></li>`;
  }

  tocHtml += '</ul></nav>';
  return tocHtml;
}

function createBookmarkCard(content) {
  const lines = content.split('\n');
  let url = '';
  let title = '';
  let icon = '🔗';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      url = trimmed;
    } else if (trimmed.startsWith('title:')) {
      title = trimmed.replace('title:', '').trim();
    } else if (trimmed.startsWith('icon:')) {
      icon = trimmed.replace('icon:', '').trim();
    }
  }

  // タイトルが指定されていない場合はドメインを使用
  if (!title) {
    try {
      const urlObj = new URL(url);
      title = urlObj.hostname;
    } catch (e) {
      title = url;
    }
  }

  return `
<a href="${escapeHtml(url)}" class="bookmark-card" target="_blank" rel="noopener noreferrer">
  <div class="bookmark-icon">${icon}</div>
  <div class="bookmark-content">
    <div class="bookmark-title">${escapeHtml(title)}</div>
    <div class="bookmark-url">${escapeHtml(url)}</div>
  </div>
  <div class="bookmark-arrow">→</div>
</a>`;
}

function createArticleCard(slug, allPosts) {
  // slugに該当する記事を検索
  const post = allPosts.find(p => p.slug === slug);
  
  if (!post) {
    // 記事が見つからない場合
    return `
<div class="article-card article-card-notfound">
  <div class="article-icon">❌</div>
  <div class="article-content">
    <div class="article-title">記事が見つかりません</div>
    <div class="article-meta">${escapeHtml(slug)}</div>
  </div>
</div>`;
  }
  
  // タグのHTML生成
  const tagsHtml = post.tags.length > 0 
    ? `<div class="tags tags-small">${post.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';
  
  // quicklookがあればそれを、なければ日付を表示
  const subtitleHtml = post.quicklook
    ? `<span class="article-quicklook">${escapeHtml(post.quicklook)}</span>`
    : `<time>${escapeHtml(post.date)}</time>`;

  return `
<a href="/posts/${escapeHtml(post.slug)}" class="article-card">
  <div class="article-icon">${escapeHtml(post.emoji)}</div>
  <div class="article-content">
    <div class="article-title">${escapeHtml(post.title)}</div>
    <div class="article-meta">
      ${subtitleHtml}
      ${tagsHtml}
    </div>
  </div>
  <div class="article-arrow">→</div>
</a>`;
}

// ネストされたリストをパースする関数
function parseNestedLists(html) {
  const lines = html.split('\n');
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    // リスト行かチェック（- または 数字. で始まる、チェックボックスも含む）
    const ulMatch = line.match(/^(\s*)- (.+)$/);
    const olMatch = line.match(/^(\s*)(\d+)\. (.+)$/);

    if (ulMatch || olMatch) {
      // リストブロックを収集
      const listLines = [];
      while (i < lines.length) {
        const currentLine = lines[i];
        const isUl = currentLine.match(/^(\s*)- (.+)$/);
        const isOl = currentLine.match(/^(\s*)(\d+)\. (.+)$/);
        if (isUl || isOl) {
          listLines.push(currentLine);
          i++;
        } else if (currentLine.trim() === '') {
          // 空行でリスト終了
          break;
        } else {
          break;
        }
      }
      // リストブロックをHTMLに変換
      result.push(buildNestedList(listLines));
    } else {
      result.push(line);
      i++;
    }
  }

  return result.join('\n');
}

// チェックボックスを処理する関数
function processCheckbox(content) {
  // チェックボックス（チェック済み）
  if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
    return {
      hasCheckbox: true,
      checked: true,
      content: content.slice(4)
    };
  }
  // チェックボックス（未チェック）
  if (content.startsWith('[ ] ')) {
    return {
      hasCheckbox: true,
      checked: false,
      content: content.slice(4)
    };
  }
  return {
    hasCheckbox: false,
    checked: false,
    content: content
  };
}

// リスト行からネストされたHTMLを構築
function buildNestedList(lines) {
  if (lines.length === 0) return '';

  // インデントレベルを計算（スペース2つまたはタブ1つ = 1レベル）
  function getIndentLevel(line) {
    const match = line.match(/^(\s*)/);
    if (!match) return 0;
    const spaces = match[1].replace(/\t/g, '  ').length;
    return Math.floor(spaces / 2);
  }

  // 行のタイプとコンテンツを取得
  function parseLine(line) {
    const ulMatch = line.match(/^\s*- (.+)$/);
    const olMatch = line.match(/^\s*(\d+)\. (.+)$/);
    if (ulMatch) {
      return { type: 'ul', content: ulMatch[1], number: null };
    } else if (olMatch) {
      return { type: 'ol', content: olMatch[2], number: parseInt(olMatch[1], 10) };
    }
    return null;
  }

  let html = '';
  const stack = []; // { type: 'ul'|'ol', indent: number }
  let hasCheckboxList = false;
  let isFirstItem = true;

  for (const line of lines) {
    const indent = getIndentLevel(line);
    const parsed = parseLine(line);
    if (!parsed) continue;

    // チェックボックスを処理
    const checkbox = processCheckbox(parsed.content);
    let displayContent = checkbox.content;

    if (checkbox.hasCheckbox) {
      hasCheckboxList = true;
      const checkedAttr = checkbox.checked ? ' checked disabled' : ' disabled';
      displayContent = `<input type="checkbox"${checkedAttr}> <span class="${checkbox.checked ? 'checkbox-checked' : ''}">${checkbox.content}</span>`;
    }

    // スタックを調整（より深いネストから戻る場合）
    while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
      const popped = stack.pop();
      html += `</li></${popped.type}>`;
    }

    if (stack.length === 0) {
      // 最初のリスト開始
      const startAttr = (parsed.type === 'ol' && parsed.number !== 1) ? ` start="${parsed.number}"` : '';
      html += `<${parsed.type}${startAttr}><li>${displayContent}`;
      stack.push({ type: parsed.type, indent: indent });
    } else if (stack[stack.length - 1].indent === indent) {
      // 同じレベル - 新しいリストアイテム
      html += `</li><li>${displayContent}`;
    } else if (stack[stack.length - 1].indent < indent) {
      // より深いネスト - 新しいサブリスト開始
      const startAttr = (parsed.type === 'ol' && parsed.number !== 1) ? ` start="${parsed.number}"` : '';
      html += `<${parsed.type}${startAttr}><li>${displayContent}`;
      stack.push({ type: parsed.type, indent: indent });
    }
  }

  // 残りのタグを閉じる
  while (stack.length > 0) {
    const popped = stack.pop();
    html += `</li></${popped.type}>`;
  }

  // チェックボックスリストの場合、外側にクラスを追加
  if (hasCheckboxList && html.startsWith('<ul>')) {
    html = html.replace(/^<ul>/, '<ul class="checkbox-list">');
  }

  return html;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { parseMarkdown };

  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end('Server Error: ' + err.message);
  }
}).listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
