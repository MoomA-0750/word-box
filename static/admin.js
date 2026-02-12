// static/admin.js

const state = {
  currentSection: 'posts',
  articles: [],
  images: [],
  tags: [],
  editingId: null,
  isNew: false,
  editingImageFilename: null
};

// DOM要素
const elements = {
  sectionTitle: document.getElementById('sectionTitle'),
  itemList: document.getElementById('itemList'),
  listView: document.getElementById('listView'),
  editorView: document.getElementById('editorView'),
  imagesView: document.getElementById('imagesView'),
  tagsView: document.getElementById('tagsView'),
  searchInput: document.getElementById('searchInput'),
  newBtn: document.getElementById('newBtn'),
  rebuildBtn: document.getElementById('rebuildBtn'),
  backBtn: document.getElementById('backBtn'),
  saveBtn: document.getElementById('saveBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  imageModal: document.getElementById('imageModal'),
  closeModal: document.getElementById('closeModal'),
  uploadArea: document.getElementById('uploadArea'),
  fileInput: document.getElementById('fileInput'),
  imageGrid: document.getElementById('imageGrid'),
  modalImageGrid: document.getElementById('modalImageGrid'),
  tagList: document.getElementById('tagList'),
  magazineArticlesGroup: document.getElementById('magazineArticlesGroup'),
  metadataModal: document.getElementById('metadataModal'),
  closeMetadataModal: document.getElementById('closeMetadataModal'),
  cancelMetadata: document.getElementById('cancelMetadata'),
  saveMetadata: document.getElementById('saveMetadata'),
  metadataImage: document.getElementById('metadataImage'),
  metadataFilename: document.getElementById('metadataFilename'),
  metadataName: document.getElementById('metadataName'),
  metadataAlt: document.getElementById('metadataAlt'),
  metadataDescription: document.getElementById('metadataDescription'),
  metadataTags: document.getElementById('metadataTags')
};

// 初期化
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEventListeners();
  loadSection('posts');
});

// ナビゲーション設定
function setupNavigation() {
  document.querySelectorAll('.nav-item[data-section]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      loadSection(section);
    });
  });
}

// イベントリスナー設定
function setupEventListeners() {
  elements.newBtn.addEventListener('click', () => createNew());
  elements.rebuildBtn.addEventListener('click', () => rebuildIndex());
  elements.backBtn.addEventListener('click', () => showList());
  elements.saveBtn.addEventListener('click', () => saveArticle());
  elements.deleteBtn.addEventListener('click', () => deleteArticle());
  elements.searchInput.addEventListener('input', () => filterList());
  elements.closeModal.addEventListener('click', () => hideModal());

  // メタデータモーダル
  elements.closeMetadataModal.addEventListener('click', () => hideMetadataModal());
  elements.cancelMetadata.addEventListener('click', () => hideMetadataModal());
  elements.saveMetadata.addEventListener('click', () => saveImageMetadata());

  // 画像アップロード
  elements.uploadArea.addEventListener('click', () => elements.fileInput.click());
  elements.uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadArea.style.borderColor = 'var(--link-color)';
  });
  elements.uploadArea.addEventListener('dragleave', () => {
    elements.uploadArea.style.borderColor = '';
  });
  elements.uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadArea.style.borderColor = '';
    handleFileUpload(e.dataTransfer.files);
  });
  elements.fileInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files);
  });

  // ツールバー
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => handleToolbar(btn.dataset.action));
  });
}

// セクション読み込み
async function loadSection(section) {
  state.currentSection = section;
  showList();

  const titles = {
    posts: '記事',
    topics: 'トピック',
    magazines: 'マガジン',
    images: '画像',
    tags: 'タグ'
  };
  elements.sectionTitle.textContent = titles[section];

  // ビュー切り替え
  elements.listView.style.display = ['posts', 'topics', 'magazines'].includes(section) ? 'block' : 'none';
  elements.imagesView.style.display = section === 'images' ? 'block' : 'none';
  elements.tagsView.style.display = section === 'tags' ? 'block' : 'none';
  elements.newBtn.style.display = ['posts', 'topics', 'magazines'].includes(section) ? 'inline-flex' : 'none';

  if (section === 'images') {
    await loadImages();
  } else if (section === 'tags') {
    await loadTags();
  } else {
    await loadArticles();
  }
}

