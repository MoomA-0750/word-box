## プロジェクト概要

**プロジェクト名**: WordBox
**種別**: Markdownブログシステム
**目的**: オフライン環境（ネットワークから隔離されたRHEL 10サーバー）で動作する、Node.js製のブログ

## 環境の制約条件

### ネットワーク制約
- **完全オフライン環境**: サーバーはインターネットに接続できない
- **npmパッケージインストール不可**: 外部からのパッケージ取得ができない
- **利用可能なリソース**:
  - RHEL 10のISOレポジトリ (ローカル)
  - VS Code (Windows側にインストール済み)
  - VS Codeの`node_modules`やnpm CLIの`node_modules`からライブラリを抽出して利用

### 使用技術
- **Node.js**: v20.19.2
- **外部依存**: なし (npmパッケージは全てVS Codeまたはnpm CLIから抽出)
- **改行コード**: LF (CRLFだとFront Matterパーサーが動作しない)

## 使用しているライブラリ

以下のモジュールをVS Codeの`node_modules`やnpm CLIの`node_modules`から抽出:

### コア依存

| パッケージ | 用途 |
|-----------|------|
| fs-extra | ファイル操作の拡張 (ensureDir, pathExists 等) |
| graceful-fs | EMFILE エラー防止付きの fs 置換 |
| micromatch | ファイルパターンマッチング (glob) |
| uuid | UUID生成 (管理画面で使用) |
| ini | 設定ファイル (`wordbox.ini`) パーサー |
| tar | コンテンツのバックアップ/エクスポート (tar.gz) |
| debug | 名前空間ベースの構造化ロギング |
| ms | 時間のフォーマット (ミリ秒 → "5m", "1.2s" 等) |
| chalk | ログ出力のカラーリング (ESM、動的import) |
| lru-cache | ページ/一覧のLRUキャッシュ |
| fastest-levenshtein | 高速レーベンシュタイン距離計算 (ファジー検索) |
| string-width | 文字列の表示幅計算 (日本語CJK対応) |
| tiny-relative-date | 相対日付表示 ("yesterday", "a week ago" 等) |
| diff | テキスト差分比較 (記事の差分表示) |
| signal-exit | プロセス終了時のクリーンアップ処理 |

### 依存パッケージの依存

```
- graceful-fs, jsonfile, universalify  ← fs-extra の依存
- picomatch, braces, fill-range, to-regex-range, is-number, is-extglob, is-glob  ← micromatch の依存
- eastasianwidth, emoji-regex, is-fullwidth-code-point  ← string-width の依存
- strip-ansi, ansi-regex  ← string-width の依存
- ansi-styles, supports-color, color-convert, color-name  ← chalk の依存
- minipass, yallist, minizlib, mkdirp  ← tar の依存
```

### 未使用 (将来用)

```
- katex (数式レンダリング)
- semver (バージョン管理)
- js-base64 (Base64エンコード)
```

## プロジェクト構造

```
wordbox/
├── node_modules/          # VS Code / npm CLI から抽出したモジュール
├── lib/
│   ├── frontmatter.js    # Front Matter (YAML風メタデータ) パーサー
│   ├── markdown.js       # Markdownパーサー
│   ├── syntax-highlight.js # シンタックスハイライター
│   ├── search.js         # ファジー検索エンジン (fastest-levenshtein + string-width)
│   ├── admin-router.js   # 管理画面ルーター (HTML/CSS/JS含む)
│   ├── admin-auth.js     # 管理画面認証モジュール
│   ├── snippets.js       # 定型文 (スニペット/変数) 管理
│   ├── logger.js         # 構造化ロギング (debug + ms + chalk)
│   ├── config.js         # ini ベース設定ファイルサポート
│   ├── files.js          # micromatch + graceful-fs ファイル操作ユーティリティ
│   └── backup.js         # tar ベースのバックアップ/エクスポート
├── content/              # ユーザーコンテンツ (.gitignore対象)
│   ├── posts/            # Markdown記事ファイル
│   ├── topics/           # トピック記事ファイル
│   ├── magazines/        # マガジン定義ファイル
│   ├── dictionary/       # 辞書エントリファイル
│   └── snippets.json     # 定型文定義
├── backups/              # バックアップファイル (tar.gz)
├── templates/
│   ├── admin/            # 管理画面HTMLテンプレート
│   ├── layout.html       # 全体レイアウト
│   ├── post.html         # 記事ページ
│   ├── index.html        # トップページ
│   ├── search.html       # 検索結果ページ
│   ├── dictionary.html   # 辞書一覧ページ
│   └── dictionary-entry.html # 辞書エントリページ
├── static/
│   ├── style.css         # スタイルシート
│   ├── main.js           # クライアントサイドJavaScript (カードクリック等)
│   ├── admin.js          # 管理画面JavaScript
│   ├── highlighter.js    # シンタックスハイライタークライアントJS
│   ├── highlighter/      # ハイライター言語定義ファイル
│   ├── images/           # 画像ディレクトリ (.gitignore対象)
│   │   └── metadata.json
│   └── files/            # ファイルディレクトリ (.gitignore対象)
│       └── metadata.json
├── server.js             # HTTPサーバー (動的生成型)
└── wordbox.ini           # 設定ファイル (任意、なければデフォルト値)
```

