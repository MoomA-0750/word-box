// static/admin.js

const state = {
  currentSection: 'posts',
  articles: [],
  images: [],
  files: [],
  tags: [],
  editingId: null,
  isNew: false,
  editingImageFilename: null,
  editingFileFilename: null,
  previewVisible: false,
  previewTimer: null
};

// DOM要素
const elements = {
  sectionTitle: document.getElementById('sectionTitle'),
  itemList: document.getElementById('itemList'),
  listView: document.getElementById('listView'),
  editorView: document.getElementById('editorView'),
  imagesView: document.getElementById('imagesView'),
  filesView: document.getElementById('filesView'),
  tagsView: document.getElementById('tagsView'),
  searchInput: document.getElementById('searchInput'),
  newBtn: document.getElementById('newBtn'),
  rebuildBtn: document.getElementById('rebuildBtn'),
  backBtn: document.getElementById('backBtn'),
  saveBtn: document.getElementById('saveBtn'),
  deleteBtn: document.getElementById('deleteBtn'),
  imageModal: document.getElementById('imageModal'),
  closeModal: document.getElementById('closeModal'),
  fileModal: document.getElementById('fileModal'),
  closeFileModal: document.getElementById('closeFileModal'),
  modalFileList: document.getElementById('modalFileList'),
  uploadArea: document.getElementById('uploadArea'),
  fileInput: document.getElementById('fileInput'),
  imageGrid: document.getElementById('imageGrid'),
  modalImageGrid: document.getElementById('modalImageGrid'),
  fileUploadArea: document.getElementById('fileUploadArea'),
  fileFileInput: document.getElementById('fileFileInput'),
  fileList: document.getElementById('fileList'),
  tagList: document.getElementById('tagList'),
  magazineArticlesGroup: document.getElementById('magazineArticlesGroup'),
  dictionaryFieldsGroup: document.getElementById('dictionaryFieldsGroup'),
  metadataModal: document.getElementById('metadataModal'),
  closeMetadataModal: document.getElementById('closeMetadataModal'),
  cancelMetadata: document.getElementById('cancelMetadata'),
  saveMetadata: document.getElementById('saveMetadata'),
  metadataImage: document.getElementById('metadataImage'),
  metadataFilename: document.getElementById('metadataFilename'),
  metadataName: document.getElementById('metadataName'),
  metadataAlt: document.getElementById('metadataAlt'),
  metadataDescription: document.getElementById('metadataDescription'),
  metadataTags: document.getElementById('metadataTags'),
  fileMetadataModal: document.getElementById('fileMetadataModal'),
  closeFileMetadataModal: document.getElementById('closeFileMetadataModal'),
  cancelFileMetadata: document.getElementById('cancelFileMetadata'),
  saveFileMetadata: document.getElementById('saveFileMetadata'),
  fileMetadataFilename: document.getElementById('fileMetadataFilename'),
  fileMetadataUrl: document.getElementById('fileMetadataUrl'),
  fileMetadataName: document.getElementById('fileMetadataName'),
  fileMetadataDescription: document.getElementById('fileMetadataDescription'),
  fileMetadataTags: document.getElementById('fileMetadataTags'),
  imageUploadProgress: document.getElementById('imageUploadProgress'),
  fileUploadProgress: document.getElementById('fileUploadProgress'),
  publicPageLink: document.getElementById('publicPageLink'),
  togglePreviewBtn: document.getElementById('togglePreviewBtn'),
  previewPanel: document.getElementById('previewPanel'),
  previewContent: document.getElementById('previewContent'),
  previewStatus: document.getElementById('previewStatus'),
  editorBodyContainer: document.querySelector('.editor-body-container')
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
  elements.closeFileModal.addEventListener('click', () => hideFileModal());

  // 画像メタデータモーダル
  elements.closeMetadataModal.addEventListener('click', () => hideMetadataModal());
  elements.cancelMetadata.addEventListener('click', () => hideMetadataModal());
  elements.saveMetadata.addEventListener('click', () => saveImageMetadata());

  // ファイルメタデータモーダル
  elements.closeFileMetadataModal.addEventListener('click', () => hideFileMetadataModal());
  elements.cancelFileMetadata.addEventListener('click', () => hideFileMetadataModal());
  elements.saveFileMetadata.addEventListener('click', () => saveFileMetadata());

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

  // ファイルアップロード
  elements.fileUploadArea.addEventListener('click', () => elements.fileFileInput.click());
  elements.fileUploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.fileUploadArea.style.borderColor = 'var(--link-color)';
  });
  elements.fileUploadArea.addEventListener('dragleave', () => {
    elements.fileUploadArea.style.borderColor = '';
  });
  elements.fileUploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.fileUploadArea.style.borderColor = '';
    handleFileFileUpload(e.dataTransfer.files);
  });
  elements.fileFileInput.addEventListener('change', (e) => {
    handleFileFileUpload(e.target.files);
  });

  // ツールバー
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.addEventListener('click', () => handleToolbar(btn.dataset.action));
  });

  // プレビュートグル
  elements.togglePreviewBtn.addEventListener('click', () => {
    state.previewVisible = !state.previewVisible;
    elements.previewPanel.style.display = state.previewVisible ? 'flex' : 'none';
    elements.togglePreviewBtn.textContent = state.previewVisible ? '✏️ エディタのみ' : '👁️ プレビュー';
    if (state.previewVisible) {
      elements.editorBodyContainer.classList.add('with-preview');
      updatePreview();
    } else {
      elements.editorBodyContainer.classList.remove('with-preview');
    }
  });

  // テキストエリア入力時にプレビュー更新（デバウンス付き）
  document.getElementById('articleBody').addEventListener('input', () => {
    if (state.previewVisible) {
      clearTimeout(state.previewTimer);
      elements.previewStatus.textContent = '⏳ 更新待ち...';
      state.previewTimer = setTimeout(() => updatePreview(), 500);
    }
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
    dictionary: '辞書',
    images: '画像',
    files: 'ファイル',
    tags: 'タグ'
  };
  elements.sectionTitle.textContent = titles[section];

  // ビュー切り替え
  elements.listView.style.display = ['posts', 'topics', 'magazines', 'dictionary'].includes(section) ? 'block' : 'none';
  elements.imagesView.style.display = section === 'images' ? 'block' : 'none';
  elements.filesView.style.display = section === 'files' ? 'block' : 'none';
  elements.tagsView.style.display = section === 'tags' ? 'block' : 'none';
  elements.newBtn.style.display = ['posts', 'topics', 'magazines', 'dictionary'].includes(section) ? 'inline-flex' : 'none';

  if (section === 'images') {
    await loadImages();
  } else if (section === 'files') {
    await loadFiles();
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
  const defaultEmojis = { magazines: '📚', dictionary: '📖' };
  document.getElementById('articleEmoji').value = defaultEmojis[state.currentSection] || '📝';
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

  // 辞書用フィールド表示切り替え
  elements.dictionaryFieldsGroup.style.display = state.currentSection === 'dictionary' ? 'block' : 'none';

  // 公開ページリンクを更新
  updatePublicPageLink();
}

// 一覧表示
function showList() {
  elements.listView.style.display = 'block';
  elements.editorView.style.display = 'none';
}

// 公開ページリンクを更新
function updatePublicPageLink() {
  const link = elements.publicPageLink;
  if (state.isNew) {
    link.style.display = 'none';
    return;
  }

  const id = state.editingId || document.getElementById('articleId').value;
  if (!id) {
    link.style.display = 'none';
    return;
  }

  const sectionPath = {
    posts: '/posts/',
    topics: '/topics/',
    magazines: '/magazines/',
    dictionary: '/dictionary/'
  };

  const basePath = sectionPath[state.currentSection] || '/posts/';
  link.href = basePath + encodeURIComponent(id);
  link.style.display = 'inline-flex';
}

// Markdownプレビューを更新
async function updatePreview() {
  const markdown = document.getElementById('articleBody').value;
  if (!markdown.trim()) {
    elements.previewContent.innerHTML = '';
    elements.previewStatus.textContent = '';
    return;
  }

  elements.previewStatus.textContent = '⏳ レンダリング中...';

  try {
    const res = await fetch('/admin/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown })
    });

    if (!res.ok) throw new Error('Preview failed');

    const data = await res.json();
    elements.previewContent.innerHTML = data.html;
    elements.previewStatus.textContent = '✅ 更新済み';

    // ステータスを3秒後にクリア
    setTimeout(() => {
      if (elements.previewStatus.textContent === '✅ 更新済み') {
        elements.previewStatus.textContent = '';
      }
    }, 3000);
  } catch (err) {
    elements.previewStatus.textContent = '❌ エラー';
    console.error('Preview error:', err);
  }
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

  // 辞書フィールドをクリア
  document.getElementById('dictReading').value = '';
  document.getElementById('dictCategory').value = '';
  document.getElementById('dictRelated').value = '';

  // プレビューもクリア
  elements.previewContent.innerHTML = '';
  elements.previewStatus.textContent = '';
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

  // 辞書フィールドを入力
  if (state.currentSection === 'dictionary') {
    document.getElementById('dictReading').value = article.metadata.reading || '';
    document.getElementById('dictCategory').value = article.metadata.category || '';
    document.getElementById('dictRelated').value = (article.metadata.related || []).join(', ');
  }

  // フォーム入力後にプレビューと公開リンクを更新
  updatePublicPageLink();
  if (state.previewVisible) {
    updatePreview();
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

  // quicklook / description / dictionary metadata
  const desc = document.getElementById('articleDescription').value;
  if (state.currentSection === 'magazines') {
    metadata.description = desc;
    metadata.articles = document.getElementById('magazineArticles').value.split('\n').map(s => s.trim()).filter(s => s);
  } else if (state.currentSection === 'dictionary') {
    metadata.description = desc;
    metadata.reading = document.getElementById('dictReading').value;
    metadata.category = document.getElementById('dictCategory').value;
    const relatedValue = document.getElementById('dictRelated').value;
    metadata.related = relatedValue ? relatedValue.split(',').map(s => s.trim()).filter(s => s) : [];
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

    // 新規作成の場合、以降は編集モードに切り替え
    if (state.isNew) {
      state.isNew = false;
      state.editingId = id;
      elements.deleteBtn.style.display = 'inline-flex';
      updatePublicPageLink();
    }
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

// アップロードプログレスUIを作成
function createProgressItem(container, file) {
  const item = document.createElement('div');
  item.className = 'upload-progress-item';
  item.innerHTML = `
    <div class="upload-progress-header">
      <span class="upload-progress-filename">${escapeHtml(file.name)}</span>
      <span class="upload-progress-status uploading">⏳ 待機中...</span>
    </div>
    <div class="upload-progress-bar-bg">
      <div class="upload-progress-bar" style="width: 0%"></div>
    </div>
  `;
  container.appendChild(item);
  return {
    element: item,
    bar: item.querySelector('.upload-progress-bar'),
    status: item.querySelector('.upload-progress-status')
  };
}

// プログレスサマリーを作成/更新
function updateProgressSummary(container, completed, total, errors) {
  let summary = container.querySelector('.upload-progress-summary');
  if (!summary) {
    summary = document.createElement('div');
    summary.className = 'upload-progress-summary';
    container.insertBefore(summary, container.firstChild);
  }
  const successCount = completed - errors;
  summary.innerHTML = `
    <span><span class="summary-count">${completed}</span> / ${total} ファイル完了</span>
    <span>${errors > 0 ? `❌ ${errors}件エラー` : completed === total ? '✅ 完了' : '⏳ アップロード中...'}</span>
  `;
  return summary;
}

// 単一ファイルのアップロード（XMLHttpRequest でプログレス対応）
function uploadSingleFile(url, file, progressItem) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', file);

    // プログレスイベント
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        progressItem.bar.style.width = `${percent}%`;
        progressItem.status.textContent = `⬆️ ${percent}%`;
        progressItem.status.className = 'upload-progress-status uploading';
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        progressItem.bar.style.width = '100%';
        progressItem.bar.classList.add('completed');
        progressItem.status.textContent = '✅ 完了';
        progressItem.status.className = 'upload-progress-status completed';
        progressItem.element.classList.add('completed');
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve({});
        }
      } else {
        progressItem.bar.classList.add('error');
        progressItem.status.textContent = '❌ エラー';
        progressItem.status.className = 'upload-progress-status error';
        progressItem.element.classList.add('error');
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    });

    xhr.addEventListener('error', () => {
      progressItem.bar.classList.add('error');
      progressItem.status.textContent = '❌ 接続エラー';
      progressItem.status.className = 'upload-progress-status error';
      progressItem.element.classList.add('error');
      reject(new Error('Network error'));
    });

    xhr.open('POST', url);
    xhr.send(formData);
  });
}