// 記事一覧読み込み
async function loadArticles() {
  try {
    const res = await fetch(`/admin/api/${state.currentSection}`);
    state.articles = await res.json();
    renderArticleList();
  } catch (err) {
    showToast('読み込みに失敗しました', 'error');
  }
}

// 記事一覧表示
function renderArticleList() {
  const filtered = filterArticles(state.articles);
  elements.itemList.innerHTML = filtered.map(article => `
    <div class="list-item" data-id="${article.id}">
      <div class="list-item-emoji">${article.emoji}</div>
      <div class="list-item-info">
        <div class="list-item-title">${escapeHtml(article.title)}</div>
        <div class="list-item-meta">
          <span>${article.date || '日付なし'}</span>
          <span>${article.id}</span>
        </div>
      </div>
      <div class="list-item-status ${article.listed ? 'status-public' : 'status-draft'}">
        ${article.listed ? '公開' : '下書き'}
      </div>
    </div>
  `).join('');

  // クリックイベント
  elements.itemList.querySelectorAll('.list-item').forEach(item => {
    item.addEventListener('click', () => editArticle(item.dataset.id));
  });
}

// 記事フィルタリング
function filterArticles(articles) {
  const query = elements.searchInput.value.toLowerCase();
  if (!query) return articles;
  return articles.filter(a =>
    a.title.toLowerCase().includes(query) ||
    a.id.toLowerCase().includes(query) ||
    (a.tags || []).some(t => t.toLowerCase().includes(query))
  );
}

function filterList() {
  renderArticleList();
}

