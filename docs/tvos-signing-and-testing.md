# Apple TV実機への署名・インストール・テスト

対象: Immersive Acoustic Lab / Apple TV 4K → AVC-A110 / 7.1.6構成。

Apple Developer Programへの登録後は、**Xcodeから直接インストールして接続と停止を確認 → 音響経路を検証 → 必要に応じてTestFlightで継続テスト**の順に進めます。App Store公開は実機テストの前提ではありません。

この文書は手順書です。開発用Teamの設定、実機インストール、App Store Connectへの登録・アップロードはまだ実施していません。Simulatorのビルド成功は実音・Atmosのチャンネル分離の検証を意味しません。

## 1. どの経路を使うか

| 経路 | 用途 | 必要な準備 | 更新方法 |
| --- | --- | --- | --- |
| Xcode → 自分のApple TV | 最初の動作確認、ログを見ながら修正 | 有料Teamでの開発署名、端末ペアリング | Xcodeで⌘R |
| TestFlight内部テスト | Macをつながず継続利用・更新 | 配布用ビルド、App Store Connect、内部テスター設定 | TVのTestFlightから更新 |
| TestFlight外部テスト | チーム外の協力者による検証 | 外部テスト情報、TestFlight App Review | 招待からインストール |

内部テスターはアプリへのアクセス権を持つApp Store Connectユーザーです。外部テストは初回ビルドの審査が必要です。TestFlightの各ビルドはアップロードから最大90日間利用できます。開発署名にも有効期限があるため、有料登録でも一度入れれば永久に動作するという扱いにはしません。[TestFlight概要](https://developer.apple.com/testflight/)・[テスター向け公式手順](https://testflight.apple.com/)

## 2. 登録済みアカウントをXcodeへ反映する

- [ ] Apple DeveloperのAccount画面でメンバーシップが有効になっている。
- [ ] Xcode → **Settings → Apple Accounts**で登録したApple Accountを追加する。バージョンによっては名称がAccounts。
- [ ] 有料の開発チームが表示されることを確認する。以前使っていた **Personal Teamではなく、今回登録したTeam**を選ぶ。
- [ ] Teamが表示されない場合は、登録完了・契約への同意状況を確認してからXcodeのアカウント情報を更新する。
- [ ] Apple TVの「設定 → 一般 → 情報」でモデルとtvOSバージョンを記録する。使用するXcodeがそのtvOSの実機開発に対応していることを確認する。

Appleは実機実行時にTeamと端末に対応する署名情報を用意します。自動署名を使う場合、接続端末の登録もXcodeから行えます。[実機での実行](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)・[端末登録](https://developer.apple.com/help/account/devices/register-a-single-device)

## 3. AcousticTVの署名を設定する

リポジトリのルートから開きます。すでに開いていれば実行不要です。

```sh
open native/AppleTV/AcousticTV.xcodeproj
```

1. 左側でプロジェクトを選び、**TARGETS → AcousticTV → Signing & Capabilities**を開く。
2. **Automatically manage signing**を有効にする。
3. **Team**に登録済みの有料Teamを指定する。DebugとReleaseの両方に適用されていることを確認する。
4. **Bundle Identifier**を確認する。現状は `app.immersive.acoustic.tv`。そのTeamで登録できない場合は、自分固有の逆ドメイン形式へ変更する。
5. Signingのエラーが解消され、開発用証明書とProvisioning Profileが選ばれるまで待つ。Register Deviceが表示されたら登録する。

### このリポジトリでの注意

| 項目 | 現在の設定 |
| --- | --- |
| Target / Scheme | AcousticTV |
| 最低対応tvOS | 17.0 |
| 署名 | Automatic。Teamは未指定 |
| Bundle ID | app.immersive.acoustic.tv |
| Version / Build | Info.plistに1.0 / 1を直接記載 |
| ローカル依存パッケージ | native/Package.swiftのAcousticTransport |

`pnpm native:tv`は `native/generate-project.mjs`でプロジェクトファイルを上書きします。**署名設定後は、通常のビルドのために再生成する必要はありません。** 再生成した場合はTeamとBundle IDを再設定してください。継続的に再生成する運用にする場合は、先に生成スクリプトにも設定を反映します。

Bundle IDはApp Store Connectの登録と一致させます。運用開始後に変更すると別アプリになるため、最初の登録時に確定してください。

## 4. Apple TVをMacとペアリングする

1. MacとApple TVを同じLANに接続する。Apple TVはAVC-A110にHDMI接続しておく。
2. Apple TVで **設定 → リモコンとデバイス → Remote Appとデバイス**を開いたままにする。
3. Xcodeで **Window → Devices and Simulators → Devices**を開く。
4. 検出されたApple TVを選び、**Pair**を押す。
5. テレビに表示された確認コードをMacへ入力する。
6. 接続・開発準備が完了したことを確認する。

新しいXcodeでは **実行先メニュー → Manage Devices**または **Xcode → Open Developer Tool → Device Hub**から端末管理を開きます。iPhone用の「プライバシーとセキュリティ」手順をtvOSに当てはめず、端末管理画面の案内に従ってください。[Apple TVのペアリング](https://help.apple.com/xcode/mac/current/en.lproj/devbc48d1bad.html)・[Device Hub](https://developer.apple.com/documentation/xcode/managing-your-simulated-and-physical-devices-in-device-hub)

見つからない場合は、同一LAN、ゲストネットワークの端末間隔離、VPN、Mac側ファイアウォールを確認します。Apple TVを再検出するまで上記の設定画面を開いておきます。

## 5. Xcodeからインストールする

1. Xcode上部のSchemeを **AcousticTV**にする。
2. 実行先を **実際のApple TV名**にする。Simulatorや汎用のtvOS Deviceではないことを確認する。
3. **Product → Run（⌘R）**を実行する。
4. 初回の端末準備・署名・ビルド・転送を待つ。
5. テレビに **IMMERSIVE / ACOUSTIC LAB**と接続フォームが表示されれば、インストールの確認は完了。

再実行・更新も⌘Rです。ログはXcodeのDebug Area、ビルドエラーはIssue Navigatorで確認します。通常の直接インストールではApp Store Connectのアプリ登録や審査を先に行う必要はありません。

## 6. Supabaseへ接続する

Appleによる端末ペアリングと、Acoustic Lab内の端末登録は別の操作です。

1. TVアプリの **Supabase URL**へ、Webと同じプロジェクトのURLを入力する。
2. **Publishable key**へ、同じプロジェクトの公開キーを入力する。リポジトリの `.env.local`では `VITE_SUPABASE_URL`と `VITE_SUPABASE_PUBLISHABLE_KEY`に対応する。
3. TVで **ペアリング**を押す。
4. [Webアプリ](https://immersive-acoustic-lab.arclisp.chatgpt.site)を開き、オーナーのメールアドレスでログインする。
5. Webの **接続**で、TVに表示されたコードを承認する。コードの有効期限は10分。期限切れならTVで再発行する。
6. TVで **受信を開始**を押す。
7. Webの端末一覧でApple TVの最終接続時刻が更新されることを確認する。

TVアプリにservice_roleや `SUPABASE_ACCESS_TOKEN`は入力しません。通常の署名・インストール・測定にSupabase CLIは不要です。クラウドの管理作業が必要な場合だけ、既存の運用どおり `npx supabase`へ管理トークンをプロセス環境変数で渡します。

## 7. 実機テストを段階的に進める

### A. 接続と操作

- [ ] 受信開始だけでは音が出ない。
- [ ] Webに端末が表示され、最終接続時刻が更新される。
- [ ] TVの「受信・再生を停止」で待ち受けを終了できる。
- [ ] アプリを起動し直した後、保存済み設定で再接続できる。

### B. テスト素材を用意する

この版のTVアプリは **AVPlayerで事前作成した素材を再生する端末**です。任意の7.1.6ch Atmos信号をアプリ内で生成する機能や、検証済みAtmos素材は同梱していません。Apple Developer Programへの登録で素材が自動生成されるわけでもありません。

1. Webの「部屋・機材」で再生経路・スイープ条件を設定し、「測定」で対象スピーカーを選ぶ。
2. 「接続 → Apple TVの検証素材 → 素材作成用の条件 JSON」を保存する。
3. 対象スピーカーと基準スピーカー、サンプルレート、スイープ長、開始・終了周波数、レベルが条件に合う素材を作成・用意する。
4. 前後にアプリの解析方式に対応する時間基準マーカーを含める。[信号と解析の仕様](acoustics.md#信号と解析)を参照する。
5. 「MP4 / M4A / MOV / EC3 を登録」で素材を保存し、アセットIDを控える。拡張子が合うだけではAVPlayerでの再生・Atmos出力を保証しない。

市販のチャンネル確認動画は経路の予備確認には使えても、このアプリのスイープ条件やマーカーと一致しなければ測定用素材として扱えません。まずステレオの対応素材で制御を確認し、高さチャンネルは適切な空間音声素材を用意してから進めます。

### C. 低レベルで再生・停止を確認する

1. AVRの音量を下げ、現在のSound Mode、Audyssey、Dynamic EQ、Dynamic Volume、クロスオーバーを記録する。
2. iPhoneでWebを前面表示し、マイク権限を許可する。収録中は画面をロックしない。
3. Webの測定画面でApple TV、対象スピーカー、アセットIDを指定し、**検証モード**を有効にする。
4. 準備応答を確認して測定を開始する。初回は最小限の回数にする。
5. 以下の停止条件を一つずつ確認し、停止までの実測時間を記録する。

| 操作 | 期待結果 |
| --- | --- |
| Webで測定を中止 | 再生を停止し、中断として扱う |
| TVの「受信・再生を停止」 | TV上で直ちに停止処理が動く |
| TVアプリをバックグラウンドへ移す | 再生を停止する |
| Web端末のネットワークを切る | 更新済みの再生リースが失効した後に停止する。リースは最大5秒、監視間隔は0.1秒。切断操作からの総時間も実測する |
| 通信を戻す | 失効した再生が勝手に再開しない |

異音、クリップ、予想外のチャンネル出力が出たら停止し、その試行を通常測定の根拠にしません。

### D. 7.1.6chの割り当てを検証する

- [ ] FL / FR / C / LFE / SL / SR / SBL / SBRを個別に確認する。
- [ ] TFL / TFR / TML / TMR / TRL / TRRを個別に確認する。
- [ ] 対象外スピーカーへの漏れを確認する。基準マーカーの出力先はスイープ本体と区別する。
- [ ] LFEの直接信号と、低域管理でサブへ転送される音を区別する。
- [ ] 前後のマーカーを収録で確認する。
- [ ] Apple TVの音声設定とAVCの入力・モードを記録する。

**AVCにAtmosと表示されただけでは合格にしません。** 実際の接続・素材・AVR処理で14位置を分離できるかが確認対象です。Mac HDMIのPCM出力も14chには拡張されません。[再生能力の境界](acoustics.md#再生能力の調査2026-09-11)

確認できた対象だけ、「接続 → Apple TVの検証素材」でアセットID、経路・設定、確認方法と結果（20文字以上）を入力し、実際に確認したチェックを付けて「この経路での検証記録を保存」を押します。対象スピーカーの選択が正しいことを確認してください。

### E. 通常測定と解析を確認する

1. 検証済みの素材・同じ経路で検証モードを解除する。
2. 同じマイク位置・方向・ゲイン・アンプ音量で3回測定する。
3. 原音が保存され、Macの解析ワーカーで解析されることを確認する。TVはDSP解析を行わないため、Mac Companionの受信も開始しておく。
4. クリップ、SNR、時計ずれ、品質理由、繰り返しのばらつきを確認する。
5. 条件を一つ変更して再測定し、「比較・履歴」に仮説・変更点・聴感を保存する。
6. CSV、JSON、レポートを出力し、測定条件と原音IDを追跡できることを確認する。

内蔵マイクの相対評価と、校正済み外部マイクによる評価を区別します。精度の受け入れ基準はREW等との同条件比較で決め、Simulatorや合成信号の合格を代用しません。

## 8. TestFlightで継続テストする場合

Xcodeによる直接インストールと上記テストが通ってから進めます。**現状はTestFlightアップロード検証前です。** 次の配布準備を済ませてください。

### 配布用ビルドの準備

- [ ] 有料Teamと確定したBundle IDをDebug / Releaseに設定する。
- [ ] tvOS用App Icon等、現在のXcode検証で要求されるアセットを追加する。現状のプロジェクトにはアセットカタログがない。
- [ ] `native/AppleTV/Info.plist`の `CFBundleShortVersionString`と `CFBundleVersion`を設定する。再アップロード時はBuildを増やす。現状はリテラル値なので、Build Settingsだけの変更で更新されたと思い込まない。
- [ ] ArchiveのValidateで提示されるメタデータ・SDK・アセットの不足を解消する。
- [ ] 暗号化に関する設問は実装に応じて回答する。警告回避のためだけにInfo.plistの申告値を固定しない。

### App Store Connectから内部テストへ

1. App Store Connect → **Apps → ＋ → New App**でtvOSアプリを作成する。Bundle IDはXcodeと一致させる。SKUは自分の管理用に一意な値を指定する。
2. Xcodeの実行先を汎用のtvOS実機向けターゲットにし、**Product → Archive**を実行する。SimulatorではArchiveしない。
3. Organizerでアーカイブを選び、**Validate App**で確認後、**Distribute App**からApp Store Connect / TestFlight向けにアップロードする。名称はXcodeの版で異なる。
4. App Store Connectで処理完了を待ち、TestFlightタブで必要な情報と輸出コンプライアンスの設問を完了する。
5. **Internal Testing**に自分用のグループを作り、アプリへのアクセス権を持つ自分のアカウントとビルドを追加する。
6. Apple TVのApp StoreからTestFlightをインストールする。
7. 招待メールをMacまたはiPhoneで開き、**View in TestFlight**に表示される引き換えコードをTVのTestFlightの **Redeem**へ入力する。
8. Acoustic Labをインストールし、接続・受信・停止・測定を再確認する。署名経路の変更後は保存済み認証が引き継がれると仮定せず、必要なら再ペアリングする。

メール招待とコード引き換えはApple TV向けの公式手順です。TestFlightでは各ビルドの残り日数を確認でき、期限前に新しいビルドをアップロードして更新します。[Apple TVへのTestFlightインストール](https://testflight.apple.com/)

外部の人に渡す場合はExternal Testingを使い、テスト情報とレビュー用のアクセス手順を用意してTestFlight App Reviewへ提出します。内部テストはApp Storeへの一般公開を意味しません。[外部テスターの招待](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers)

## 9. よくある詰まりどころ

| 症状 | 確認すること |
| --- | --- |
| TeamがPersonal Teamしかない | 有料登録の有効化、登録に使ったApple Account、契約同意、Xcodeのアカウント更新 |
| Signing requires a development team | AcousticTVターゲットのTeam。Debug / Release両方 |
| Bundle IDを登録できない | 一意なBundle IDに変更し、App Store Connectと一致させる |
| No profiles / Register Device | 自動署名、ネット接続、実機のペアリング、端末登録権限 |
| 実行先にApple TVが出ない | 同一LAN、TVのペアリング画面、端末隔離・VPN、Device Hub |
| tvOSが非対応 | 実機OSをサポートするXcodeとtvOS開発コンポーネント |
| ローカルパッケージが見つからない | xcodeproj単体を移動していないか。native/Package.swiftとの位置関係 |
| WebにTVが出ない | 同じSupabaseプロジェクト、コード承認、TVの「受信を開始」 |
| 素材のprepareが失敗 | アセットID、検証モード、対象・基準スピーカー、5つのスイープ条件、AVPlayer対応 |
| 原音はあるが解析されない | ペアリング済みMac Companionの稼働、解析ジョブの失敗理由 |
| TestFlightでビルドが選べない | 処理完了、コンプライアンス、内部グループへのビルド追加、テスター権限 |
| 再生成したら署名が消えた | pnpm native:tvの上書き。Team / Bundle IDを再設定 |

## 10. 実機試験の記録テンプレート

以下を試験ごとに別のMarkdownへコピーします。秘密鍵・トークンは記録しません。

```markdown
# AcousticTV実機テスト

- 日時:
- 実装リビジョン / Version / Build:
- インストール経路: Xcode / TestFlight
- Apple TVモデル / tvOS:
- Xcodeバージョン:
- AVCのHDMI入力 / Sound Mode:
- Apple TV音声設定:
- Audyssey / Dynamic EQ / Dynamic Volume / クロスオーバー:
- マイク / 校正ファイル / 向き / 位置 / ゲイン:
- アンプ音量:
- 対象スピーカー / 基準スピーカー:
- アセットID / セッションID / 原音ID:

| 試験 | 結果（合格 / 不合格 / 未実施） | 根拠・実測値 |
| --- | --- | --- |
| 署名・インストール・起動 | | |
| Supabase端末登録・受信 | | |
| 開始・手動停止 | | |
| バックグラウンド停止 | | |
| 通信切断時の停止時間 / 復旧時の非再開 | | |
| 対象ch・対象外への漏れ・マーカー | | |
| 原音保存・Mac解析 | | |
| 3回の再現性 | | |
| 比較・ログ・出力 | | |

- 不具合の再現手順:
- エラー全文（認証情報は除外）:
- 出力ファイルの保存先:
- 次回変更する条件:
```

## 関連資料

- [導入README](../README.md)
- [音響理論・能力調査・実機受け入れ](acoustics.md)
- [保存・権限・バックアップ](architecture.md)

Appleの画面名称・配布条件は更新されるため、実行時に差異があれば本文中の公式資料とXcodeの案内を確認してください。
