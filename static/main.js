// static/main.js

document.addEventListener('DOMContentLoaded', () => {
  // テーマ初期化（ページ読み込み時にlocalStorageから復元）
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (savedTheme === 'light') {
    document.documentElement.removeAttribute('data-theme');
  }

  // テーマ切替
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        // ライトモードに切り替え
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
      } else {
        // ダークモードに切り替え
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      }
    });
  }

  // 記事カード全体をクリック可能にする
  const postItems = document.querySelectorAll('.post-list-item');
  postItems.forEach(item => {
    item.addEventListener('click', (e) => {
      // タグリンクがクリックされた場合は除外
      if (e.target.closest('.tag')) return;

      const link = item.querySelector('h3 a');
      if (link) {
        window.location.href = link.href;
      }
    });
  });

  // すべてのコピーボタンを取得
  const copyButtons = document.querySelectorAll('.copy-button');

  copyButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const codeBlock = button.closest('.code-block');
      const codeElement = codeBlock.querySelector('code');
      const code = codeElement.textContent;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(code);
        } else {
          copyToClipboardFallback(code);
        }

        const originalText = button.textContent;
        button.textContent = 'コピーしました！';
        button.classList.add('copied');

        setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove('copied');
        }, 2000);

      } catch (err) {
        console.error('コピーに失敗しました:', err);
        button.textContent = 'エラー';
        setTimeout(() => {
          button.classList.remove('copied');
          button.textContent = 'コピー';
        }, 2000);
      }
    });
  });

  // サイドバー目次の初期化
  initSidebarToc();
});

// フォールバック関数（HTTP環境用）
function copyToClipboardFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '2em';
  textarea.style.height = '2em';
  textarea.style.padding = '0';
  textarea.style.border = 'none';
  textarea.style.outline = 'none';
  textarea.style.boxShadow = 'none';
  textarea.style.background = 'transparent';

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const successful = document.execCommand('copy');
    if (!successful) {
      throw new Error('Copy command failed');
    }
  } catch (err) {
    console.error('Fallback copy failed:', err);
    throw err;
  } finally {
    document.body.removeChild(textarea);
  }
}

// サイドバー目次の初期化
function initSidebarToc() {
  const sidebarToc = document.getElementById('sidebarToc');
  if (!sidebarToc) return;

  // ページ内の見出し要素を取得
  const headingElements = document.querySelectorAll('.content h2[id], .content h3[id], .content h4[id]');
  if (headingElements.length === 0) return;

  // サイドバー目次の中身を見出しから直接構築
  const inner = document.createElement('div');
  inner.className = 'sidebar-toc-inner';

  const title = document.createElement('div');
  title.className = 'toc-title';
  title.textContent = '目次';
  inner.appendChild(title);

  const ul = document.createElement('ul');
  headingElements.forEach((heading) => {
    const li = document.createElement('li');
    const level = parseInt(heading.tagName.substring(1), 10);
    const indent = level - 2;
    if (indent > 0) {
      li.className = `toc-indent-${indent}`;
    }
    const a = document.createElement('a');
    a.href = `#${heading.id}`;
    a.textContent = heading.textContent;
    li.appendChild(a);
    ul.appendChild(li);
  });
  inner.appendChild(ul);
  sidebarToc.appendChild(inner);

  // インライン目次を非表示にする
  const inlineToc = document.querySelector('.content .toc');
  if (inlineToc) {
    inlineToc.style.display = 'none';
  }

  // 画面幅に応じてサイドバー目次の表示/非表示を切り替える
  const mediaQuery = window.matchMedia('(min-width: 1100px)');

  function toggleSidebarToc(matches) {
    if (matches) {
      sidebarToc.classList.add('active');
      document.body.classList.add('has-sidebar-toc');
    } else {
      sidebarToc.classList.remove('active');
      document.body.classList.remove('has-sidebar-toc');
      // 狭い画面ではインライン目次を表示
      if (inlineToc) {
        inlineToc.style.display = '';
      }
    }
  }

  toggleSidebarToc(mediaQuery.matches);
  mediaQuery.addEventListener('change', (e) => toggleSidebarToc(e.matches));

  // スクロール追従ハイライト（IntersectionObserver）
  const sidebarLinks = inner.querySelectorAll('a[href^="#"]');

  if (sidebarLinks.length === 0) return;

  let currentActiveId = null;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        currentActiveId = entry.target.id;
      }
    });

    sidebarLinks.forEach((link) => {
      const href = link.getAttribute('href');
      if (href === `#${currentActiveId}`) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }, {
    rootMargin: '-10% 0px -80% 0px',
    threshold: 0
  });

  headingElements.forEach((heading) => observer.observe(heading));
}
