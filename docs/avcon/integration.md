# avcon → Immersive 統合運用

既存avconの実装と調査資料を、音響測定アプリのMac Companionへ統合する。Pythonサーバーを常駐させず、SwiftのAVRサービスをWeb・HomeKit・CLIから共用する。

## 開始方法

1. リポジトリで `npm run native:mac` を実行し、`native/build/Acoustic Lab.app` を開く。
2. 「AVR / HomeKit」でAVRのIPを入力し「AVRに接続」。音声出力デバイスの選択は不要。
3. Webから使う場合は「音響」タブでMacをSupabaseへペアリングし、Webの接続タブで承認する。その後「AVR / HomeKit」の「クラウド操作を開始」。
4. WebのAVRタブに登録された機器が表示される。電源・音量・ミュート・入力はZone 1/2/3、サウンドモードとチャンネルトリムはメインゾーンが対象。
5. ウィンドウを閉じてもサービスは継続する。明示的な停止は各タブ、アプリ終了はメニューバーのImmersive。「ログイン時に起動」は任意。

AVR側のネットワーク制御と、このMacからのLAN到達性が必要。PMA-A110のUSB-DAC出力設定はCoreAudio側の音声経路であり、AVC-A110のネットワーク操作とは独立している。

この端末で使われているHomebrewのlibsodiumはmacOS 26向けであるため、今回の配布ビルドはmacOS 26以上になる。パッケージ処理が依存ライブラリの最低OSを調べ、アプリに記録する。別の最低OSを対象にする場合は、そのOSをサポートするlibsodiumでビルドし直す。署名・配布は[既存の署名／テスト手順](../tvos-signing-and-testing.md)も参照。

## HomeKit

Macの「HomeKitを開始」を選び、同じLANにいるiPhoneのホームアプリで「アクセサリを追加」からQRを読み取る。初回は未認証アクセサリとして案内される場合がある。Apple Developer Programの署名と、このHomeKitアクセサリのペアリングは別の手続き。

テレビ型アクセサリに入力切替、電源、ミュート、相対音量、明るさ操作による絶対音量を公開する。絶対音量の範囲は0〜98で、HomeKitの整数表示とWebの0.5刻み表示には分解能の差がある。サウンドモードスイッチは開始前に任意で有効化する。スイッチOFFは別モードを暗黙に選ばない。RemoteKeyは旧実装と同様に未対応。

入力識別子とペアリング秘密情報はMacのApplication Support内に保持し、公開Web・Supabase・診断原本へ出さない。ペアリング済みになるとQRとコードを非表示にする。旧avconのHomeKit stateは移さず、新規登録する。

## 測定との結合

WebのAVRタブで「このAVRの条件を測定前後に取得する」を選び、測定スピーカーごとにAVRチャンネルを割り当てる。FHL/FHRとTFL/TFR、SWとLFEは自動的に同一と見なさない。

各反復で、マイク開始前にAVR条件を取得して測定ロックを獲得する。ロックは15秒のリースで更新し、録音後に条件を再取得する。測定中の音量・入力・モード・トリム変更は拒否する。ミュートONと電源OFFは許可して測定を中断する。読み取りでリモコンなどによる条件変化が分かった場合も中断する。

観測は連続的な実機状態の完全記録ではない。ポーリングの間に変更して元に戻した操作、AVRが申告しない信号処理、実際のスピーカー出音はこの監視だけで証明できない。距離・クロスオーバー・アンプ割当て等のHTTPS setup情報は詳細診断として別途保存できるが、通常の測定ロックの定期観測には含めず、未確認条件として記録する。未確認項目を含む場合、解析側でその限界を表示する。

記録は `MeasurementContext.avrBinding` と `avrObservation` に付加され、既存データの読み込みを妨げない。前後の観測、中断理由、配線対応が原音・解析・バックアップへ引き継がれる。測定後の条件を取得できない場合も前の条件と原音を捨てず、検証済みにしない。比較画面はAVR・配線・音量・補正・トリムの差を警告する。

未結合の場合は従来の手動条件で測定できる。自動AVR検証を行ったことにはならない。EQ提案は提案に留め、自動書き込みは行わない。

## プリセットと旧保存値

センター +3 dB（旧Nolanプリセット）は、特定作品や部屋に対する最適補正を保証するものではない。適用前のC値を保存し、+6内部単位を送信、読み戻しを確認する。復元は元の絶対値を使い、逆方向の相対変更で代用しない。

