const { highlightCode } = require('./syntax-highlight');

async function parseMarkdown(text, allPosts = [], allMagazines = [], allDictEntries = []) {
  let html = text;

  // GitHubスタイルのコールアウト（引用ブロック内）- コードブロックより先に処理
  // replace コールバック内では await できないため、マッチを収集して後で処理
  const callouts = [];
  const calloutRegex = /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n((?:^>.*\n?)*)/gm;
  const calloutMatches = [];
  html = html.replace(calloutRegex, (match, type, content) => {
    const placeholder = `___CALLOUT_${calloutMatches.length}___`;
    calloutMatches.push({ type, content });
    return placeholder;
  });

  for (const { type, content } of calloutMatches) {
    const cleanContent = content
      .split('\n')
      .map(line => line.replace(/^>\s?/, ''))
      .join('\n')
      .trim();

    // コールアウト内のコードブロックを先に保護してから再帰的にパース
    const calloutCodeBlocks = [];
    const calloutCodeData = [];
    const protectedContent = cleanContent.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const cbPlaceholder = `___CALLOUT_CODE_${calloutCodeBlocks.length}___`;
      const language = lang || 'text';
      calloutCodeData.push({ code: code.trim(), language });
      calloutCodeBlocks.push(cbPlaceholder); // 仮置き
      return cbPlaceholder;
    });

    // コールアウト内コードブロックにハイライト適用
    for (let ci = 0; ci < calloutCodeData.length; ci++) {
      const { code: rawCode, language: lang } = calloutCodeData[ci];
      const highlighted = await highlightCode(rawCode, lang);
      calloutCodeBlocks[ci] = `
<div class="code-block">
  <div class="code-header">
    <span class="code-language">${lang}</span>
    <button class="copy-button">コピー</button>
  </div>
  <pre><code class="language-${lang}">${highlighted}</code></pre>
</div>`;
    }

    // 再帰的にMarkdownパースを適用（コードブロック以外の要素）
    let parsedContent = await parseMarkdown(protectedContent, allPosts, allMagazines, allDictEntries);

    // コールアウト内のコードブロックを復元
    calloutCodeBlocks.forEach((code, i) => {
      parsedContent = parsedContent.replace(`___CALLOUT_CODE_${i}___`, code);
    });

    callouts.push(createCallout(type, parsedContent));
  }

  // コードブロック（先に処理して保護）
  const codeBlocks = [];
  const codeBlockData = []; // ハイライト用にコードと言語を保存
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

    codeBlockData.push({ code: code.trim(), language });
    codeBlocks.push(codeBlockHtml);
    return placeholder;
  });

  // コードブロックにシンタックスハイライトを適用
  for (let ci = 0; ci < codeBlockData.length; ci++) {
    const { code: rawCode, language: lang } = codeBlockData[ci];
    const highlighted = await highlightCode(rawCode, lang);
    codeBlocks[ci] = `
<div class="code-block">
  <div class="code-header">
    <span class="code-language">${lang}</span>
    <button class="copy-button">コピー</button>
  </div>
  <pre><code class="language-${lang}">${highlighted}</code></pre>
</div>`;
  }

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

  // マガジンカード
  const magazineCards = [];
  html = html.replace(/:::magazine\n([^\n]+)\n:::/g, (match, slug) => {
    const placeholder = `___MAGAZINE_${magazineCards.length}___`;
    magazineCards.push(createMagazineCard(slug.trim(), allMagazines, allPosts));
    return placeholder;
  });

  // 辞書カード（バナー埋め込み）
  const dictionaryCards = [];
  html = html.replace(/:::dictionary\n([^\n]+)\n:::/g, (match, slug) => {
    const placeholder = `___DICTIONARY_${dictionaryCards.length}___`;
    dictionaryCards.push(createDictionaryCard(slug.trim(), allDictEntries));
    return placeholder;
  });

  // 目次は自動生成（:::contents::: プレースホルダーは廃止）

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

  // 下線 (++underline++)
  html = html.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');

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
    if (p.match(/^___(CODE_BLOCK|BOOKMARK|ARTICLE|MAGAZINE|DICTIONARY|CALLOUT|TABLE)_?\d*___$/)) {
      return p;
    }
    // プレースホルダーを含む複合段落の処理
    if (p.match(/___(CODE_BLOCK|BOOKMARK|ARTICLE|MAGAZINE|DICTIONARY|CALLOUT|TABLE)_?\d*___/)) {
      // プレースホルダーと通常テキストを分離して処理
      const parts = p.split(/(___(CODE_BLOCK|BOOKMARK|ARTICLE|MAGAZINE|CALLOUT|TABLE)_?\d*___)/);
      return parts.map(part => {
        if (part.match(/^___(CODE_BLOCK|BOOKMARK|ARTICLE|MAGAZINE|DICTIONARY|CALLOUT|TABLE)_?\d*___$/)) {
          return part;
        }
        if (part.match(/^(CODE_BLOCK|BOOKMARK|ARTICLE|MAGAZINE|DICTIONARY|CALLOUT|TABLE)$/)) {
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

  // マガジンカードを復元
  magazineCards.forEach((card, i) => {
    html = html.replace(`___MAGAZINE_${i}___`, card);
  });

  // 辞書カードを復元
  dictionaryCards.forEach((card, i) => {
    html = html.replace(`___DICTIONARY_${i}___`, card);
  });

  // コールアウトを復元
  callouts.forEach((callout, i) => {
    html = html.replace(`___CALLOUT_${i}___`, callout);
  });

  // テーブルを復元
  tables.forEach((table, i) => {
    html = html.replace(`___TABLE_${i}___`, table);
  });

  // 見出しがある場合は目次を自動生成してコンテンツ先頭に挿入
  const tocHeadingsForAuto = headings.filter(h => h.level >= 2 && h.level <= 4);
  if (tocHeadingsForAuto.length > 0) {
    const toc = createTableOfContents(headings);
    html = toc + '\n' + html;
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
  // contentは既にMarkdownパース済みのHTMLなので、エスケープせずそのまま使用

  return `
<div class="callout ${config.className}">
  <div class="callout-header">
    <span class="callout-icon">${config.icon}</span>
    <span class="callout-label">${config.label}</span>
  </div>
  <div class="callout-content">${content}</div>
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
    // 下線
    result = result.replace(/\+\+(.+?)\+\+/g, '<u>$1</u>');
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

function createMagazineCard(slug, allMagazines, allPosts) {
  // slugに該当するマガジンを検索
  const magazine = allMagazines.find(m => m.slug === slug);

  if (!magazine) {
    // マガジンが見つからない場合
    return `
<div class="magazine-card-embed magazine-card-notfound">
  <div class="magazine-card-icon">❌</div>
  <div class="magazine-card-content">
    <div class="magazine-card-title">マガジンが見つかりません</div>
    <div class="magazine-card-meta">${escapeHtml(slug)}</div>
  </div>
</div>`;
  }

  // 収録記事数
  const articleCount = magazine.articles.length;

  return `
<a href="/magazines/${escapeHtml(magazine.slug)}" class="magazine-card-embed">
  <div class="magazine-card-icon">${escapeHtml(magazine.emoji)}</div>
  <div class="magazine-card-content">
    <div class="magazine-card-title">${escapeHtml(magazine.title)}</div>
    <div class="magazine-card-meta">
      <span class="magazine-card-description">${escapeHtml(magazine.description)}</span>
      <span class="magazine-card-count">${articleCount}件の記事</span>
    </div>
  </div>
  <div class="magazine-card-arrow">→</div>
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

function createDictionaryCard(slug, allDictEntries) {
  // slugに該当する辞書項目を検索
  const entry = allDictEntries.find(e => e.slug === slug);

  if (!entry) {
    // 辞書項目が見つからない場合
    return `
<div class="dictionary-card-embed dictionary-card-notfound">
  <div class="dictionary-card-icon">❌</div>
  <div class="dictionary-card-content">
    <div class="dictionary-card-title">辞書項目が見つかりません</div>
    <div class="dictionary-card-meta">${escapeHtml(slug)}</div>
  </div>
</div>`;
  }

  return `
<a href="/dictionary/${escapeHtml(entry.slug)}" class="dictionary-card-embed">
  <div class="dictionary-card-badge">📖 辞書</div>
  <div class="dictionary-card-body">
    <div class="dictionary-card-icon">${escapeHtml(entry.emoji)}</div>
    <div class="dictionary-card-content">
      <div class="dictionary-card-title">${escapeHtml(entry.title)}</div>
      ${entry.reading ? `<div class="dictionary-card-reading">${escapeHtml(entry.reading)}</div>` : ''}
      <div class="dictionary-card-desc">${escapeHtml(entry.description)}</div>
    </div>
    <div class="dictionary-card-arrow">→</div>
  </div>
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

// 検索インデックス用にプレーンテキストを抽出する関数
function extractPlainText(text) {
  if (!text) return '';

  let plain = text;

  // コードブロックのフェンスを除去（中身は残す）
  plain = plain.replace(/```(\w+)?\n/g, '').replace(/```/g, '');

  // 独自ブロックを除去 (:::bookmark, :::article, :::magazine, :::dictionary)
  plain = plain.replace(/:::(bookmark|article|magazine|dictionary)\n[\s\S]*?:::/g, '');

  // GitHubスタイルのコールアウトを除去
  plain = plain.replace(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n/gm, '');

  // 画像（altテキストのみ残す）
  plain = plain.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1');

  // リンク（テキストのみ残す）
  plain = plain.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');

  // 見出しのハッシュを除去
  plain = plain.replace(/^#{1,6}\s+/gm, '');

  // 水平線を除去
  plain = plain.replace(/\n[-*_]{3,}\n/g, '\n');

  // 太字、斜体、打ち消し線、下線を除去
  plain = plain.replace(/(\*\*|__)(.*?)\1/g, '$2');
  plain = plain.replace(/(\*|_)(.*?)\1/g, '$2');
  plain = plain.replace(/~~(.*?)~~/g, '$1');
  plain = plain.replace(/\+\+(.*?)\+\+/g, '$1');

  // インラインコードのバッククォートを除去
  plain = plain.replace(/`([^`]+)`/g, '$1');

  // 引用記号を除去
  plain = plain.replace(/^>\s+/gm, '');

  // リストマーカーを除去
  plain = plain.replace(/^[\s-]*[-+*]\s+/gm, '');
  plain = plain.replace(/^\s*\d+\.\s+/gm, '');

  // HTMLタグを除去
  plain = plain.replace(/<[^>]*>/g, '');

  // 連続する空白・改行を整理
  plain = plain.replace(/\s+/g, ' ').trim();

  return plain;
}

module.exports = { parseMarkdown, extractPlainText };
