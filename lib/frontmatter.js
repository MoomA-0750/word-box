// lib/frontmatter.js

function parseFrontMatter(text) {
  // 改行コードを統一（保険）
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  const frontMatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = text.match(frontMatterRegex);
  
  if (!match) {
    return {
      metadata: {},
      content: text
    };
  }
  
  const metadataText = match[1];
  const content = match[2];
  
  const metadata = {};
  metadataText.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return;
    
    const key = line.substring(0, colonIndex).trim();
    let value = line.substring(colonIndex + 1).trim();
    
    if (key && value) {
      // tagsフィールドとarticlesフィールドは配列として解析
      if (key === 'tags' || key === 'articles') {
        try {
          // JSON配列として解析
          metadata[key] = JSON.parse(value);
        } catch (e) {
          // パースに失敗した場合は空配列
          metadata[key] = [];
        }
      } else if (value === 'true') {
        metadata[key] = true;
      } else if (value === 'false') {
        metadata[key] = false;
      } else {
        metadata[key] = value;
      }
    }
  });
  
  return { metadata, content };
}

module.exports = { parseFrontMatter };
