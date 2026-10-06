# 実装・保存・運用

## 構成

- React Web: AVR操作、測定条件、結果・履歴・比較・調整を担当。`/visualizer`は3Dスピーカー配置の別画面。
- ブラウザー単体: 共有AudioContextで離散L/R再生と選択入力の録音、Web WorkerでESS逆畳み込み・減衰解析。入力プレビューは保存せず、暗騒音は応答とは別の`AmbientObservation`に保存する。
- iOS SwiftUI/WKWebView: 同じHTTPS Web画面をアプリ内で開き、マイク権限を管理する。PCM収録・保存・解析はWeb側が行い、サイトと異なるマイク要求を拒否する。
- Mac Swift: AVR接続補助、CoreAudio機器の診断、Accelerate DSP、クラウド解析ワーカー。認証セッションはKeychain。既存のローカル録音CLIは移行完了まで互換用として残す。
- tvOS SwiftUI: AVPlayerによる事前取得素材の再生、端末登録、準備応答、停止監視。素材manifestにStereo / Multi Ch In / Dolby Atmosの申告形式を持たせ、Webでの検証記録とTV準備表示で照合する。Xcodeプロジェクトを同梱。
- Supabase: オーナーOTP認証、匿名端末を期限付きコードで登録、RLS、非公開Storage、Realtime通知、永続コマンドと解析キュー。

## 測定の状態と再試行

`draft → preparing → armed → playing → captured → complete`。中断や解析失敗は`interrupted`、解析ジョブは`failed`にする。

開始にはprepareのready応答と収録準備を要求する。コマンドID・sequence・generation・TTLを保存し、同じIDの再送で二重作成しない。再生リースは5秒、Webから1秒ごとに更新。Macは音声コールバック内の単調時計で失効を監視し、一度失効した再生を通信復旧で再開しない。tvOSは0.1秒の監視とアプリ状態変化で停止する。Realtimeは通知、DB行が正本。Mac/tvOSは永続キューをポーリングするので通知欠落でも履歴が消えない。

Web PCMは32,768サンプルのFloat32チャンクとしてIndexedDBへ順序付き保存。欠落、クリップ、非表示、入力ミュート、デバイス変更、120秒上限で中断する。アップロードに失敗しても原音は残る。Supabase StorageへはTUSでアップロードし、チャンクの完了状態を保存する。アーティファクトmanifestにはSHA-256、バイト数、フレーム数、レート、測定条件を記録する。

Storageファイルの存在・長さをDBで検証し、Macがさらに全チャンクのハッシュを確認して解析する。解析ジョブは10分の所有リースで取り出し、結果にはアルゴリズム版と原音IDを付ける。Macが停止している間は保存済み結果の閲覧が可能で、解析待ちの原音はキューに残る。

## 権限

オーナーは通常のメール認証。匿名ユーザーはワークスペースを作れない。Mac/TVのコードは12桁のランダム16進値、10分有効、一度だけ承認できる。端末ごとのAuth identityを用い、service_roleをアプリに埋め込まない。

TVは再生素材だけ読み取れ、マイク原音・解析ジョブは読めない。登録解除で端末のコマンド・リース・所属権限を失効させる。Storageは非公開で、ワークスペース/アーティファクトごとのパスとRLSを要求する。

## バックアップ

- IndexedDB v2は既存ストアを維持して`observations`を追加。バックアップdata v2へ環境音を含め、復元はv1/v2を受け入れる。ハッシュmanifestはv1を維持する。
- ローカルESSの`AnalysisResult`はschemaVersion 1/source sweepのまま、`localCaptureId`で原音を参照する。未アップロード原音の`rawArtifactId`はnull。入力機器・チャンネル・ブラウザー報告レート・出力経路は任意メタデータとして旧データと共存する。
- `LocalCapture.purpose`と`analysisOwner`で原音の用途・解析担当を識別する。暗騒音、手動録音、ブラウザー解析の原音は`syncCapture`でも拒否する。既存クラウドのcapture確定がスイープ解析を自動起動するため、用途の違う原音をそこへ送らない。既存クラウド測定はsweep/cloudを明記する。

- WebのZIPは「このブラウザーにある」結果・原音・ログ。クラウド全体のバックアップではない。復元前に全ハッシュを確認する。既存IDを上書きしない。
- Mac `backup`は呼び出し元に見えるDB行と確定済みStorageオブジェクトを保存する。Keychain認証情報・Authユーザー・他の端末の制限付き行を含まない。`verify-backup`でハッシュを確認する。
- 災害復旧にはSupabase側のDBバックアップに加えStorageのバックアップを維持する。DBバックアップだけで音声オブジェクトを復元できると考えない。
- この版にはクラウドへの全DB自動復元コマンドは含まない。別プロジェクトへの復元ではAuth IDの再割当てとStorageの復元が必要。

## 検証の範囲

`pnpm test`（応答・比較・品質条件）、`swift test --package-path native`（FFT・IR・減衰・WAV・±100 ppm・欠落）、`pnpm test:db`（ローカルRLS・ペアリング・リース・Storage・manifest・ジョブ・登録解除）、`pnpm test:e2e`（Chromium/WebKitの操作と疑似入力録音）。疑似入力・シミュレーターは実機の音響精度やAtmos分離を保証しない。

`test:db`はローカル127.0.0.1以外を拒否する。クラウドへテストユーザーを作らない。開発用Supabaseは55421〜55429番を使い、既存の別プロジェクトと分離する。
