# avcon移植対応表

原本コミット: `dd8dc8a5ea09ed03b7548bc931305ad324875d17`

原本・Git bundle・採取データは非公開の `.local/avcon-original/` に保全。bundle verify成功。

| 旧公開メソッド | 移植・検証状態 |
| --- | --- |
| get_device_info | Deviceinfo読取・XMLツリー保存を実装。機種取得は実機確認済み |
| get_status | ゾーンLite読取・共通状態モデルを実装。旧DTOとの完全互換は未確認 |
| get_all_zone_power | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_all_zone_source | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_all_zone_volume | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_all_zone_mute | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_all_zone_stereo | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_zone_name | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_surround_mode | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_tone_control | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_subwoofer_level | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_channel_levels | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_channel_indicators | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_rename_source | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_deleted_sources | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_friendly_name | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_quick_select | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_auto_standby | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_dimmer | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_eco | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_eco_meter | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_picture_mode | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_video_select | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_audio_info | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_video_info | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_input_signal | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_active_speaker | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_sound_mode | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_sound_mode_list | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_surround_parameter | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_audyssey | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_audyssey_info | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_restorer_mode | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_audio_delay | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_bass_sync | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_bass_treble | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_output_settings | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_lr_channel_level | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_hide_sources | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_source_rename_0300 | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_network_info | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_hdmi_setup | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_update_info | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_dialog_enhancer | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_eq_speaker_selection | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_eq_curve_copy | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_setup_lock | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_input_select_mode | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_eq_parameter | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_eq_adjust_channels | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_resolution_hdmi_list | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_resolution_analog_list | 照会カタログ移植・原本と一致。実機の全件再検証は未実施 |
| get_device_capabilities | Deviceinfo読取・XMLツリー保存を実装。機種取得は実機確認済み |
| power_on | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| power_standby | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| volume_up | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| volume_down | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| volume_set | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| mute_on | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| mute_off | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| select_source | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| select_surround_mode | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| set_channel_level | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |
| channel_level_reset | 共通キュー・操作ID・読み戻し判定を実装。実機書込は未確認 |

## 照合・検証記録（2026-09-13）

- 保存済み `client.py` のASTと移植カタログを比較し、50照会のコマンド名・パラメータ・単純／拡張分類が完全一致。
- avcon `docs/api-reference.md` のXML抜粋をSwiftの回帰フィクスチャへ追加。音量の取得値はdB、設定値はdB+80という旧実装の変換を修正。内部状態は絶対スケール、旧 `/api/status` の音量・上限はdBを維持。
- Swiftの直列化・再起動時重複防止・測定ロック・プリセット復元／期限を検証。認証付きローカルAPIのHost/Origin制限・本文サイズ・旧getter・音量操作・重複ID・古いrevisionのテストも通過。
- 実機からDeviceinfoと全ゾーンの電源・音量・入力・ミュートを読み取り成功。生応答は非公開 `.local/avr-live/` に保存。音量変更などの実機書き込みはまだ行っていない。
- Supabase migration 003はローカル／クラウド適用済み。所有者・割当Mac・失効機器の権限はローカル統合テストで検証済み。クラウド経由の実機往復は未確認。

## 残る受け入れ項目

- 全getterの正規化結果と旧DTOの差分確認（コマンド一致だけでは結果の同等性を証明しない）。
- Macアプリからの実機操作・読み戻し、入力名と操作名の対応、HomeKitからの実機操作。HomeKit新規ペアリングは成功済み。
- クラウドから割当Macを経由する実機操作、録音とAVR前後条件の実機統合確認。
- 診断スナップショットのクラウド再送、公開版の確認。Webの保存済み原本取得・SHA-256検証は実装／単体検証済み。

HomeKit実機確認・全機能移行が完了するまでavconは開発終了にしません。

最新検証: Swift 20件、Web単体15件通過。ブラウザ9件通過・合成マイク非対応のiPhone録音1件スキップ。Mac配布アプリの再ビルド・署名検証・起動成功。Macアプリの実機LAN通信は初回にオフラインエラーが出たが、後続の画面確認でAVC-A110への正常接続を確認。ユーザー確認ではローカルネットワーク許可は当初から有効だったため、権限拒否とは断定しない。原因は未特定。

tvOS Simulator（arm64/x86_64）のXcodeビルドも成功。実機署名・インストール・Atmos再生の検証とは区別する。

Mac画面から実機の電源ON・絶対音量44.0・入力MPLAY・Dolby Atmos・14チャンネルのトリム取得を確認。これは状態読取の検証であり、書き込み・HomeKit・クラウド往復の確認とは区別する。

追加の実機読取: MacのGetAudioInfoからsignal=Dolby Atmos、sound=Dolby Atmos、fs=48 kHz、output=Speakerを取得。HomeKitサービス起動とMac上のQR表示を確認。iPhoneホームアプリでの登録成功・アクセサリ表示をユーザーが確認。Mac側でもペアリング後にQRとコードが非表示になったことを確認（コードは資料へ保存しない）。
