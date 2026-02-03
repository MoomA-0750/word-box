const { extractPlainText } = require('./markdown');

class SearchEngine {
  constructor() {
    this.documents = [];
  }

  // ドキュメントをインデックスに追加
  addDocument(doc) {
    // doc: { id (slug), title, content (markdown), tags, type (post/topic/magazine) }
    const plainText = extractPlainText(doc.content);
    
    this.documents.push({
      ...doc,
      plainText,
      // 検索用に正規化（小文字化など）
      normalizedTitle: doc.title.toLowerCase(),
      normalizedTags: (doc.tags || []).map(t => t.toLowerCase()),
      normalizedText: plainText.toLowerCase()
    });
  }

  // 全ドキュメントをクリア
  clear() {
    this.documents = [];
  }

  // 検索実行
  search(query) {
    if (!query || !query.trim()) {
      return [];
    }

    // クエリを単語に分割（空白区切り）
    const terms = query.toLowerCase().replace(/\s+/g, ' ').trim().split(' ');
    
    const results = this.documents.map(doc => {
      const score = this.calculateScore(doc, terms);
      if (score > 0) {
        return {
          item: doc,
          score,
          snippet: this.generateSnippet(doc.plainText, terms)
        };
      }
      return null;
    }).filter(r => r !== null);

    // スコア降順でソート
    return results.sort((a, b) => b.score - a.score);
  }

  // スコア計算
  calculateScore(doc, terms) {
    let score = 0;

    terms.forEach(term => {
      // タイトル一致 (重み: 10)
      if (doc.normalizedTitle.includes(term)) {
        score += 10;
        // 完全一致ならボーナス
        if (doc.normalizedTitle === term) score += 5;
      }

      // タグ一致 (重み: 5)
      if (doc.normalizedTags.some(tag => tag.includes(term))) {
        score += 5;
        if (doc.normalizedTags.includes(term)) score += 3;
      }

      // 本文一致 (重み: 1)
      // 出現回数をカウント
      const regex = new RegExp(this.escapeRegExp(term), 'g');
      const matches = (doc.normalizedText.match(regex) || []).length;
      score += matches * 1;
    });

    return score;
  }

  // スニペット生成（検索語周辺のテキストを抜粋）
  generateSnippet(text, terms) {
    if (!text) return '';

    // 最も重要そうな検索語（最初の語）を探す
    // 本来はIDFなどで重み付けすべきだが、簡易的に最初の語を使う
    const targetTerm = terms[0];
    const lowerText = text.toLowerCase();
    const index = lowerText.indexOf(targetTerm);

    const maxLength = 120; // スニペットの最大長
    
    if (index === -1) {
      // 見つからない場合は先頭を返す
      return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
    }

    // 前後のコンテキストを取得
    const contextLength = 40; // 前方の文字数
    let start = Math.max(0, index - contextLength);
    let end = Math.min(text.length, start + maxLength);

    // 文の途中から始まらないように調整（簡易的）
    if (start > 0) {
      const prevSpace = text.lastIndexOf(' ', start);
      if (prevSpace > start - 10) start = prevSpace + 1;
    }

    let snippet = text.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    // HTMLエスケープ（<mark>タグを入れる前に）
    snippet = this.escapeHtml(snippet);

    // ハイライト処理（HTMLタグ付与）
    // 検索語をマークアップ
    terms.forEach(term => {
      const regex = new RegExp(`(${this.escapeRegExp(term)})`, 'gi');
      snippet = snippet.replace(regex, '<mark>$1</mark>');
    });

    return snippet;
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

module.exports = new SearchEngine();