## 設定ファイル (wordbox.ini)

`wordbox.ini` をプロジェクトルートに配置すると、サーバーの動作を設定できます。
ファイルが存在しない場合はデフォルト値が使用されます。

```ini
[server]
port = 3000
host = 0.0.0.0

[content]
postsDir = ./content/posts
topicsDir = ./content/topics
dictionaryDir = ./content/dictionary
magazinesDir = ./content/magazines
snippetsFile = ./content/snippets.json

[admin]
password = admin
sessionExpireHours = 24

[search]
snippetLength = 120
snippetContext = 40
fuzzyThreshold = 2
fuzzyMinLength = 3
```

### 設定の優先順位

1. **環境変数** (最優先): `WORDBOX_PORT`, `WORDBOX_HOST`, `WORDBOX_ADMIN_PASSWORD`
2. **wordbox.ini**: ファイルが存在すればその値を使用
3. **デフォルト値**: 上記の設定例と同じ

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
| keywords | string[] | [] | 辞書エントリの関連キーワード |
| related | string[] | [] | 辞書エントリの関連エントリslug配列 |

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

シンタックスハイライトは`lib/syntax-highlight.js`と`static/highlighter/`で処理される。

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
| `/dictionary` | 辞書一覧ページ |
| `/dictionary/:slug` | 辞書エントリページ |
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
| GET | `/admin/api/dictionary` | 辞書一覧取得 |
| POST | `/admin/api/dictionary` | 辞書エントリ作成 |
| GET | `/admin/api/dictionary/:id` | 辞書エントリ詳細取得 |
| PUT | `/admin/api/dictionary/:id` | 辞書エントリ更新 |
| DELETE | `/admin/api/dictionary/:id` | 辞書エントリ削除 |
| GET | `/admin/api/images` | 画像一覧取得 |
| POST | `/admin/api/images` | 画像アップロード |
| DELETE | `/admin/api/images/:filename` | 画像削除 |
| PUT | `/admin/api/images/:filename/metadata` | 画像メタデータ更新 |
| GET | `/admin/api/files` | ファイル一覧取得 |
| POST | `/admin/api/files` | ファイルアップロード |
| DELETE | `/admin/api/files/:filename` | ファイル削除 |
| PUT | `/admin/api/files/:filename/metadata` | ファイルメタデータ更新 |
| GET | `/admin/api/tags` | タグ一覧取得 |
| POST | `/admin/api/rebuild-index` | 検索インデックス再構築 |
| POST | `/admin/api/preview` | Markdownプレビュー生成 |
| POST | `/admin/api/backup` | バックアップ作成 (tar.gz) |
| GET | `/admin/api/backups` | バックアップ一覧取得 |
| GET | `/admin/api/backups/:filename` | バックアップファイルダウンロード |
| POST | `/admin/api/diff` | テキスト差分比較 (body: { oldText, newText }) |
| POST | `/admin/api/diff/:type/:id` | 記事と編集中テキストの差分比較 |

## 技術的な特徴

### 動的生成型
- ビルドプロセスなし
- リクエストごとにMarkdownをHTMLに変換
- 記事追加時はファイルを置くだけ (再起動不要)

### LRUキャッシュ
- **ページキャッシュ**: レンダリング済みHTMLをキャッシュ (最大50件、TTL 5分)
- **一覧キャッシュ**: 記事一覧の取得結果をキャッシュ (最大20件、TTL 3分)
- 検索インデックス再構築時に自動無効化

### 全文検索機能
- **インメモリインデックス**: サーバー起動時に全コンテンツをインデックス化 (posts/topics/magazines/dictionary)
- **重み付け検索**: タイトル(10点) > タグ(5点) > キーワード(5点) > 本文(1点/出現) の優先度でスコアリング
- **ファジー検索**: `fastest-levenshtein` によるタイポ許容検索 (レーベンシュタイン距離2以内)
- **スニペット生成**: `string-width` で日本語の表示幅を考慮した切り詰め + 検索語ハイライト
- **Markdown除外**: Markdown構文を除去してプレーンテキストのみを検索対象化

### 構造化ロギング
- `debug` + `ms` + `chalk` ベースの名前空間付きカラーログ
- 処理時間の自動計測 (100ms以下: 緑、100ms-1s: 黄、1s以上: 赤)
- `DEBUG=wordbox:*` で全ログ表示、`DEBUG=wordbox:server` でサーバーログのみ等の制御が可能

### バックアップ機能
- `tar` による content/ ディレクトリ全体の tar.gz 圧縮バックアップ
- 管理画面APIからバックアップの作成・一覧取得・ダウンロードが可能
- タイムスタンプ付きファイル名 (例: `wordbox-backup-2025-01-22T15-30-00.tar.gz`)

### 差分比較機能
- `diff` パッケージによる行ベースのテキスト差分比較
- 管理画面から記事の編集前後の差分をHTML形式で表示可能

