# Immersive Acoustic Lab

部屋の音響測定・原音保存・解析・前後比較を行うWebアプリと、Mac/tvOSのネイティブエンドポイントです。

## Web

```sh
pnpm install
pnpm dev
```

`.env.example`を参考に`.env.local`へ`VITE_SUPABASE_URL`と`VITE_SUPABASE_PUBLISHABLE_KEY`を設定します。接続画面からの設定も可能です。service_roleや管理用トークンはWebに渡しません。

「接続」でメールログインし、MacまたはApple TVのペアリングコードを承認。「部屋・機材」で実寸、マイク校正、入力ゲイン、アンプ音量、経路、スピーカー割当てを登録してから測定します。iPhoneで開く場合はHTTPSが必要です。校正のない内蔵マイクは相対評価を基本とします。

周波数応答TXT/FRD/CSVの取り込みはクラウドなしでも使えます。IR WAVのクラウド解析にはMacのワーカーが必要です。

## Mac Companion

```sh
pnpm native:mac
```

生成物は`native/build/Acoustic Lab.app`。ローカル署名のアプリです。SupabaseのURLと公開キーを入力し、ペアリング後に出力デバイスを選択して「受信を開始」します。受信開始だけでは音を出しません。

CLIは`native/.build/release/acoustic-lab`。`devices`で能力確認、`generate <wav>`でESS作成、`analyze <ir.wav> <analysis.json>`でIR解析、`record <input-uid> <seconds> <wav>`でネイティブ録音ができます。`worker`などクラウド用コマンドには`SUPABASE_URL`と`SUPABASE_PUBLISHABLE_KEY`を渡します。録音・再生の実機確認は別途必要です。

## Apple TV

`native/AppleTV/AcousticTV.xcodeproj`をXcodeで開き、実機インストール用のSigning Teamを選択します。プロジェクト再生成は`pnpm native:tv`。Simulatorでコンパイル検証済みですが、実機の世代・AVR経路によるAtmos分離は未検証です。

Webの接続画面からテスト素材と作成条件を保存し、まず検証モードで再生。対象スピーカーの分離と前後の時刻基準を確認した記録を保存してから通常測定に使用します。Atmosの表示だけで7.1.6の個別出力を有効化しません。

## Supabase

`supabase/migrations`のSQLを適用し、Authの匿名ログインを有効化します。通常ユーザーはメールOTP、端末は匿名Auth identity + オーナーのコード承認です。

この環境ではCLIを`npx supabase`で実行し、管理操作ごとに`SUPABASE_ACCESS_TOKEN`環境変数を渡します。トークンをソースや`.env.example`に保存しないでください。`export`を別の一時シェルで実行しても次のコマンドには引き継がれないことがあります。

```sh
npx supabase db push --dry-run
npx supabase db push
```

認証メールのリダイレクト先には公開Web URLを登録します。コード入力によるログインは同じ画面で完結します。

## 検証と方式

```sh
pnpm build
pnpm test
pnpm test:e2e
pnpm test:db
pnpm native:test
```

- [再生能力の調査、測定理論、実機検証手順](docs/acoustics.md)
- [状態管理、保存、権限、バックアップと制約](docs/architecture.md)

自動でAVR設定を書き換える機能はありません。提案を評価し、同じ条件で再測定する流れを採用しています。