旧Webの `localStorage['avcon.nolan']` が残っている場合、元のブラウザでそのJSONをテキストファイルへ保存し、新WebのAVRタブで取り込む。形式は `{"v":1,"saved":{"C":24}}`。取り込みは保存値の登録のみで、AVRを変更しない。保存値・適用値・現在値を比較し、適用後に別操作があった場合は明示的に差分を解決してから復元する。

## 通信とデータ

- AppCommandの単純／拡張50照会をカタログ化。XMLは改行を保持し、1要求1コマンド。原文と`control`属性を保持する。
- 音量・音量上限のAVR応答はdB。共通状態の`volume`/`limit`はdB+80の絶対スケール。旧`/api/status`の`volume`配下は従来のdBを返す。表示文字列と原文も保持する。
- トリムは内部0〜48を−12〜+12 dBへ換算する。CVコマンドのwire値は `(内部値+76)/2`。内部24は`CVC 50`、30は`CVC 53`。
- 詳細スナップショットはDeviceinfo、各ゾーンLite XML、AppCommand、任意のHTTPS setup・telnet・UPnP・HEOSを読み取る。未知のsetup typeや書き込み型HEOSは送信しない。エラー発生時は取得済み原本とエラーを保持し、危険な照会を続行しない。
- HTTPS setupは証明書のSHA-256をMacで確認・固定してから使う。旧実装の`verify=False`は引き継がない。
- 長い診断は測定外に実行する。通常操作と共通キューを使い、緊急停止操作で診断中断を要求できる。既に実行中のネットワーク要求にはタイムアウトまでの遅れがある。
- Web→Supabase→割り当てMac→LAN AVRの経路。テレビやレコーダーにAVR操作権限を付けない。
- 操作ID、期待revision、有効期限10秒、Macの永続台帳を使う。オフライン操作の積み残しは実行しない。送信後の応答喪失は結果不明とし、相対音量を自動再送しない。
- 保存済み診断はWebの「保存済み診断を一覧」から取得し、ダウンロード時に保存時のSHA-256と照合する。
- `avr_receivers`、`avr_observations`、`avr_operations`、`avr_snapshots` と非公開 `avr-private` bucketに保存する。クラウドのJWTやHomeKit秘密情報を診断へ含めない。

## ローカルAPIとCLI

Mac AVRサービス起動中は `127.0.0.1:8765` に限定してAPIを公開する。KeychainのBearerトークンを必須にし、任意のLAN宛てHTTPサーバーにはしない。CLIはKeychainから読み取り、同じサービスを呼び出す。

```sh
native/.build/debug/acoustic-lab avr status
native/.build/debug/acoustic-lab avr catalog
native/.build/debug/acoustic-lab avr snapshot > avr-snapshot.json
native/.build/debug/acoustic-lab avr operation operation.json
```

書き込み要求にはUUIDの `id`、直前の `expectedRevision`、ISO日時の `createdAt` と `expiresAt`（最大10秒後）を含める。旧APIのURLは継承するが、無認証の旧クライアントをそのまま接続しない。スキーマは原文と欠落値を保持する新しい共通モデルを併記する。

ローカル開発Web（localhost/127.0.0.1の5173/5187）では、Macの「ローカルAPIトークンをコピー」で取得したトークンをAVRタブへ入力して接続できる。トークンはWebのメモリ内に保持し、保存しない。測定前後の自動結合はクラウド経路を使う。

`acoustic-lab avr mock-serve` は実機へ接続しないシミュレーター。観測に`simulated: true`を付け、測定証拠への採用を拒否する。APIの自動検証は `node scripts/test-avr-api.mjs`。テスト専用トークンはこのシミュレーターだけで利用できる。

## 保全・受け入れ

原本コミットは `dd8dc8a5ea09ed03b7548bc931305ad324875d17`。Git全履歴のbundleと採取資料を `.local/avcon-original/` に保全し、SHA-256一覧とbundle verifyを実施。接続情報は `.local/avr-connection.json` に必要なAVR項目だけ保存。これらはGit・Web公開物の対象外。

Expo/Android/RevenueCat/商用化の構想は[元のpivot plan](pivot-plan.md)に保全し、今回の実装済み機能とは区別する。資料間のコマンド数やsetup typeの矛盾は、抽出した実装カタログを基準にし、当時の観測を普遍的な仕様として扱わない。

[移植状況と実機確認](migration-status.md)の未完了項目がなくなるまではavconを開発終了扱いにしない。元ディレクトリやGit履歴の削除・移動、GitHub archive操作は行わない。
