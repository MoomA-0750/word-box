const crypto = require('crypto');
const config = require('./config');

// config から認証設定を取得
const ADMIN_PASSWORD = config.admin.password;

// セッション管理（インメモリ）
const sessions = new Map();
const SESSION_EXPIRE_MS = config.admin.sessionExpireHours * 60 * 60 * 1000;

// セッションIDを生成
function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}

// セッションを作成
function createSession() {
  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_EXPIRE_MS
  });
  return sessionId;
}

// セッションを検証
function validateSession(sessionId) {
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return false;
  }
  return true;
}

// セッションを削除
function destroySession(sessionId) {
  sessions.delete(sessionId);
}

// パスワードを検証
function verifyPassword(password) {
  return password === ADMIN_PASSWORD;
}

// CookieからセッションIDを取得
function getSessionIdFromCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
    const [key, value] = cookie.trim().split('=');
    acc[key] = value;
    return acc;
  }, {});
  return cookies['wordbox_session'] || null;
}

// Set-Cookie ヘッダーを生成
function createSessionCookie(sessionId) {
  return `wordbox_session=${sessionId}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_EXPIRE_MS / 1000}`;
}

// セッション削除用Cookie
function createLogoutCookie() {
  return 'wordbox_session=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0';
}

// 期限切れセッションの定期クリーンアップ
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000); // 1時間ごと

module.exports = {
  createSession,
  validateSession,
  destroySession,
  verifyPassword,
  getSessionIdFromCookie,
  createSessionCookie,
  createLogoutCookie
};
