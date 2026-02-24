// ファジー検索対応の検索エンジン
// - fastest-levenshtein による高速ファジーマッチ
// - string-width による日本語対応スニペット切り詰め
// - 設定は lib/config.js から読み込む

const { extractPlainText } = require('./markdown');
const { distance: levenshtein, closest } = require('fastest-levenshtein');
const stringWidth = require('string-width');
const config = require('./config');
const { createLogger } = require('./logger');

const log = createLogger('search');

/**
 * 単語がターゲット内のいずれかの単語とファジーマッチするか判定
 * @param {string} term - 検索語
 * @param {string[]} words - 対象テキストの単語配列
 * @param {number} threshold - 最大許容レーベンシュタイン距離
 * @returns {number} 最小距離（マッチなしなら Infinity）
 */
function fuzzyMatchWords(term, words, threshold) {
  if (words.length === 0) return Infinity;

  // closest() で最も近い単語を O(n) で取得
  const nearestWord = closest(term, words);
  if (!nearestWord) return Infinity;

  const dist = levenshtein(term, nearestWord);
  return dist <= threshold ? dist : Infinity;
}

class SearchEngine {
  constructor() {
    this.documents = [];
  }

  // ドキュメントをインデックスに追加
  addDocument(doc) {
    const plainText = extractPlainText(doc.content);

    // ファジー検索用に単語に分割してキャッシュ
    const normalizedTitle = doc.title.toLowerCase();
    const normalizedText = plainText.toLowerCase();
    const titleWords = normalizedTitle.split(/\s+/).filter(w => w.length > 0);
    const textWords = normalizedText.split(/\s+/).filter(w => w.length > 0);

    this.documents.push({
      ...doc,
      plainText,
      normalizedTitle,
      normalizedTags: (doc.tags || []).map(t => t.toLowerCase()),
      normalizedKeywords: (doc.keywords || []).map(k => k.toLowerCase()),
      normalizedText,
      titleWords,
      textWords,
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

    const startTime = Date.now();
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

    results.sort((a, b) => b.score - a.score);

    log.timedLog(`Search "${query}" → ${results.length} results`, startTime);
    return results;
  }

  // スコア計算（ファジー検索対応）
  calculateScore(doc, terms) {
    let score = 0;
    const fuzzyThreshold = config.search.fuzzyThreshold;
    const fuzzyMinLength = config.search.fuzzyMinLength;

    terms.forEach(term => {
      // === 完全一致 / 部分一致（従来通り） ===

      // タイトル一致 (重み: 10)
      if (doc.normalizedTitle.includes(term)) {
        score += 10;
        if (doc.normalizedTitle === term) score += 5;
      }

      // タグ一致 (重み: 5)
      if (doc.normalizedTags.some(tag => tag.includes(term))) {
        score += 5;
        if (doc.normalizedTags.includes(term)) score += 3;
      }

      // キーワード一致 (重み: 5)
      if (doc.normalizedKeywords && doc.normalizedKeywords.some(kw => kw.includes(term))) {
        score += 5;
        if (doc.normalizedKeywords.includes(term)) score += 3;
      }

      // 本文一致 (重み: 1 × 出現回数)
      const regex = new RegExp(this.escapeRegExp(term), 'g');
      const matches = (doc.normalizedText.match(regex) || []).length;
      score += matches * 1;

      // === ファジーマッチ（完全一致で見つからなかった場合の補完） ===
      if (term.length >= fuzzyMinLength) {
        // タイトルのファジーマッチ (重み: 3)
        const titleDist = fuzzyMatchWords(term, doc.titleWords, fuzzyThreshold);
        if (titleDist > 0 && titleDist <= fuzzyThreshold) {
          score += Math.max(1, 4 - titleDist); // 距離1=3点, 距離2=2点
        }

        // タグのファジーマッチ (重み: 2) — closest で最近傍を高速取得
        if (doc.normalizedTags.length > 0) {
          const nearestTag = closest(term, doc.normalizedTags);
          if (nearestTag) {
            const dist = levenshtein(term, nearestTag);
            if (dist > 0 && dist <= fuzzyThreshold) {
              score += Math.max(1, 3 - dist);
            }
          }
        }

        // キーワードのファジーマッチ (重み: 2)
        if (doc.normalizedKeywords && doc.normalizedKeywords.length > 0) {
          const nearestKw = closest(term, doc.normalizedKeywords);
          if (nearestKw) {
            const dist = levenshtein(term, nearestKw);
            if (dist > 0 && dist <= fuzzyThreshold) {
              score += Math.max(1, 3 - dist);
            }
          }
        }
      }
    });

    return score;
  }

  // スニペット生成（string-width で日本語の表示幅を考慮して切り詰め）
  generateSnippet(text, terms) {
    if (!text) return '';

    const maxWidth = config.search.snippetLength;  // 表示幅ベース
    const contextLength = config.search.snippetContext;

    const targetTerm = terms[0];
    const lowerText = text.toLowerCase();
    const index = lowerText.indexOf(targetTerm);

    if (index === -1) {
      // 見つからない場合は先頭から表示幅ベースで切り詰め
      return this.truncateByWidth(text, maxWidth) + (stringWidth(text) > maxWidth ? '...' : '');
    }

    // 前後のコンテキストを取得
    let start = Math.max(0, index - contextLength);
    let end = Math.min(text.length, start + maxWidth);

    // 文の途中から始まらないように調整
    if (start > 0) {
      const prevSpace = text.lastIndexOf(' ', start);
      if (prevSpace > start - 10) start = prevSpace + 1;
    }

    // 表示幅ベースで末尾を調整
    let snippet = text.slice(start);
    snippet = this.truncateByWidth(snippet, maxWidth);

    if (start > 0) snippet = '...' + snippet;
    if (start + snippet.length < text.length) snippet = snippet + '...';

    snippet = this.escapeHtml(snippet);

    // ハイライト処理
    terms.forEach(term => {
      const regex = new RegExp(`(${this.escapeRegExp(term)})`, 'gi');
      snippet = snippet.replace(regex, '<mark>$1</mark>');
    });

    return snippet;
  }

  /**
   * string-width で表示幅を計算しながらテキストを切り詰め
   * 全角文字は幅2、半角は幅1として計算するため、
   * 日本語テキストでもバランス良く切り詰められる
   */
  truncateByWidth(text, maxWidth) {
    let width = 0;
    let i = 0;
    for (; i < text.length; i++) {
      // 1文字ずつ幅を加算（string-width で正確に計測）
      const charWidth = stringWidth(text[i]);
      if (width + charWidth > maxWidth) break;
      width += charWidth;
    }
    return text.slice(0, i);
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
