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
  
  // インラインコード
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 画像（リンクより先に処理！）
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
  
  // リンク
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  
  // 見出し（改行考慮）- IDを付与して目次用に収集
  const headings = [];
  let headingCounter = 0;

  function processHeading(level, title) {
    const id = `heading-${headingCounter++}`;
    headings.push({ level, title, id });
    return `<h${level} id="${id}">${title}</h${level}>`;
  }

  html = html.replace(/^##### (.+)$/gm, (m, title) => processHeading(5, title));
  html = html.replace(/^#### (.+)$/gm, (m, title) => processHeading(4, title));
  html = html.replace(/^### (.+)$/gm, (m, title) => processHeading(3, title));
  html = html.replace(/^## (.+)$/gm, (m, title) => processHeading(2, title));
  html = html.replace(/^# (.+)$/gm, (m, title) => processHeading(1, title));
  
  // 水平線（3つ以上のハイフン/アスタリスク/アンダースコア）
  html = html.replace(/\n---+\n/g, '\n<hr>\n');
  html = html.replace(/\n\*\*\*+\n/g, '\n<hr>\n');
  html = html.replace(/\n___+\n/g, '\n<hr>\n');
  
  // ネストされたリストをパース
  html = parseNestedLists(html);
  
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
    // プレースホルダーもスキップ
    if (p.match(/^___(CODE_BLOCK|BOOKMARK|ARTICLE)_\d+___$/) || p === '___CONTENTS___') {
      return p;
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

  // 目次を生成して復元
  if (hasContents) {
    const toc = createTableOfContents(headings);
    html = html.replace('___CONTENTS___', toc);
  }

  return html;
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
    // リスト行かチェック（- または 数字. で始まる）
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

  for (const line of lines) {
    const indent = getIndentLevel(line);
    const parsed = parseLine(line);
    if (!parsed) continue;

    // スタックを調整
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      const popped = stack.pop();
      html += `</li></${popped.type}>`;
    }

    // 新しいリストを開始するか、同じレベルで続けるか
    if (stack.length === 0 || stack[stack.length - 1].indent < indent) {
      // 新しいネストレベル
      const startAttr = (parsed.type === 'ol' && parsed.number !== 1) ? ` start="${parsed.number}"` : '';
      html += `<${parsed.type}${startAttr}><li>${parsed.content}`;
      stack.push({ type: parsed.type, indent: indent });
    } else {
      // 同じレベル（このケースはスタック調整後なので発生しない）
      html += `</li><li>${parsed.content}`;
    }
  }

  // 残りのタグを閉じる
  while (stack.length > 0) {
    const popped = stack.pop();
    html += `</li></${popped.type}>`;
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
