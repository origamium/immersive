> avcon原本からの移植資料（歴史的記録）。原本コミット: `dd8dc8a5ea09ed03b7548bc931305ad324875d17`。当時の実機観測・仮説を含み、現在の全環境での保証ではありません。IP/MAC表記は伏せています。現実装との差分は [移植状況](../migration-status.md) を参照してください。

# DENON AVC-A110 HTTP API リファレンス

## 接続情報
- **APIポート**: 8080（HTTPのみ）
- **WebコントロールUI**: 10443（HTTPS）
- **HEOS**: TCP 1255, HTTP 60006
- **ポート80**: HTTPSへリダイレクト（自己署名証明書）— 使用不可
- **CommApiVers**: 0301（新世代API）

## 動作確認済みコマンド（2026-02-14 網羅テスト完了）

### AppCommand.xml — 21 コマンド動作確認済み
- ゾーン: `GetAllZonePowerStatus`, `GetAllZoneSource`, `GetAllZoneVolume`, `GetAllZoneMuteStatus`, `GetAllZoneStereo`, `GetZoneName`
- サラウンド: `GetSurroundModeStatus`
- オーディオ: `GetToneControl`, `GetSubwooferLevel`, `GetChLevel`(全32ch), `GetChannelIndicators`
- ソース: `GetRenameSource`, `GetDeletedSource`, `GetFriendlyName`, `GetQuickSelectName`
- システム: `GetAutoStandby`, `GetDimmer`, `GetECO`, `GetECOMeter`
- ビデオ: `GetPictureMode`, `GetVideoSelect`

### AppCommand0300.xml — 23 コマンド（19 コマンドでデータ返却確認）
- オーディオ: `GetAudioInfo`(signal/sound/fs/inputmode/output), `GetAudioDelay`(audiodelay), `GetBassSync`(basssync), `GetBassTreble`(bass/treble), `GetRestorerMode`(mode)
- ビデオ: `GetVideoInfo`(videooutput/hdmisigin/hdmisigout), `GetOutputSettings`(videomode), `GetResolutionHDMIList`(resolution/hdmiresolution/resolutionlist)
- 入力信号: `GetInputSignal`(inputsigall) — 5×4チャンネルグリッド
- スピーカー: `GetActiveSpeaker`(activespall) — 5×4スピーカーグリッド, `GetLRchLevel`(lrchlevel)
- サラウンド: `GetSoundMode`(movie/music/game/pure), `GetSoundModeList`(genrelist) — 選択可能モード一覧, `GetSurroundParameter`(centerimage/dimension/centerwidth/panorama)
- Audyssey: `GetAudyssey`(dynamiceq/reflevoffset/dynamicvol/multeq), `GetAudyssyInfo`(dynamiceq/dynamicvol — テキスト値)
- EQ: `GetEQParameter`(eqparam — 9バンド×2), `GetEQAdjustChList`(adjustch)
- ソース: `GetHideSources`(空リスト可), `GetSourceRename`(空リスト可)
- システム: `GetNetworkInfo`(dhcp/ssid/connection), `GetHdmiSetup`(audioout), `GetUpdateInfo`(status)

### パラメータ未発見 / CMD ERR のコマンド
- 空リスト: GetDialogEnhancer, GetDynCompList, GetIMAXList, GetEQSetting, GetEQOtherFunc, GetSetupLock, GetInputSelect, GetFirmware, GetIpScalerList, GetResolutionAnalogList, GetAudysseyEQCurveType
- CMD ERR: GetStatus, GetExternalContol, GetDeleteSource

### Dolby Atmos - TrueHD 再生時の実測値
- `GetAudioInfo`: signal="Dolby Atmos - TrueHD", sound="Dolby Atmos", fs="48 kHz"
- `GetVideoInfo`: hdmisigin="4K24", hdmisigout="4K24", videooutput="Auto(Dual)"
- `GetSurroundModeStatus`: "Dolby Atmos"
- `GetSoundModeList`: 9モード選択可能（Dolby Atmos/DSur が selected=1）
- `GetActiveSpeaker`: 7.1.6構成（FL/FR/C/SW + SL/SR + SBL/SBR + FHL/FHR + TML/TMR + RHL/RHR）
- `GetInputSignal`: 7.1.4入力（FL/FR/C/LFE/SL/SR/SBL/SBR + FHL/FHR/EXT/SB/FWL/FWR）
- `GetAudyssey`: multeq=3(XT32), dynamiceq=0(OFF), dynamicvol=0(OFF)

### control 属性の意味（0300レスポンス）
- `control="0"`: 無効 / 読み取り不可
- `control="1"`: 読み取り可能 / ユーザー変更可能
- `control="2"`: 読み取り可能 / システム管理