// 新規作成
function createNew() {
  state.isNew = true;
  state.editingId = null;
  showEditor();
  clearForm();

  // デフォルト値
  document.getElementById('articleDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('articleEmoji').value = state.currentSection === 'magazines' ? '📚' : '📝';
}

// 記事編集
async function editArticle(id) {
  try {
    const res = await fetch(`/admin/api/${state.currentSection}/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error('Not found');

    const article = await res.json();
    state.isNew = false;
    state.editingId = id;
    showEditor();
    fillForm(article);
  } catch (err) {
    showToast('記事の読み込みに失敗しました', 'error');
  }
}

// エディタ表示
function showEditor() {
  elements.listView.style.display = 'none';
  elements.editorView.style.display = 'block';
  elements.deleteBtn.style.display = state.isNew ? 'none' : 'inline-flex';

  // マガジン用フィールド表示切り替え
  elements.magazineArticlesGroup.style.display = state.currentSection === 'magazines' ? 'block' : 'none';
}

// 一覧表示
function showList() {
  elements.listView.style.display = 'block';
  elements.editorView.style.display = 'none';
}

// フォームクリア
function clearForm() {
  document.getElementById('articleId').value = '';
  document.getElementById('articleTitle').value = '';
  document.getElementById('articleDate').value = '';
  document.getElementById('articleEmoji').value = '';
  document.getElementById('articleTags').value = '';
  document.getElementById('articleDescription').value = '';
  document.getElementById('articleListed').checked = true;
  document.getElementById('articleBody').value = '';
  document.getElementById('magazineArticles').value = '';
}

// フォーム入力
function fillForm(article) {
  document.getElementById('articleId').value = article.id;
  document.getElementById('articleTitle').value = article.metadata.title || '';
  document.getElementById('articleDate').value = article.metadata.date || '';
  document.getElementById('articleEmoji').value = article.metadata.emoji || '';
  document.getElementById('articleTags').value = (article.metadata.tags || []).join(', ');
  document.getElementById('articleDescription').value = article.metadata.quicklook || article.metadata.description || '';
  document.getElementById('articleListed').checked = article.metadata.listed !== false;
  document.getElementById('articleBody').value = article.body || '';

  if (state.currentSection === 'magazines') {
    document.getElementById('magazineArticles').value = (article.metadata.articles || []).join('\n');
  }
}

// 記事保存
async function saveArticle() {
  const id = document.getElementById('articleId').value.trim();
  if (!id) {
    showToast('IDを入力してください', 'error');
    return;
  }

  const metadata = {
    title: document.getElementById('articleTitle').value,
    date: document.getElementById('articleDate').value,
    emoji: document.getElementById('articleEmoji').value,
    tags: document.getElementById('articleTags').value.split(',').map(t => t.trim()).filter(t => t),
    listed: document.getElementById('articleListed').checked
  };

  // quicklook / description
  const desc = document.getElementById('articleDescription').value;
  if (state.currentSection === 'magazines') {
    metadata.description = desc;
    metadata.articles = document.getElementById('magazineArticles').value.split('\n').map(s => s.trim()).filter(s => s);
  } else {
    metadata.quicklook = desc;
  }

  const body = document.getElementById('articleBody').value;

  try {
    const url = state.isNew
      ? `/admin/api/${state.currentSection}`
      : `/admin/api/${state.currentSection}/${encodeURIComponent(state.editingId)}`;

    const method = state.isNew ? 'POST' : 'PUT';
    const payload = state.isNew
      ? { id, metadata, body }
      : { newId: id, metadata, body };

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Save failed');

    showToast('保存しました', 'success');
    await loadArticles();
    showList();
  } catch (err) {
    showToast('保存に失敗しました', 'error');
  }
}

// 記事削除
async function deleteArticle() {
  if (!confirm('本当に削除しますか？')) return;

  try {
    const res = await fetch(`/admin/api/${state.currentSection}/${encodeURIComponent(state.editingId)}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Delete failed');

    showToast('削除しました', 'success');
    await loadArticles();
    showList();
  } catch (err) {
    showToast('削除に失敗しました', 'error');
  }
}

// 画像読み込み
async function loadImages() {
  try {
    const res = await fetch('/admin/api/images');
    state.images = await res.json();
    renderImageGrid();
  } catch (err) {
    showToast('画像の読み込みに失敗しました', 'error');
  }
}

// 画像グリッド表示
function renderImageGrid(target = elements.imageGrid, selectable = false) {
  target.innerHTML = state.images.map(img => {
    const displayName = img.name || img.filename;
    const tags = img.tags.length > 0 ? `<div class="image-card-tags">${img.tags.map(t => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('')}</div>` : '';

    return `
      <div class="image-card" data-url="${img.url}" data-filename="${img.filename}">
        <img src="${img.url}" alt="${escapeHtml(img.alt || img.filename)}" loading="lazy">
        <div class="image-card-info">
          <div class="image-card-name" title="${escapeHtml(img.filename)}">${escapeHtml(displayName)}</div>
          ${tags}
          ${!selectable ? `
          <div class="image-card-actions">
            <button class="btn-edit" onclick="editImageMetadata('${img.filename}')">編集</button>
            <button class="btn-copy" onclick="copyImageUrl('${img.url}')">コピー</button>
            <button class="btn-delete-img" onclick="deleteImage('${img.filename}')">削除</button>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  if (selectable) {
    target.querySelectorAll('.image-card').forEach(card => {
      card.addEventListener('click', () => {
        const filename = card.dataset.filename;
        const image = state.images.find(img => img.filename === filename);
        insertImageToEditor(image);
        hideModal();
      });
    });
  }
}

// 画像URL コピー
function copyImageUrl(url) {
  navigator.clipboard.writeText(url);
  showToast('URLをコピーしました', 'success');
}

// 画像削除
async function deleteImage(filename) {
  if (!confirm('この画像を削除しますか？')) return;

  try {
    const res = await fetch(`/admin/api/images/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Delete failed');

    showToast('削除しました', 'success');
    await loadImages();
  } catch (err) {
    showToast('削除に失敗しました', 'error');
  }
}

// ファイルアップロード処理
async function handleFileUpload(files) {
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/admin/api/images', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error('Upload failed');

      const result = await res.json();
      showToast(`${result.originalFilename} をアップロードしました`, 'success');
    } catch (err) {
      showToast(`${file.name} のアップロードに失敗しました`, 'error');
    }
  }

  await loadImages();
}

// タグ読み込み
async function loadTags() {
  try {
    const res = await fetch('/admin/api/tags');
    state.tags = await res.json();
    renderTagList();
  } catch (err) {
    showToast('タグの読み込みに失敗しました', 'error');
  }
}

// タグ一覧表示
function renderTagList() {
  elements.tagList.innerHTML = state.tags.map(tag => `
    <div class="tag-item">
      <span class="tag-item-name">${escapeHtml(tag.name)}</span>
      <span class="tag-item-count">${tag.count}</span>
    </div>
  `).join('');
}

// 検索インデックス再構築
async function rebuildIndex() {
  try {
    elements.rebuildBtn.disabled = true;
    elements.rebuildBtn.textContent = '⏳ 処理中...';

    const res = await fetch('/admin/api/rebuild-index', { method: 'POST' });
    if (!res.ok) throw new Error('Rebuild failed');

    showToast('検索インデックスを再構築しました', 'success');
  } catch (err) {
    showToast('再構築に失敗しました', 'error');
  } finally {
    elements.rebuildBtn.disabled = false;
    elements.rebuildBtn.textContent = '🔄 再構築';
  }
}

// ツールバー処理
function handleToolbar(action) {
  const textarea = document.getElementById('articleBody');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  const selected = text.substring(start, end);

  let replacement = '';
  let cursorOffset = 0;

  switch (action) {
    case 'bold':
      replacement = `**${selected}**`;
      cursorOffset = selected ? 0 : 2;
      break;
    case 'italic':
      replacement = `*${selected}*`;
      cursorOffset = selected ? 0 : 1;
      break;
    case 'code':
      if (selected.includes('\n')) {
        replacement = `\`\`\`\n${selected}\n\`\`\``;
      } else {
        replacement = `\`${selected}\``;
        cursorOffset = selected ? 0 : 1;
      }
      break;
    case 'link':
      replacement = `[${selected || 'リンクテキスト'}](url)`;
      break;
    case 'image':
      showImageModal();
      return;
    case 'h2':
      replacement = `## ${selected}`;
      break;
    case 'h3':
      replacement = `### ${selected}`;
      break;
  }

  textarea.value = text.substring(0, start) + replacement + text.substring(end);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + replacement.length - cursorOffset;
}

// 画像モーダル表示
function showImageModal() {
  elements.imageModal.style.display = 'flex';
  renderImageGrid(elements.modalImageGrid, true);
}

// モーダル非表示
function hideModal() {
  elements.imageModal.style.display = 'none';
}

// エディタに画像挿入
function insertImageToEditor(image) {
  const textarea = document.getElementById('articleBody');
  const start = textarea.selectionStart;
  const text = textarea.value;
  const alt = image.alt || image.name || '画像';
  const imageMarkdown = `![${alt}](${image.url})`;

  textarea.value = text.substring(0, start) + imageMarkdown + text.substring(start);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + imageMarkdown.length;
}

// 画像メタデータ編集モーダルを表示
function editImageMetadata(filename) {
  const image = state.images.find(img => img.filename === filename);
  if (!image) return;

  state.editingImageFilename = filename;

  elements.metadataImage.src = image.url;
  elements.metadataFilename.textContent = filename;
  elements.metadataName.value = image.name || '';
  elements.metadataAlt.value = image.alt || '';
  elements.metadataDescription.value = image.description || '';
  elements.metadataTags.value = image.tags.join(', ');

  elements.metadataModal.style.display = 'flex';
}

// 画像メタデータを保存
async function saveImageMetadata() {
  if (!state.editingImageFilename) return;

  const metadata = {
    name: elements.metadataName.value.trim(),
    alt: elements.metadataAlt.value.trim(),
    description: elements.metadataDescription.value.trim(),
    tags: elements.metadataTags.value.split(',').map(t => t.trim()).filter(t => t)
  };

  try {
    const res = await fetch(`/admin/api/images/${encodeURIComponent(state.editingImageFilename)}/metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });

    if (!res.ok) throw new Error('Save failed');

    showToast('メタデータを保存しました', 'success');
    hideMetadataModal();
    await loadImages();
  } catch (err) {
    showToast('保存に失敗しました', 'error');
  }
}

// メタデータモーダルを非表示
function hideMetadataModal() {
  elements.metadataModal.style.display = 'none';
  state.editingImageFilename = null;
}

// トースト表示
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// HTMLエスケープ
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// グローバル関数として公開
window.copyImageUrl = copyImageUrl;
window.deleteImage = deleteImage;
window.editImageMetadata = editImageMetadata;