### 相対日付表示
- `tiny-relative-date` による記事カードの日付表示 ("yesterday", "a week ago" 等)
- 元の日付はツールチップで確認可能

### クリーンシャットダウン
- `signal-exit` によるプロセス終了ハンドラ
- 終了時にキャッシュ統計やアクティブ接続数をログ出力

### 自作コンポーネント
- **Markdownパーサー**: 完全自作 (`lib/markdown.js`)
- **シンタックスハイライター**: 完全自作 (`lib/syntax-highlight.js` + `static/highlighter/`)
- **Front Matterパーサー**: YAML風の簡易パーサー (`lib/frontmatter.js`)
- **テンプレートエンジン**: シンプルな`{{variable}}`置換

### セキュリティ
- HTMLエスケープ処理
- XSS対策

## 運用方法

### サーバー起動
```bash
node server.js
```

### 環境変数による設定

```bash
# ポート変更
WORDBOX_PORT=8080 node server.js

# カスタムパスワードでサーバー起動
WORDBOX_ADMIN_PASSWORD=mysecretpassword node server.js

# ホストアドレス指定
WORDBOX_HOST=192.168.1.100 node server.js

# デバッグログの有効化
DEBUG=wordbox:* node server.js          # 全ログ
DEBUG=wordbox:server node server.js     # サーバーログのみ
DEBUG=wordbox:search node server.js     # 検索ログのみ
DEBUG=wordbox:admin node server.js      # 管理画面ログのみ

# 組み合わせ
WORDBOX_PORT=8080 WORDBOX_ADMIN_PASSWORD=secret DEBUG=wordbox:* node server.js
```

### 設定ファイルによる設定

`wordbox.ini` をプロジェクトルートに作成して各種設定を記述できます。
詳細は「設定ファイル (wordbox.ini)」セクションを参照。

### 記事追加
1. `content/posts/`または`content/topics/`ディレクトリに`.md`ファイルを作成 (LF改行)
2. Front Matterを記述
3. Markdownで本文を書く
4. 画像は`static/images/`に配置、ファイルは`static/files/`に配置

### アクセス
- `http://localhost:3000` または設定されたIPアドレス

## 既知の制約

1. **改行コード**: 記事ファイルは**必ずLF**で保存 (CRLFだとFront Matterが認識されない)
2. **ESMパッケージ**: chalk@5 はESM-onlyのため `await import('chalk')` で動的に読み込んでいる。読み込み完了前のログはプレーンテキストで出力される
3. **エラーハンドリング**: 最小限

## 管理画面

### 概要
ブラウザベースの管理画面で、記事・トピック・マガジン・辞書・画像・ファイルを管理できます。

### アクセス方法
1. `http://localhost:3000/admin` にアクセス
2. パスワードを入力してログイン

### 認証
- **デフォルトパスワード**: `admin`
- **カスタムパスワード**: 環境変数 `WORDBOX_ADMIN_PASSWORD` または `wordbox.ini` の `[admin] password` で設定可能
- **セッション有効期限**: 24時間 (`wordbox.ini` の `[admin] sessionExpireHours` で変更可能)

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
| 辞書管理 | 辞書エントリの一覧表示、作成、編集、削除 |
| 画像管理 | ドラッグ＆ドロップでアップロード、一覧表示、削除、メタデータ編集 |
| ファイル管理 | ファイルのアップロード、一覧表示、削除、メタデータ編集 |
| 画像メタデータ | 各画像に名前、タグ、説明、alt属性を設定可能 |
| タグ一覧 | 使用中のタグと記事数を表示 |
| Markdownプレビュー | エディタでリアルタイムにHTMLプレビューを確認 |
| 検索インデックス再構築 | 手動で再構築可能 |
| バックアップ | コンテンツ全体のtar.gz圧縮バックアップ・ダウンロード |
| 差分比較 | 記事の編集前後の差分をHTML形式で表示 |

### ファイル名について
- **新規記事作成時**: UUID形式のIDが自動生成される（カスタムIDも設定可能）
- **画像・ファイルアップロード時**: ファイル名は自動的にUUID形式に変換される

### エディタ機能
- Markdownツールバー (太字、斜体、コード、リンク、画像、見出し)
- 画像挿入モーダル (アップロード済み画像から選択)
- リアルタイムMarkdownプレビュー
- リアルタイム検索フィルタ

### 画像・ファイルメタデータ管理
各画像/ファイルに以下のメタデータを設定できます：

| 項目 | 説明 |
|------|------|
| 名前 | 管理用名前（一覧に表示） |
| Alt属性 | 画像挿入時の`![この部分](url)`に使用される代替テキスト (画像のみ) |
| 説明 | 詳細説明 |
| タグ | カンマ区切りでタグを設定（例: "資料, 設計書"） |

**メタデータの保存先**:
- 画像: `static/images/metadata.json`
- ファイル: `static/files/metadata.json`

## 今後の拡張案 (未実装)

- ページネーション
- RSSフィード
- サイトマップ
- KaTeX数式レンダリング (katexパッケージは導入済み)