// 画像アップロード処理（複数ファイル同時・プログレスバー付き）
async function handleFileUpload(files) {
  if (!files || files.length === 0) return;

  const container = elements.imageUploadProgress;
  container.innerHTML = '';
  elements.uploadArea.classList.add('uploading');

  const total = files.length;
  let completed = 0;
  let errors = 0;

  updateProgressSummary(container, 0, total, 0);

  const uploads = Array.from(files).map(async (file) => {
    const progressItem = createProgressItem(container, file);
    try {
      await uploadSingleFile('/admin/api/images', file, progressItem);
      completed++;
    } catch (err) {
      completed++;
      errors++;
    }
    updateProgressSummary(container, completed, total, errors);
  });

  await Promise.all(uploads);

  elements.uploadArea.classList.remove('uploading');
  elements.fileInput.value = '';

  // 成功メッセージ
  const successCount = total - errors;
  if (successCount > 0) {
    showToast(`${successCount}件の画像をアップロードしました`, 'success');
  }
  if (errors > 0) {
    showToast(`${errors}件のアップロードに失敗しました`, 'error');
  }

  await loadImages();

  // 2秒後にプログレス表示をクリア
  setTimeout(() => {
    container.innerHTML = '';
  }, 2000);
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
    case 'file':
      showFileModal();
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

// ファイルモーダル表示
async function showFileModal() {
  // ファイル一覧を読み込み
  if (state.files.length === 0) {
    await loadFiles();
  }

  elements.fileModal.style.display = 'flex';
  renderFileModalList();
}

// ファイルモーダル非表示
function hideFileModal() {
  elements.fileModal.style.display = 'none';
}

// ファイルモーダルのリスト表示
function renderFileModalList() {
  elements.modalFileList.innerHTML = state.files.map(file => {
    const ext = file.filename.split('.').pop().toLowerCase();
    const icon = getFileIcon(ext);
    const displayName = file.name || file.originalFilename;
    const sizeStr = formatFileSize(file.size);

    return `
      <div class="modal-file-item" data-url="${file.url}" data-filename="${file.originalFilename}">
        <div class="modal-file-icon">${icon}</div>
        <div class="modal-file-info">
          <div class="modal-file-name">${escapeHtml(displayName)}</div>
          <div class="modal-file-meta">${sizeStr}</div>
        </div>
      </div>
    `;
  }).join('');

  // クリックイベント
  elements.modalFileList.querySelectorAll('.modal-file-item').forEach(item => {
    item.addEventListener('click', () => {
      const url = item.dataset.url;
      const filename = item.dataset.filename;
      insertFileToEditor(url, filename);
      hideFileModal();
    });
  });
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

// エディタにファイル挿入
function insertFileToEditor(url, filename) {
  const textarea = document.getElementById('articleBody');
  const start = textarea.selectionStart;
  const text = textarea.value;
  const fileMarkdown = `[${filename}](${url})`;

  textarea.value = text.substring(0, start) + fileMarkdown + text.substring(start);
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + fileMarkdown.length;
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

// ファイル一覧読み込み
async function loadFiles() {
  try {
    const res = await fetch('/admin/api/files');
    state.files = await res.json();
    renderFileList();
  } catch (err) {
    showToast('ファイルの読み込みに失敗しました', 'error');
  }
}

// ファイル一覧表示
function renderFileList() {
  elements.fileList.innerHTML = state.files.map(file => {
    const sizeStr = formatFileSize(file.size);
    const ext = file.filename.split('.').pop().toLowerCase();
    const icon = getFileIcon(ext);
    const displayName = file.name || file.originalFilename;
    const tags = file.tags.length > 0 ? `<div class="file-tags">${file.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : '';

    return `
      <div class="file-item">
        <div class="file-icon">${icon}</div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(displayName)}</div>
          ${tags}
          ${file.description ? `<div class="file-description">${escapeHtml(file.description)}</div>` : ''}
          <div class="file-meta">${sizeStr} • ${file.filename}</div>
        </div>
        <div class="file-actions">
          <button onclick="copyFileUrl('${file.url}')" class="btn btn-sm btn-ghost" title="URLをコピー">📋</button>
          <button onclick="downloadFile('${file.url}', '${file.originalFilename}')" class="btn btn-sm btn-ghost" title="ダウンロード">⬇️</button>
          <button onclick="editFileMetadata('${file.filename}')" class="btn btn-sm btn-ghost" title="編集">✏️</button>
          <button onclick="deleteFile('${file.filename}')" class="btn btn-sm btn-danger" title="削除">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

// ファイルアイコンを取得
function getFileIcon(ext) {
  const icons = {
    pdf: '📄',
    doc: '📝', docx: '📝',
    xls: '📊', xlsx: '📊',
    ppt: '📊', pptx: '📊',
    zip: '📦', rar: '📦', '7z': '📦',
    txt: '📃',
    csv: '📋',
    json: '📋',
    xml: '📋',
    md: '📝',
    mp3: '🎵', wav: '🎵',
    mp4: '🎬', avi: '🎬',
    default: '📎'
  };
  return icons[ext] || icons.default;
}

// ファイルサイズをフォーマット
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ファイルアップロード処理（複数ファイル同時・プログレスバー付き）
async function handleFileFileUpload(files) {
  if (!files || files.length === 0) return;

  const container = elements.fileUploadProgress;
  container.innerHTML = '';
  elements.fileUploadArea.classList.add('uploading');

  const total = files.length;
  let completed = 0;
  let errors = 0;

  updateProgressSummary(container, 0, total, 0);

  const uploads = Array.from(files).map(async (file) => {
    const progressItem = createProgressItem(container, file);
    try {
      await uploadSingleFile('/admin/api/files', file, progressItem);
      completed++;
    } catch (err) {
      completed++;
      errors++;
    }
    updateProgressSummary(container, completed, total, errors);
  });

  await Promise.all(uploads);

  elements.fileUploadArea.classList.remove('uploading');
  elements.fileFileInput.value = '';

  // 成功メッセージ
  const successCount = total - errors;
  if (successCount > 0) {
    showToast(`${successCount}件のファイルをアップロードしました`, 'success');
  }
  if (errors > 0) {
    showToast(`${errors}件のアップロードに失敗しました`, 'error');
  }

  await loadFiles();

  // 2秒後にプログレス表示をクリア
  setTimeout(() => {
    container.innerHTML = '';
  }, 2000);
}

// ファイルURLをコピー
function copyFileUrl(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('URLをコピーしました', 'success');
  }).catch(() => {
    showToast('コピーに失敗しました', 'error');
  });
}

// ファイルダウンロード
function downloadFile(url, filename) {
  // ブラウザの通常のダウンロードを利用
  // サーバー側でContent-Dispositionヘッダーを設定しているので、
  // 単純にリンクを開くだけで元のファイル名でダウンロードされる
  window.open(url, '_blank');
}

// ファイル削除
async function deleteFile(filename) {
  if (!confirm('このファイルを削除しますか？')) return;

  try {
    const res = await fetch(`/admin/api/files/${encodeURIComponent(filename)}`, {
      method: 'DELETE'
    });

    if (!res.ok) throw new Error('Delete failed');

    showToast('ファイルを削除しました', 'success');
    await loadFiles();
  } catch (err) {
    showToast('削除に失敗しました', 'error');
  }
}

// ファイルメタデータ編集
function editFileMetadata(filename) {
  const file = state.files.find(f => f.filename === filename);
  if (!file) return;

  state.editingFileFilename = filename;
  elements.fileMetadataFilename.textContent = file.originalFilename;
  elements.fileMetadataUrl.textContent = file.url;
  elements.fileMetadataName.value = file.name || '';
  elements.fileMetadataDescription.value = file.description || '';
  elements.fileMetadataTags.value = file.tags.join(', ');

  elements.fileMetadataModal.style.display = 'flex';
}

// ファイルメタデータを保存
async function saveFileMetadata() {
  if (!state.editingFileFilename) return;

  const metadata = {
    name: elements.fileMetadataName.value.trim(),
    description: elements.fileMetadataDescription.value.trim(),
    tags: elements.fileMetadataTags.value.split(',').map(t => t.trim()).filter(t => t)
  };

  try {
    const res = await fetch(`/admin/api/files/${encodeURIComponent(state.editingFileFilename)}/metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    });

    if (!res.ok) throw new Error('Save failed');

    showToast('メタデータを保存しました', 'success');
    hideFileMetadataModal();
    await loadFiles();
  } catch (err) {
    showToast('保存に失敗しました', 'error');
  }
}

// ファイルメタデータモーダルを非表示
function hideFileMetadataModal() {
  elements.fileMetadataModal.style.display = 'none';
  state.editingFileFilename = null;
}

// グローバル関数として公開
window.copyImageUrl = copyImageUrl;
window.deleteImage = deleteImage;
window.editImageMetadata = editImageMetadata;
window.copyFileUrl = copyFileUrl;
window.downloadFile = downloadFile;
window.deleteFile = deleteFile;
window.editFileMetadata = editFileMetadata;
