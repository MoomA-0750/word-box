## プロジェクト概要

**プロジェクト名**: WordBox
**種別**: シンプルなMarkdownブログシステム
**目的**: オフライン環境（ネットワークから隔離されたRHEL 10サーバー）で動作する、Node.js製のブログ

## 環境の制約条件

### ネットワーク制約
- **完全オフライン環境**: サーバーはインターネットに接続できない
- **npmパッケージインストール不可**: 外部からのパッケージ取得ができない
- **利用可能なリソース**:
  - RHEL 10のISOレポジトリ (ローカル)
  - VS Code (Windows側にインストール済み)
  - VS Codeの`node_modules`からライブラリを抽出して利用

### 使用技術
- **Node.js**: v20.19.2
- **外部依存**: なし (npmパッケージは全てVS Codeから抽出)
- **改行コード**: LF (CRLFだとFront Matterパーサーが動作しない)

## 使用しているVS Code由来のライブラリ

以下のモジュールをVS Codeの`C:\Program Files\Microsoft VS Code\resources\app\node_modules`から抽出:

```
- fs-extra (ファイル操作の拡張)
- graceful-fs (fs-extraの依存)
- jsonfile (fs-extraの依存)
- universalify (fs-extraの依存)
- micromatch (ファイルパターンマッチング)
- picomatch (micromatchの依存)
- braces (micromatchの依存)
- fill-range (bracesの依存)
- to-regex-range (fill-rangeの依存)
- is-number (fill-rangeの依存)
- is-extglob (micromatchの依存)
- is-glob (micromatchの依存)
- katex (数式レンダリング、未使用だが将来用)
- uuid (UUID生成、管理画面で使用)
- semver (バージョン管理、未使用だが将来用)
- js-base64 (Base64エンコード、未使用だが将来用)
```

## プロジェクト構造

```
wordbox/
├── node_modules/          # VS Codeから抽出したモジュール
├── lib/
│   ├── frontmatter.js    # Front Matter (YAML風メタデータ) パーサー
│   ├── markdown.js       # Markdownパーサー
│   ├── search.js         # 全文検索エンジン
│   ├── admin-router.js   # 管理画面ルーター (HTML/CSS/JS含む)
│   └── admin-auth.js     # 管理画面認証モジュール
├── content/
│   ├── posts/            # Markdown記事ファイル
│   ├── topics/           # トピック記事ファイル
│   └── magazines/        # マガジン定義ファイル
├── templates/            # HTMLテンプレート
│   ├── layout.html       # 全体レイアウト
│   ├── post.html         # 記事ページ
│   ├── index.html        # トップページ
│   └── search.html       # 検索結果ページ
├── static/               # 静的ファイル
│   ├── style.css         # スタイルシート
│   ├── code-copy.js      # コードコピー・カードクリック機能
│   ├── admin.js          # 管理画面JavaScript
│   └── images/           # 画像ディレクトリ
│       └── metadata.json # 画像メタデータ (名前、タグ、alt等)
├── server.js             # HTTPサーバー (動的生成型)
└── INFO.md               # このファイル
```

## Front Matter仕様

記事ファイルの先頭に以下の形式でメタデータを記述:

```markdown
---
title: 記事タイトル
date: 2025-01-22
emoji: 🚀
tags: ["tag1", "tag2"]
listed: true
quicklook: 記事カード用の短い説明
---
記事本文...
```

### フィールド一覧

| フィールド | 型 | デフォルト | 説明 |
|-----------|------|-----------|------|
| title | string | "Untitled" | 記事タイトル |
| date | string | "" | 日付 (YYYY-MM-DD形式推奨) |
| emoji | string | "📄" | 記事アイコン |
| tags | string[] | [] | タグ配列 (JSON形式) |
| listed | boolean | true | 一覧に表示するか |
| quicklook | string | "" | 記事カードのサブタイトル |
| description | string | "" | マガジンの説明文 |
| articles | string[] | [] | マガジン収録記事のslug配列 |

