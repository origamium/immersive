# Immersive Acoustic Lab

部屋の音響測定・原音保存・解析・前後比較を行うWebアプリと、Mac/tvOSのネイティブエンドポイントです。

## Web

```sh
pnpm install
pnpm dev
```

`.env.example`を参考に`.env.local`へ`VITE_SUPABASE_URL`と`VITE_SUPABASE_PUBLISHABLE_KEY`を設定します。接続画面からの設定も可能です。service_roleや管理用トークンはWebに渡しません。

「このブラウザーで測定」はログイン不要です。「部屋・機材」で実寸を登録し、測定画面で入力機器・チャンネル・ゲイン・マイクの向き・位置を指定します。MacではVoice Isolation等のMic Modeが外部入力にも影響する場合があるため、計測時はStandardを使います。入力確認と暗騒音測定は測定音を出しません。スイープは出力先と音量を確認し、開始ボタンを押した場合だけ再生します。

### iOSアプリ

`native/iOS/AcousticIOS.xcodeproj`は同じ測定Web画面を開くiPhone/iPadアプリです。HTTPSの配信先を入力するとAVR操作、結果・調整画面、ローカルPCM収録が使えます。マイク許可は収録時だけ求め、サイトと異なるオリジンやカメラ権限は拒否します。録音のPCM処理・保存・解析はWeb側が担当し、iOS側はWebKitのマイク許可を管理します。iOSの内蔵マイクも無処理を保証できないため、Control CenterにMic Modeが出る場合はWide Spectrumを選びます。USBマイク・UR12は接続機器の実認識、入力ゲイン、処理状態を実機で確認してから計測に使ってください。

Mac／Apple TV連携を使う場合は「接続」でメールログインし、端末のペアリングコードを承認します。iPhoneで開く場合はHTTPSが必要です。校正のないマイクは相対評価を基本とします。

### SM58＋Steinberg UR12

1. SM58をUR12のMIC入力1に接続。48Vは不要、Direct Monitorと設定可能なLoopbackはOFFにします。
2. 「入出力機器を更新」→ UR12 → 録音チャンネル1を選択。「入力・スペクトルを確認」で入力を確認し、停止します。マイクの音をスピーカーへモニターしません。
3. 無音で確認したい場合は「暗騒音を10秒測定」。結果は「比較・履歴」に保存されます。入力回路の雑音を含み、RMS／ピークはdBFS、スペクトル密度はdBFS/Hzです。
4. 音を出せる時間帯に、PMA／AVCへの出力先、左右、アンプ音量を確認して「スイープ測定を開始」。既定は10秒、−30 dBFS、3回です。
5. 「定在波を調べる」で20〜300 Hzの応答と部屋寸法からの予測を照合し、周波数ごとの減衰、名前・座標を変えて測った位置間の差を確認します。

SM58は単一指向性のボーカル用で、公称帯域50 Hz〜15 kHz、低域ロールオフがあります。向きとゲインを固定した参考比較には使えますが、校正済み無指向性測定マイクの代替にはなりません。仕様範囲外を図示し、SM58からPEQ候補や絶対SPLを生成しません。[Shure公式仕様](https://pubs.shure.com/view/guide/SM58/en-US.pdf)、[UR12取扱説明書](https://download.steinberg.net/downloads_hardware/UR12/UR12_documentation/Manual/ur12_en_om_a0.pdf)。

ブラウザーは48 kHz処理を要求し、44.1/48 kHzの実レートで解析します。入力トラックの報告レートも別に保存しますが、物理ハードウェアの動作レートを保証する値ではありません。出力選択に未対応のブラウザーではMac側で出力先を指定してください。暗騒音・ローカルスイープの原音はこのブラウザーとWAV／ZIPへ保存し、スイープ結果のみ任意にクラウド同期できます。解析失敗時も原音は残り、「原音から再解析」で再試行できます。

周波数応答TXT/FRD/CSVの取り込みはクラウドなしでも使えます。IR WAVのクラウド解析にはMacのワーカーが必要です。

## Mac Companion

```sh
pnpm native:mac
```

生成物は`native/build/Acoustic Lab.app`。ローカル署名のアプリです。SupabaseのURLと公開キーを入力し、ペアリング後に出力デバイスを選択して「受信を開始」します。受信開始だけでは音を出しません。

CLIは`native/.build/release/acoustic-lab`。`devices`で能力確認、`generate <wav>`でESS作成、`analyze <ir.wav> <analysis.json>`でIR解析、`record <input-uid> <seconds> <wav>`でネイティブ録音ができます。`worker`などクラウド用コマンドには`SUPABASE_URL`と`SUPABASE_PUBLISHABLE_KEY`を渡します。録音・再生の実機確認は別途必要です。

## Apple TV

登録後の手順は [Apple TV実機への署名・インストール・テスト](docs/tvos-signing-and-testing.md) を参照してください。Xcodeの直接実行からTestFlight内部テスト、音響の受け入れ試験までまとめています。検証素材の登録ではStereo、Multi Ch In、Dolby Atmosを申告し、TVの準備表示と検証記録で照合します。形式ラベルやAVRのAtmos表示は、実際の出力レイアウトを証明しません。

`native/AppleTV/AcousticTV.xcodeproj`をXcodeで開き、実機インストール用のSigning Teamを選択します。プロジェクト再生成は`pnpm native:tv`。Simulatorでコンパイル検証済みですが、実機の世代・AVR経路によるAtmos分離は未検証です。

Webの責務分担は[アプリ整理計画](docs/app-responsibilities.md)を参照。iOS Simulator向けビルドは`pnpm native:ios`です。

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

[avcon統合の運用・検証状況](docs/avcon/integration.md)
