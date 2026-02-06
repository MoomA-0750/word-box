// static/main.js

document.addEventListener('DOMContentLoaded', () => {
  // テーマ切替
  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
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