## Markdown記法

### 基本記法

| 記法 | 説明 |
|------|------|
| `# 見出し` | H1〜H5 (#の数で指定) |
| `**太字**` | 強調 (太字) |
| `*斜体*` | 強調 (斜体) |
| `~~打ち消し~~` | 打ち消し線 |
| `++下線++` | 下線 |
| `` `code` `` | インラインコード |
| `[text](url)` | リンク |
| `![alt](url)` | 画像 |
| `---` | 水平線 |

### リスト

```markdown
- 項目1
  - ネスト項目
- 項目2

1. 番号付き
2. リスト

- [ ] 未完了タスク
- [x] 完了タスク
```

### テーブル

```markdown
| 左寄せ | 中央 | 右寄せ |
|:-------|:----:|-------:|
| データ | データ | データ |
```

### コードブロック

````markdown
```言語名
コード
```
````

### カスタムブロック

**外部リンク (ブックマークカード)**:
```markdown
:::bookmark
https://example.com
title: カスタムタイトル
icon: 📚
:::
```

**内部記事リンク (記事カード)**:
```markdown
:::article
記事のslug名
:::
```

**マガジンリンク (マガジンカード)**:
```markdown
:::magazine
マガジンのslug名
:::
```

**目次**:
```markdown
:::contents
:::
```

**コールアウト (GitHubスタイル)**:
> 内部でMarkdown記法（太字、リンク、リストなど）が使用可能です。

```markdown
> [!NOTE]
> ノート内容
> - リストも
> - 書けます

> [!TIP]
> ヒント内容

> [!IMPORTANT]
> 重要な内容

> [!WARNING]
> 警告内容

> [!CAUTION]
> 注意内容
```

## ルーティング

### フロントエンド

| パス | 説明 |
|------|------|
| `/` | トップページ (記事一覧) |
| `/posts/:slug` | 記事ページ |
| `/topics` | トピック一覧ページ |
| `/topics/:slug` | トピック記事ページ |
| `/magazines` | マガジン一覧ページ |
| `/magazines/:slug` | マガジン詳細ページ |
| `/tags/:tag` | タグフィルタページ |
| `/search` | 検索結果ページ |
| `/static/*` | 静的ファイル配信 |

### 管理画面

| パス | 説明 |
|------|------|
| `/admin` | 管理画面トップ |
| `/admin/login` | ログインページ |
| `/admin/logout` | ログアウト |

### 管理画面API

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/admin/api/posts` | 記事一覧取得 |
| POST | `/admin/api/posts` | 記事作成 |
| GET | `/admin/api/posts/:id` | 記事詳細取得 |
| PUT | `/admin/api/posts/:id` | 記事更新 |
| DELETE | `/admin/api/posts/:id` | 記事削除 |
| GET | `/admin/api/topics` | トピック一覧取得 |
| POST | `/admin/api/topics` | トピック作成 |
| GET | `/admin/api/topics/:id` | トピック詳細取得 |
| PUT | `/admin/api/topics/:id` | トピック更新 |
| DELETE | `/admin/api/topics/:id` | トピック削除 |
| GET | `/admin/api/magazines` | マガジン一覧取得 |
| POST | `/admin/api/magazines` | マガジン作成 |
| GET | `/admin/api/magazines/:id` | マガジン詳細取得 |
| PUT | `/admin/api/magazines/:id` | マガジン更新 |
| DELETE | `/admin/api/magazines/:id` | マガジン削除 |
| GET | `/admin/api/images` | 画像一覧取得 |
| POST | `/admin/api/images` | 画像アップロード |
| DELETE | `/admin/api/images/:filename` | 画像削除 |
| PUT | `/admin/api/images/:filename/metadata` | 画像メタデータ更新 |
| GET | `/admin/api/tags` | タグ一覧取得 |
| POST | `/admin/api/rebuild-index` | 検索インデックス再構築 |

## 技術的な特徴

### 動的生成型
- ビルドプロセスなし
- リクエストごとにMarkdownをHTMLに変換
- 記事追加時はファイルを置くだけ (再起動不要)

### 全文検索機能
- **インメモリインデックス**: サーバー起動時に全コンテンツをインデックス化
- **重み付け検索**: タイトル > タグ > 本文 の優先度でスコアリング
- **スニペット生成**: 検索語周辺のテキストを抜粋しハイライト表示
- **Markdown除外**: Markdown構文を除去してプレーンテキストのみを検索対象化

### 自作コンポーネント
- **Markdownパーサー**: 完全自作 (`lib/markdown.js`)
- **Front Matterパーサー**: YAML風の簡易パーサー (`lib/frontmatter.js`)
- **テンプレートエンジン**: シンプルな`{{variable}}`置換

### セキュリティ
- HTMLエスケープ処理
- XSS対策

## 運用方法

### サーバー起動
```bash
cd ~/Documents/wordbox
node server.js
```

### 記事追加
1. `content/posts/`または`content/topics/`ディレクトリに`.md`ファイルを作成 (LF改行)
2. Front Matterを記述
3. Markdownで本文を書く
4. 画像は`static/images/`に配置

### アクセス
- `http://localhost:3000` または設定されたIPアドレス

## 既知の制約

1. **改行コード**: 記事ファイルは**必ずLF**で保存 (CRLFだとFront Matterが認識されない)
2. **静的ファイルのキャッシュ**: なし (毎回ファイル読み込み)
3. **エラーハンドリング**: 最小限

## 管理画面

### 概要
ブラウザベースの管理画面で、記事・トピック・マガジン・画像を管理できます。

### アクセス方法
1. `http://localhost:3000/admin` にアクセス
2. パスワードを入力してログイン

### 認証
- **デフォルトパスワード**: `admin`
- **カスタムパスワード**: 環境変数 `WORDBOX_ADMIN_PASSWORD` で設定可能
- **セッション有効期限**: 24時間

```bash
# カスタムパスワードでサーバー起動
WORDBOX_ADMIN_PASSWORD=mysecretpassword node server.js
```

### 機能一覧

| 機能 | 説明 |
|------|------|
| 記事管理 | 記事の一覧表示、作成、編集、削除 |
| トピック管理 | トピックの一覧表示、作成、編集、削除 |
| マガジン管理 | マガジンの管理、収録記事の順序設定 |
| 画像管理 | ドラッグ＆ドロップでアップロード、一覧表示、削除、メタデータ編集 |
| 画像メタデータ | 各画像に名前、タグ、説明、alt属性を設定可能 |
| タグ一覧 | 使用中のタグと記事数を表示 |
| 検索インデックス再構築 | 手動で再構築可能 |

### ファイル名について
- **新規記事作成時**: UUID形式のIDが自動生成される（カスタムIDも設定可能）
- **画像アップロード時**: ファイル名は自動的にUUID形式に変換される

### エディタ機能
- Markdownツールバー (太字、斜体、コード、リンク、画像、見出し)
- 画像挿入モーダル (アップロード済み画像から選択)
- リアルタイム検索フィルタ

### 画像メタデータ管理
各画像に以下のメタデータを設定できます：

| 項目 | 説明 |
|------|------|
| 名前 | 画像の管理用名前（画像一覧に表示） |
| Alt属性 | 記事に挿入する際の`![この部分](url)`に使用される代替テキスト |
| 説明 | 画像の詳細説明 |
| タグ | カンマ区切りでタグを設定（例: "風景, 夕日, 海"） |

**メタデータの保存先**: `static/images/metadata.json`（単一JSONファイル）

**画像挿入時の動作**:
- 画像選択時、設定されたalt属性が自動的に使用される
- alt未設定の場合は「名前」を使用
- 名前も未設定の場合は「画像」と表示

## 今後の拡張案 (未実装)

- ページネーション
- RSSフィード
- サイトマップ
