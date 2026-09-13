> avcon原本からの移植資料（歴史的記録）。原本コミット: `dd8dc8a5ea09ed03b7548bc931305ad324875d17`。当時の実機観測・仮説を含み、現在の全環境での保証ではありません。IP/MAC表記は伏せています。現実装との差分は [移植状況](migration-status.md) を参照してください。

# DENON AVC-A110 API コマンドリファレンス

> テスト日: 2026-02-14
> ファームウェア: CommApiVers 0301
>
> ### 機器接続構成
>
> ```
> 4K UHD Blu-ray Player ──HDMI──→ AVR (BD入力)
> Apple TV 4K ─────────HDMI──→ AVR (MPLAY入力)
> AVR ──────────HDMI──→ BRAVIA (Google TV)
> BRAVIA ───────eARC──→ AVR (TV Audio入力) ※TV内蔵アプリのみ
> ```
>
> ### サンプル一覧
>
> | # | コンテンツ | ソース機器 | 入力 | 信号フォーマット |
> |---|-----------|-----------|------|----------------|
> | 1 | WARFARE (4K UHD BD) | 4K UHD Blu-ray Player | BD (HDMI直結) | Dolby Atmos - TrueHD (ロスレス) |
> | 2 | Bladerunner 2049 (Sony Pictures Core) | BRAVIA / Sony Pictures Core | TV Audio (eARC) | IMAX DTS (DTS:X IMAX Enhanced) |
> | 3 | F1 ザ・ムービー (Apple TV購入) | Apple TV 4K / TVアプリ | MPLAY (HDMI直結) | Dolby Atmos (Dolby Digital+ ロッシー) |
> | 4 | Apple Music ロスレス (ステレオ) | Apple TV 4K / Apple Music | MPLAY (HDMI直結) | PCM Stereo (ALAC/ロスレス) |
> | 5 | (電源オフ / STANDBY) | — | MPLAY (最終選択) | Unknown / Multi Ch In |

---

## GET エンドポイント

### `GET /goform/Deviceinfo.xml` — デバイス情報 / 機能カタログ

デバイスの基本情報と**機能カタログ全体**を返す（約 68KB）。基本 3 フィールド
以外に以下が含まれる（2026-07 全解析。パーサは `avcon/client.py` の
`get_device_capabilities()`）:

- `DeviceCapabilities/Setup` — 全 40 機能の定義。各機能に:
  - `Commands` — その機能で使える正式 Get/Set コマンド名（**0300 コマンドの
    正式サポート一覧はここから導出できる。Get 系は計 35 個**）
  - `List/Value/(DispName, CmdNo)` — **数値→表示名のデコード辞書**
    （例: Audyssey MultEq `3`→`Reference`, `2`→`L/R Bypass`, `1`→`Flat`, `0`→`Off`）
  - `MinValue/MaxValue/DefaultValue/Step` — 値域
- `DeviceCapabilities/Operation` — Clock / AllZonePower / AllZoneMute / Favorites
- `DeviceZoneCapabilities` ×3 — ゾーン別能力: 音量上限(98.0, step 0.5)・
  入力ソース 18 種一覧・ショートカット 21 種・QuickSelect 構成等

**レスポンス例（抜粋）**:
```xml
<Device_Info>
  <ModelName>AVC-A110</ModelName>
  <MacAddress>XXXXXXXXXXXX</MacAddress>
  <CommApiVers>0301</CommApiVers>
  <DeviceCapabilities>
    <Setup>
      <DialogEnhancer>
        <List><Value><DispName>High</DispName><CmdNo>3</CmdNo></Value>...</List>
        <Commands><GetDialogEnhancer ver="1">1</GetDialogEnhancer>...</Commands>
      </DialogEnhancer>
      ...
    </Setup>
  </DeviceCapabilities>
</Device_Info>
```

### `GET /goform/formMainZone_MainZoneXmlStatusLite.xml` — メインゾーン状態

電源・音量・ミュート・入力ソースを返す。

**レスポンス例**:
```xml
<item>
  <Power><value>ON</value></Power>
  <InputFuncSelect><value>BD</value></InputFuncSelect>
  <VolumeDisplay><value>Absolute</value></VolumeDisplay>
  <MasterVolume><value>-46.5</value></MasterVolume>
  <Mute><value>off</value></Mute>
</item>
```

- `Power/value`: `"ON"` または `"OFF"`（`"OFF"` = デバイス上の STANDBY 状態）
- `MasterVolume/value`: dB 値（例: `"-46.5"`）
- STANDBY 時も全値が返る（最終選択ソース・音量設定が保持される）
- STANDBY (Sample 5) 例: `Power=OFF`, `InputFuncSelect=MPLAY`, `MasterVolume=-37.0`

### `GET /goform/formZone2_Zone2XmlStatusLite.xml` — Zone 2 状態

### `GET /goform/formZone3_Zone3XmlStatusLite.xml` — Zone 3 状態

Zone 2/3 もメインゾーンと同じ XML 構造で応答する。

---

## AppCommand.xml コマンド（21 コマンド動作確認済み）

### ゾーン制御

#### `GetAllZonePowerStatus`

各ゾーンの電源状態を返す。

```xml
<rx>
<cmd>
<zone1>ON</zone1>
<zone2>OFF</zone2>
<zone3>OFF</zone3>
</cmd>
</rx>
```

- `ON` = 電源オン、`OFF` = スタンバイ

#### `GetAllZoneSource`

各ゾーンの入力ソースを返す。

```xml
<rx>
<cmd>
<zone1><source>BD</source></zone1>
<zone2><source>SOURCE</source></zone2>
<zone3><source>NET</source></zone3>
</cmd>
</rx>
```

- ソース値: `BD`, `MPLAY`, `CBL/SAT`, `DVD`, `GAME`, `AUX1`, `CD`, `TUNER`, `NET`, `TV`, `BT`, `PHONO` 等
- `SOURCE` = Zone 2/3 でフォロー設定時のデフォルト値
- `TV` = TV Audio (HDMI eARC) 入力

#### `GetAllZoneVolume`

各ゾーンの音量・表示情報を返す。

```xml
<rx>
<cmd>
<zone1>
<volume>-46.5</volume>
<state>variable</state>
<limit>-10.0</limit>
<disptype>ABSOLUTE</disptype>
<dispvalue>33.5</dispvalue>
</zone1>
<zone2>
<volume>-40</volume>
<state>variable</state>
<limit>-10.0</limit>
<disptype>ABSOLUTE</disptype>
<dispvalue> 40</dispvalue>
</zone2>
<!-- zone3 も同様 -->
</cmd>
</rx>
```

- `volume`: dB 値（-80.0 〜 18.0）
- `disptype`: `ABSOLUTE` または `RELATIVE`
- `dispvalue`: 表示用音量値（Absolute 表示の場合 volume + 80）
- `limit`: 最大音量制限値
- `state`: `variable` = ユーザー変更可能

#### `GetAllZoneMuteStatus`

各ゾーンのミュート状態を返す。

```xml
<rx>
<cmd>
<zone1>off</zone1>
<zone2>off</zone2>
<zone3>off</zone3>
</cmd>
</rx>
```

- `on` = ミュート中、`off` = ミュート解除

#### `GetAllZoneStereo`

All Zone Stereo 機能の状態を返す。

```xml
<rx>
<cmd>
<status>1</status>
<value>0</value>
<zones>000</zones>
<selections>000</selections>
</cmd>
</rx>
```

- `status`: `1` = 機能利用可能
- `value`: `0` = OFF, `1` = ON
- `zones`: 各ゾーンの参加状態（3桁ビットマスク）

#### `GetZoneName`

各ゾーンのカスタム名を返す。

```xml
<rx>
<cmd>
<zone1>MAIN ZONE </zone1>
<zone2>ZONE2     </zone2>
<zone3>ZONE3     </zone3>
</cmd>
</rx>
```

> 値は固定長でパディングされている（末尾のスペース）。

### サラウンド

#### `GetSurroundModeStatus`

現在のサラウンドモードを返す。

```xml
<rx>
<cmd>
<surround>Dolby Atmos                                                    </surround>
</cmd>
</rx>
```

> 値は固定長 64 文字でパディングされている。`strip()` が必要。

再生信号によって値が変わる:
- `Stereo` — 2ch ソース時 (S4)
- `Dolby Atmos` — Dolby Atmos 再生中 (S1, S3)
- `IMAX DTS` — IMAX Enhanced (DTS:X) 再生中 (S2)
- `Multi Ch In` — **STANDBY 時** (S5) — 信号なしの状態
- `Neural:X` — DTS Neural:X 使用時
- 等

### オーディオ設定

#### `GetToneControl`

トーンコントロール（バス・トレブル）の状態を返す。

```xml
<rx>
<cmd>
<status>1</status>
<adjust>0</adjust>
<basslevel>0dB</basslevel>
<bassvalue>6</bassvalue>
<treblelevel>0dB</treblelevel>
<treblevalue>6</treblevalue>
</cmd>
</rx>
```

- `status`: `1` = 利用可能
- `adjust`: `0` = OFF, `1` = ON（トーンコントロール有効）
- `basslevel` / `treblelevel`: 表示用レベル（-6dB 〜 +6dB）
- `bassvalue` / `treblevalue`: 内部値（0 〜 12, 6 = 0dB）

#### `GetSubwooferLevel`

サブウーファーのレベルを返す。

```xml
<rx>
<cmd>
<status>1</status>
<sw1status>1</sw1status>
<sw1dispname>Subwoofer 1</sw1dispname>
<sw1level>0.0dB</sw1level>
<sw1value>24</sw1value>
<sw2dispname></sw2dispname>
<sw2status>0</sw2status>
<sw2level>0</sw2level>
<sw2value>0</sw2value>
</cmd>
</rx>
```

- `sw1status`/`sw2status`: `1` = 接続済み、`0` = 未接続
- `sw1level`: 表示用レベル（-12.0dB 〜 +12.0dB）
- `sw1value`: 内部値（0 〜 48, 24 = 0.0dB）

#### `GetChLevel`

全チャンネルのレベル設定を返す。

```xml
<rx>
<cmd>
<status>1</status>
<chlists>
<ch>
<name>C</name>
<status>1</status>
<sptype>2</sptype>
<level>0.0dB</level>
<value>24</value>
</ch>
<ch>
<name>FL</name>
<status>1</status>
<sptype>2</sptype>
<level>0.0dB</level>
<value>24</value>
</ch>
<!-- 全 32 チャンネル分 -->
</chlists>
</cmd>
</rx>
```

対応チャンネル一覧（status=1 が有効）:

| チャンネル | 名前 | sptype | 説明 |
|-----------|------|--------|------|
| C | Center | 2 | センター |
| SW | Subwoofer | 1 | サブウーファー |
| FL / FR | Front L/R | 2 | フロント L/R |
| SL / SR | Surround L/R | 1 | サラウンド L/R |
| SBL / SBR | Surround Back L/R | 1 | サラウンドバック L/R |
| FHL / FHR | Front Height L/R | 1 | フロントハイト L/R |
| TML / TMR | Top Middle L/R | 1 | トップミドル L/R |
| RHL / RHR | Rear Height L/R | 1 | リアハイト L/R |

- `sptype`: `0` = 未使用, `1` = Small, `2` = Large
- `value`: 内部値（0 〜 48, 24 = 0.0dB）

未接続チャンネル: SW2, SB, FWL/FWR, TFL/TFR, TRL/TRR, SHL/SHR, FDL/FDR, SDL/SDR, BDL/BDR, TS, CH

#### `GetChannelIndicators`

チャンネルインジケーターの状態を返す。

```xml
<rx>
<cmd>
<value>1</value>
</cmd>
</rx>
```

- `value`: `1` = インジケーター表示、`0` = 非表示

### ソース管理

#### `GetRenameSource`

入力ソースのカスタム名を返す。

```xml
<rx>
<cmd>
<functionrename>
<list>
<name>CBL/SAT</name>
<rename>CBL/SAT     </rename>
</list>
<list>
<name>Media Player</name>
<rename>MPLAY       </rename>
</list>
<!-- 全 18 ソース分 -->
</functionrename>
</cmd>
</rx>
```

- `name`: デフォルトソース名
- `rename`: ユーザー設定名（固定長パディング）

#### `GetDeletedSource`

ソースの有効/無効（削除）状態を返す。

```xml
<rx>
<cmd>
<functiondelete>
<list>
<name>CBL/SAT</name>
<FuncName>CBL/SAT</FuncName>
<use>1</use>
</list>
<list>
<name>AUX3</name>
<FuncName>AUX3</FuncName>
<use>0</use>
</list>
<!-- 全 18 ソース分 -->
</functiondelete>
</cmd>
</rx>
```

- `use`: `1` = 有効（表示）, `0` = 無効（非表示/削除済み）

#### `GetFriendlyName`

デバイスの表示名を返す。

```xml
<rx>
<cmd>
<friendlyname>Denon AVC-A110</friendlyname>
</cmd>
</rx>
```

#### `GetQuickSelectName`

クイックセレクトのプリセット名とソースを返す。

```xml
<rx>
<cmd>
<Name1>Quick Select 1  </Name1>
<Name2>Quick Select 2  </Name2>
<Name3>Quick Select 3  </Name3>
<Name4>Quick Select 4  </Name4>
<Source1>CBL/SAT     </Source1>
<Source2>Blu-ray     </Source2>
<Source3>CD          </Source3>
<Source4>NET         </Source4>
</cmd>
</rx>
```

### システム設定

#### `GetAutoStandby`

各ゾーンのオートスタンバイ設定を返す。

```xml
<rx>
<cmd>
<list>
<listvalue>
<zone>Main</zone>
<value>0</value>
</listvalue>
<listvalue>
<zone>Zone2</zone>
<value>0</value>
</listvalue>
<listvalue>
<zone>Zone3</zone>
<value>0</value>
</listvalue>
</list>
</cmd>
</rx>
```

- `value`: `0` = OFF, `1` = 15 min, `2` = 30 min, `3` = 60 min（推定）

#### `GetDimmer`

ディスプレイの明るさ設定を返す。

```xml
<rx>
<cmd>
<value>3</value>
</cmd>
</rx>
```

- `value`: `0` = OFF（消灯）, `1` = Dark, `2` = Dim, `3` = Bright

#### `GetECO`

ECO モード設定を返す。

```xml
<rx>
<cmd>
<status>1</status>
<mode>2</mode>
<pwondefault>2</pwondefault>
<display>2</display>
</cmd>
</rx>
```

- `status`: `1` = ECO 機能利用可能
- `mode`: `0` = ON, `1` = Auto, `2` = OFF
- `pwondefault`: 電源オン時のデフォルト（`2` = Last）
- `display`: ECO 表示設定

#### `GetECOMeter`

ECO メーター表示の値を返す。

```xml
<rx>
<cmd>
<value>15</value>
</cmd>
</rx>
```

### ビデオ設定

#### `GetPictureMode`

ピクチャーモードの状態を返す。

```xml
<rx>
<cmd>
<status>1</status>
<value>0</value>
</cmd>
</rx>
```

- `status`: `1` = 利用可能
- `value`: `0` = OFF

#### `GetVideoSelect`

ビデオセレクト機能の状態を返す。

```xml
<rx>
<cmd>
<status>0</status>
</cmd>
</rx>
```

- `status`: `0` = 利用不可（現在のソースでは無効）

---

## AppCommand0300.xml コマンド（データ返却確認済み: 19 コマンド）

### オーディオ信号情報

#### `GetAudioInfo`

オーディオの入出力信号情報を返す。

**パラメータ**: `inputmode`, `output`, `signal`, `sound`, `fs`

```xml
<!-- リクエスト -->
<cmd id="3">
<name>GetAudioInfo</name>
<list>
<param name="inputmode" />
<param name="output" />
<param name="signal" />
<param name="sound" />
<param name="fs" />
</list>
</cmd>
```

```xml
<!-- Sample 1: WARFARE (4K UHD BD) / 4K UHD Blu-ray Player → BD (HDMI直結) / Dolby Atmos - TrueHD -->
<param name="inputmode" control="1">Auto</param>
<param name="output" control="1">Speaker</param>
<param name="signal" control="1">Dolby Atmos - TrueHD </param>
<param name="sound" control="1">Dolby Atmos                                                    </param>
<param name="fs" control="1">48 kHz</param>
```

- `signal`: 受信信号フォーマット（PCM, Dolby Digital, Dolby Atmos - TrueHD 等）
- `sound`: 現在のサラウンドモード（Stereo, Dolby Atmos 等）— 固定長パディング
- `fs`: サンプリング周波数（48 kHz, 96 kHz 等）
- `inputmode`: 入力モード（Auto, HDMI, Digital 等）
- `output`: 出力先（Speaker 等）

```xml
<!-- Sample 2: Bladerunner 2049 (Sony Pictures Core) / BRAVIA → TV Audio (eARC) / IMAX DTS -->
<param name="inputmode" control="1">Auto</param>
<param name="output" control="1">Speaker</param>
<param name="signal" control="1">IMAX DTS             </param>
<param name="sound" control="1">IMAX DTS                                                       </param>
<param name="fs" control="1">48 kHz</param>
```

```xml
<!-- Sample 3: F1 ザ・ムービー (Apple TV) / Apple TV 4K → MPLAY (HDMI直結) / Dolby Atmos (DD+) -->
<param name="inputmode" control="1">Auto</param>
<param name="output" control="1">Speaker</param>
<param name="signal" control="1">Dolby Atmos          </param>
<param name="sound" control="1">Dolby Atmos                                                    </param>
<param name="fs" control="1"></param>
```

```xml
<!-- Sample 4: Apple Music ロスレス (ステレオ) / Apple TV 4K → MPLAY (HDMI直結) / PCM Stereo -->
<param name="inputmode" control="1">Auto</param>
<param name="output" control="1">Speaker</param>
<param name="signal" control="1">PCM                  </param>
<param name="sound" control="1">Stereo                                                         </param>
<param name="fs" control="1">48 kHz</param>
```

```xml
<!-- Sample 5: 電源オフ (STANDBY) — signal=Unknown, sound=Multi Ch In -->
<param name="inputmode" control="1">Auto</param>
<param name="output" control="1">Speaker</param>
<param name="signal" control="1">Unknown              </param>
<param name="sound" control="1">Multi Ch In                                                    </param>
<param name="fs" control="1"></param>
```

> **信号フォーマットの `signal` 値の違い**:
>
> | Sample | 状態 | signal | sound | fs |
> |--------|------|--------|-------|----|
> | 1 | BD / TrueHD | `Dolby Atmos - TrueHD` | `Dolby Atmos` | `48 kHz` |
> | 2 | eARC / DTS | `IMAX DTS` | `IMAX DTS` | `48 kHz` |
> | 3 | MPLAY / DD+ | `Dolby Atmos` | `Dolby Atmos` | (空) |
> | 4 | MPLAY / ALAC | `PCM` | `Stereo` | `48 kHz` |
> | 5 | **STANDBY** | **`Unknown`** | **`Multi Ch In`** | (空) |
>
> - DD+ Atmos / STANDBY では `fs` が空
> - PCM ロスレスは `signal=PCM` + `sound=Stereo` で伝送形式が表示される
> - STANDBY 時は `signal=Unknown` + `sound=Multi Ch In` — 信号なしの状態を示す特殊値

#### `GetAudioDelay`

オーディオディレイ設定を返す。

**パラメータ**: `audiodelay`

```xml
<param name="audiodelay" control="2">0</param>
```

- `audiodelay`: ディレイ値（ms 単位, 0 = ディレイなし）

#### `GetBassSync`

バスシンク設定を返す。

**パラメータ**: `basssync`

```xml
<!-- Sample 1,2,3: basssync 有効 (control="2") -->
<param name="basssync" control="2">0</param>
```

```xml
<!-- Sample 4: PCM Stereo — basssync 無効 (control="0") -->
<param name="basssync" control="0"></param>
```

- `basssync`: `0` = OFF
- PCM Stereo (Auto モード) では `control="0"`（設定無効）になる

#### `GetBassTreble`

バス・トレブル設定を返す（0300 形式）。

**パラメータ**: `bass`, `treble`

```xml
<param name="bass" control="2"></param>
<param name="treble" control="2"></param>
```

> トーンコントロール OFF 時は値が空。`GetToneControl`（基本コマンド）の方がより詳細な情報を返す。

#### `GetRestorerMode`

Compressed Audio Restorer（圧縮音声復元）の設定を返す。

**パラメータ**: `mode`

```xml
<!-- Sample 1,2,3: control="1" (ユーザー変更可能) -->
<param name="mode" control="1">0</param>
```

```xml
<!-- Sample 4: PCM Stereo — control="2" (システム管理) -->
<param name="mode" control="2">0</param>
```

- `mode`: `0` = OFF, `1` = Low, `2` = Medium, `3` = High（推定）
- PCM ロスレス入力では `control="2"`（Restorer はロスレスに対して不要だが設定自体は表示される）

---

### ビデオ信号情報

#### `GetVideoInfo`

HDMI ビデオ信号の入出力情報を返す。

**パラメータ**: `videooutput`, `hdmisigin`, `hdmisigout`

```xml
<!-- Sample 1: WARFARE (4K UHD BD) / 4K24p HDR -->
<param name="videooutput" control="1">Auto(Dual)</param>
<param name="hdmisigin" control="1">4K24</param>
<param name="hdmisigout" control="1">4K24</param>
```

```xml
<!-- Sample 3: F1 ザ・ムービー (Apple TV) / MPLAY HDMI直結 / 4K60 -->
<param name="videooutput" control="1">Auto(Dual)</param>
<param name="hdmisigin" control="1">4K60</param>
<param name="hdmisigout" control="1">4K60</param>
```

- `videooutput`: ビデオ出力モード（Auto(Dual), HDMI Monitor 1/2 等）
- `hdmisigin`: HDMI 入力信号（4K24 = 3840x2160/24p, 4K60 = 3840x2160/60p, 1080p60 等）
- `hdmisigout`: HDMI 出力信号
- `hdmisigin` が ` --- ` の場合、映像信号が検出されていない（一時停止中・メニュー画面等）

#### `GetOutputSettings`

ビデオ出力モード設定を返す。

**パラメータ**: `videomode`

```xml
<param name="videomode" control="2">1</param>
```

- `videomode`: ビデオモード設定値

#### `GetResolutionHDMIList`

HDMI 解像度リストの状態を返す。

**パラメータ**: `resolution`, `hdmiresolution`, `resolutionlist`

```xml
<param name="resolution" control="0">1</param>
<param name="hdmiresolution" control="0">1</param>
<param name="resolutionlist" control="0">1</param>
```

> すべて `control="0"`（読み取り不可）— ビデオプロセッシングが無効の場合。

---

### 入力信号 / スピーカー

#### `GetInputSignal`

入力信号のチャンネルマップを 5x4 グリッドで返す。

**パラメータ**: `inputsigall`

```xml
<!-- Sample 1: WARFARE (4K UHD BD) / Dolby Atmos - TrueHD 7.1.4 信号 -->
<param name="inputsiga1" control="1">FHL</param>
<param name="inputsigb1" control="2">LFE</param>
<param name="inputsigc1" control="0"></param>
<param name="inputsigd1" control="1">EXT</param>
<param name="inputsige1" control="1">FHR</param>
<param name="inputsiga2" control="1">FWL</param>
<param name="inputsigb2" control="2">FL</param>
<param name="inputsigc2" control="2">C</param>
<param name="inputsigd2" control="2">FR</param>
<param name="inputsige2" control="1">FWR</param>
<param name="inputsiga3" control="0">SHL</param>
<param name="inputsigb3" control="2">SL</param>
<param name="inputsigc3" control="0">TS</param>
<param name="inputsigd3" control="2">SR</param>
<param name="inputsige3" control="0">SHR</param>
<param name="inputsiga4" control="0"></param>
<param name="inputsigb4" control="2">SBL</param>
<param name="inputsigc4" control="1">SB</param>
<param name="inputsigd4" control="2">SBR</param>
<param name="inputsige4" control="0"></param>
```

**グリッド配置**（チャンネルインジケーター表示に対応）:

```
Row 1:  FHL    LFE    ---    EXT    FHR
Row 2:  FWL    FL      C     FR     FWR
Row 3:  SHL    SL     TS     SR     SHR
Row 4:  ---    SBL    SB     SBR    ---
```

- `control="2"`: アクティブ信号あり（表示点灯）
- `control="1"`: チャンネル存在（薄く表示）
- `control="0"`: チャンネルなし

> IMAX DTS (DTS:X) 入力時も同じ 7.1.4 チャンネルマップ・同じ control 値を返す。入力信号フォーマットに依存せず、信号に含まれるチャンネル構成を反映する。

```xml
<!-- Sample 3: F1 ザ・ムービー (Apple TV) / Dolby Atmos (DD+) — 7.1.4 信号だが control 値が異なる -->
<param name="inputsiga1" control="1">FHL</param>
<param name="inputsigb1" control="2">LFE</param>
<param name="inputsigc1" control="0"></param>
<param name="inputsigd1" control="1">EXT</param>
<param name="inputsige1" control="1">FHR</param>
<param name="inputsiga2" control="1">FWL</param>
<param name="inputsigb2" control="2">FL</param>
<param name="inputsigc2" control="2">C</param>
<param name="inputsigd2" control="2">FR</param>
<param name="inputsige2" control="1">FWR</param>
<param name="inputsiga3" control="0">SHL</param>
<param name="inputsigb3" control="2">SL</param>
<param name="inputsigc3" control="0">TS</param>
<param name="inputsigd3" control="2">SR</param>
<param name="inputsige3" control="0">SHR</param>
<param name="inputsiga4" control="0"></param>
<param name="inputsigb4" control="1">SBL</param>
<param name="inputsigc4" control="1">SB</param>
<param name="inputsigd4" control="1">SBR</param>
<param name="inputsige4" control="0"></param>
```

> **入力信号 control 値の比較（5 サンプル）**:
>
> | チャンネル | S1 (TrueHD) | S2 (IMAX DTS) | S3 (DD+) | S4 (PCM) | S5 (STANDBY) |
> |-----------|------------|--------------|---------|---------|-------------|
> | FL/FR | 2 | 2 | 2 | 2 | **2** |
> | C | 2 | 2 | 2 | 2 | **1** |
> | LFE | 2 | 2 | 2 | 2 | **1** |
> | SL/SR | 2 | 2 | 2 | 2 | **1** |
> | SBL/SBR | 2 | 2 | **1** | 2 | **1** |
> | FHL/FHR | 1 | 1 | 1 | 1 | 1 |
> | EXT | 1 | 1 | 1 | 1 | 1 |
>
> - STANDBY では FL/FR のみ `control="2"` — Apple TV から HDMI ステレオ信号が残留
> - C/LFE/SL/SR/SBL/SBR はすべて `control="1"` に変化（信号なし）
> - DD+ Atmos は SBL/SBR のみ `control="1"`（5.1ch ベースレイヤー）

#### `GetActiveSpeaker`

アクティブスピーカー構成を 5x4 グリッドで返す。

**パラメータ**: `activespall`

```xml
<!-- Sample 1: WARFARE / Dolby Atmos — 7.1.6 構成 (FL/FR/C/SW + SL/SR + SBL/SBR + FHL/FHR + TML/TMR + RHL/RHR) -->
<param name="activespa1" control="1">FHL</param>
<param name="activespb1" control="1">SW</param>
<param name="activespc1" control="0"></param>
<param name="activespd1" control="0"></param>
<param name="activespe1" control="1">FHR</param>
<param name="activespa2" control="0"></param>
<param name="activespb2" control="1">FL</param>
<param name="activespc2" control="1">C</param>
<param name="activespd2" control="1">FR</param>
<param name="activespe2" control="0"></param>
<param name="activespa3" control="1">TML</param>
<param name="activespb3" control="1">SL</param>
<param name="activespc3" control="0"></param>
<param name="activespd3" control="1">SR</param>
<param name="activespe3" control="1">TMR</param>
<param name="activespa4" control="1">RHL</param>
<param name="activespb4" control="1">SBL</param>
<param name="activespc4" control="0"></param>
<param name="activespd4" control="1">SBR</param>
<param name="activespe4" control="1">RHR</param>
```

**スピーカーグリッド配置**:

```
Row 1:  FHL    SW     ---    ---    FHR
Row 2:  ---    FL      C     FR     ---
Row 3:  TML    SL     ---    SR     TMR
Row 4:  RHL    SBL    ---    SBR    RHR
```

- `control="1"`: スピーカー接続済み / アクティブ
- `control="0"`: スピーカー未接続

```xml
<!-- Sample 2: Bladerunner 2049 / IMAX DTS — 全スピーカーが control="2" (アクティブ出力中) に変化 -->
<param name="activespa1" control="2">FHL</param>
<param name="activespb1" control="2">SW</param>
<param name="activespc1" control="0"></param>
<param name="activespd1" control="0"></param>
<param name="activespe1" control="2">FHR</param>
<param name="activespa2" control="0"></param>
<param name="activespb2" control="2">FL</param>
<param name="activespc2" control="2">C</param>
<param name="activespd2" control="2">FR</param>
<param name="activespe2" control="0"></param>
<param name="activespa3" control="2">TML</param>
<param name="activespb3" control="2">SL</param>
<param name="activespc3" control="0"></param>
<param name="activespd3" control="2">SR</param>
<param name="activespe3" control="2">TMR</param>
<param name="activespa4" control="2">RHL</param>
<param name="activespb4" control="2">SBL</param>
<param name="activespc4" control="0"></param>
<param name="activespd4" control="2">SBR</param>
<param name="activespe4" control="2">RHR</param>
```

```xml
<!-- Sample 3: F1 ザ・ムービー / Dolby Atmos (DD+) — control="1" と "2" が混在 -->
<param name="activespa1" control="1">FHL</param>
<param name="activespb1" control="2">SW</param>
<param name="activespc1" control="0"></param>
<param name="activespd1" control="0"></param>
<param name="activespe1" control="1">FHR</param>
<param name="activespa2" control="0"></param>
<param name="activespb2" control="2">FL</param>
<param name="activespc2" control="2">C</param>
<param name="activespd2" control="2">FR</param>
<param name="activespe2" control="0"></param>
<param name="activespa3" control="1">TML</param>
<param name="activespb3" control="1">SL</param>
<param name="activespc3" control="0"></param>
<param name="activespd3" control="1">SR</param>
<param name="activespe3" control="1">TMR</param>
<param name="activespa4" control="1">RHL</param>
<param name="activespb4" control="2">SBL</param>
<param name="activespc4" control="0"></param>
<param name="activespd4" control="2">SBR</param>
<param name="activespe4" control="1">RHR</param>
```

> **5 サンプルでの ActiveSpeaker `control` 値比較**:
>
> | スピーカー | S1 (TrueHD) | S2 (IMAX) | S3 (DD+) | S4 (PCM) | S5 (STANDBY) |
> |-----------|------------|----------|---------|---------|-------------|
> | FL/FR | 1 | 2 | 2 | 2 | **2** |
> | C | 1 | 2 | 2 | 2 | **1** |
> | SW | 1 | 2 | 2 | 2 | **2** |
> | SL/SR | 1 | 2 | **1** | 2 | 1 |
> | SBL/SBR | 1 | 2 | **2** | 2 | 1 |
> | FHL/FHR | 1 | 2 | **1** | 2 | 1 |
> | TML/TMR | 1 | 2 | **1** | 2 | 1 |
> | RHL/RHR | 1 | 2 | **1** | 2 | 1 |
>
> - **S1 (TrueHD Atmos)**: 全 `1`（接続済み）
> - **S2 (IMAX DTS)** / **S4 (PCM Stereo)**: 全 `2`（アクティブ出力）
> - **S3 (DD+ Atmos)**: 混在 — ベースレイヤー ch が `2`、ハイト系が `1`
> - **S5 (STANDBY)**: FL/FR/SW のみ `2` — HDMI ステレオ残留信号に対応するスピーカーがアクティブ表示

#### `GetLRchLevel`

L/R チャンネルレベルの状態を返す。

**パラメータ**: `lrchlevel`

```xml
<param name="lrchlevel" control="2"></param>
```

> 値が空の場合、L/R レベル調整が現在のモードで無効。

---

### サラウンド / DSP

#### `GetSoundMode`

現在のサウンドモードカテゴリを返す。

**パラメータ**: `movie`, `music`, `game`, `pure`

```xml
<!-- Sample 1,2 共通: 映画モード選択中 -->
<param name="movie" control="2">1</param>
<param name="music" control="2">0</param>
<param name="game" control="2">0</param>
<param name="pure" control="2">0</param>
```

```xml
<!-- Sample 3,4 共通: Pure モード選択中 (Auto) -->
<param name="movie" control="2">0</param>
<param name="music" control="2">0</param>
<param name="game" control="2">0</param>
<param name="pure" control="2">1</param>
```

> `genrelist` の値は `GetSoundMode` のカテゴリに対応: `1`=movie, `2`=music, `3`=game, `4`=pure。

- `1` のカテゴリが現在アクティブ（排他的）

#### `GetSoundModeList`

現在の入力信号で選択可能なサラウンドモード一覧を返す。

**パラメータ**: `genrelist`

```xml
<!-- Sample 1: WARFARE / Dolby Atmos - TrueHD 入力時の movie モードリスト -->
<param name="genrelist" control="2">1</param>
<list>
<value>
<listno>1</listno>
<dispname>Stereo</dispname>
<selected>0</selected>
</value>
<value>
<listno>2</listno>
<dispname>Dolby Audio - Dolby TrueHD</dispname>
<selected>0</selected>
</value>
<value>
<listno>3</listno>
<dispname>Dolby Atmos/DSur</dispname>
<selected>1</selected>
</value>
<value>
<listno>4</listno>
<dispname>Dolby Audio - TrueHD + Neural:X</dispname>
<selected>0</selected>
</value>
<value>
<listno>5</listno>
<dispname>Auro-3D</dispname>
<selected>0</selected>
</value>
<value>
<listno>6</listno>
<dispname>Auro-2D Surround</dispname>
<selected>0</selected>
</value>
<value>
<listno>7</listno>
<dispname>Multi Ch Stereo</dispname>
<selected>0</selected>
</value>
<value>
<listno>8</listno>
<dispname>Mono Movie</dispname>
<selected>0</selected>
</value>
<value>
<listno>9</listno>
<dispname>Virtual</dispname>
<selected>0</selected>
</value>
</list>
```

- `selected`: `1` = 現在選択中
- `genrelist`: サウンドモードカテゴリ（`GetSoundMode` の movie/music/game/pure に対応）
- 入力信号によって選択可能なモードが変わる

```xml
<!-- Sample 2: Bladerunner 2049 / IMAX DTS 入力時の movie モードリスト -->
<param name="genrelist" control="2">1</param>
<list>
<value><listno>1</listno><dispname>Stereo</dispname><selected>0</selected></value>
<value><listno>2</listno><dispname>IMAX DTS</dispname><selected>1</selected></value>
<value><listno>3</listno><dispname>DTS + DSur</dispname><selected>0</selected></value>
<value><listno>4</listno><dispname>IMAX DTS + Neural:X</dispname><selected>0</selected></value>
<value><listno>5</listno><dispname>Auro-3D</dispname><selected>0</selected></value>
<value><listno>6</listno><dispname>Auro-2D Surround</dispname><selected>0</selected></value>
<value><listno>7</listno><dispname>Multi Ch Stereo</dispname><selected>0</selected></value>
<value><listno>8</listno><dispname>Mono Movie</dispname><selected>0</selected></value>
<value><listno>9</listno><dispname>Virtual</dispname><selected>0</selected></value>
</list>
```

> **入力信号によるモードリストの変化**:
>
> | # | Dolby Atmos - TrueHD | IMAX DTS (DTS:X) |
> |---|---------------------|------------------|
> | 1 | Stereo | Stereo |
> | 2 | Dolby Audio - Dolby TrueHD | **IMAX DTS** |
> | 3 | Dolby Atmos/DSur | **DTS + DSur** |
> | 4 | Dolby Audio - TrueHD + Neural:X | **IMAX DTS + Neural:X** |
> | 5 | Auro-3D | Auro-3D |
> | 6 | Auro-2D Surround | Auro-2D Surround |
> | 7 | Multi Ch Stereo | Multi Ch Stereo |
> | 8 | Mono Movie | Mono Movie |
> | 9 | Virtual | Virtual |
>
> 信号固有のモード（2〜4）が変わり、汎用モード（1, 5〜9）は共通。

```xml
<!-- Sample 3: F1 ザ・ムービー / Dolby Atmos (DD+) 入力時の movie モードリスト — Auto モード選択中 -->
<param name="genrelist" control="2">1</param>
<list>
<value><listno>1</listno><dispname>Direct</dispname><selected>0</selected></value>
<value><listno>2</listno><dispname>Pure Direct</dispname><selected>0</selected></value>
<value><listno>3</listno><dispname>Auto</dispname><selected>1</selected></value>
</list>
```

```xml
<!-- Sample 4: Apple Music ロスレス / PCM Stereo — Pure カテゴリ (genrelist=4) / Auto 選択中 -->
<param name="genrelist" control="2">4</param>
<list>
<value><listno>1</listno><dispname>Direct</dispname><selected>0</selected></value>
<value><listno>2</listno><dispname>Pure Direct</dispname><selected>0</selected></value>
<value><listno>3</listno><dispname>Auto</dispname><selected>1</selected></value>
</list>
```

```xml
<!-- Sample 5: STANDBY — movie カテゴリ (genrelist=1) に復帰 / Auto 選択 -->
<param name="genrelist" control="2">1</param>
<list>
<value><listno>1</listno><dispname>Direct</dispname><selected>0</selected></value>
<value><listno>2</listno><dispname>Pure Direct</dispname><selected>0</selected></value>
<value><listno>3</listno><dispname>Auto</dispname><selected>1</selected></value>
</list>
```

> **サウンドモードリスト比較（5 サンプル）**:
>
> | # | S1 TrueHD (movie) | S2 IMAX (movie) | S3 DD+ (movie) | S4 PCM (pure) | S5 STANDBY (movie) |
> |---|------------------|----------------|---------------|--------------|-------------------|
> | 1 | Stereo | Stereo | Direct | Direct | Direct |
> | 2 | Dolby Audio - TrueHD | IMAX DTS | Pure Direct | Pure Direct | Pure Direct |
> | 3 | Dolby Atmos/DSur ✓ | IMAX DTS ✓ | **Auto** ✓ | **Auto** ✓ | **Auto** ✓ |
> | 4〜9 | (6 modes) | (6 modes) | — | — | — |
>
> - S1/S2: **movie** カテゴリで 9 モード
> - S3: **movie** カテゴリだが 3 モードのみ（DD+ Atmos Auto 時）
> - S4: **pure** カテゴリで 3 モード
> - S5: STANDBY でも **movie** カテゴリに復帰、3 モード（Auto 選択）

#### `GetSurroundParameter`

サラウンドパラメータの値を返す。

**パラメータ**（2026-07 プローブで 4→13 個に拡張）:
`centerimage`, `dimension`, `centerwidth`, `panorama`,
`cinemaeq`, `loudness`, `dyncomp`, `dialogcontrol`, `lfe`,
`imax`, `auro3dmode`, `delaytime`, `roomsize`

```xml
<!-- Sample 1: WARFARE / Dolby Atmos モード — DSP パラメータ無効 -->
<param name="centerimage" control="0"></param>
<param name="dimension" control="0"></param>
<param name="centerwidth" control="0"></param>
<param name="panorama" control="0"></param>
```

```xml
<!-- Multi Ch In モード時の拡張パラメータ例 (2026-07) -->
<param name="cinemaeq" control="2">0</param>
<param name="loudness" control="2">0</param>
<param name="dyncomp" control="1">0</param>
<param name="lfe" control="2">0</param>
<!-- dialogcontrol / imax / auro3dmode / delaytime / roomsize は control="0" -->
```

> モードにより有効パラメータが変わる（Dolby Atmos では旧 4 パラメータすべて
> `control="0"`）。認識されない候補（`speakervirtualizer`, `centerspread`,
> `dtsneuralx`, `subwoofermode`, `effectlevel` 等）は Deviceinfo に機能として
> 存在するが 0300 パラメータ名としては不通 — telnet 照会（`PSVSS ?` `PSCES ?`
> `PSNEURAL ?` 等）で代替できる。

---

### Audyssey

#### `GetAudyssey`

Audyssey の主要設定を返す。

**パラメータ**: `dynamiceq`, `reflevoffset`, `dynamicvol`, `multeq`,
`audysseylfc`（第5パラメータは 2026-07 プローブで解明）

```xml
<param name="dynamiceq" control="2">0</param>
<param name="reflevoffset" control="1">0</param>
<param name="dynamicvol" control="2">0</param>
<param name="multeq" control="2">3</param>
<param name="audysseylfc" control="2">0</param>
```

- `dynamiceq`: `0` = OFF, `1` = ON
- `reflevoffset`: リファレンスレベルオフセット（0, 5, 10, 15 dB）
- `dynamicvol`: `0` = OFF, `1` = Light, `2` = Medium, `3` = Heavy
- `multeq`: `0` = OFF, `1` = Flat, `2` = L/R Bypass, `3` = Audyssey Reference（XT32）
  ※ 数値→表示名は Deviceinfo.xml の `Audyssey/MultEq/List` が正
- `audysseylfc`: `0` = OFF, `1` = ON（LFC = Low Frequency Containment。
  Containment Amount は 0300 では不通、telnet `PSCNTAMT ?` で取得可能）

```xml
<!-- Sample 2: Bladerunner 2049 / IMAX DTS 再生中 — multeq が強制 OFF -->
<param name="dynamiceq" control="2">0</param>
<param name="reflevoffset" control="1">0</param>
<param name="dynamicvol" control="2">0</param>
<param name="multeq" control="2">0</param>
```

> **IMAX Enhanced モードでは `multeq` が `0` (OFF) に強制される**。Dolby Atmos 再生時は `3` (Audyssey Reference/XT32) だった。IMAX Enhanced 規格が独自の音場補正を行うため、Audyssey MultEQ を無効化する。

```xml
<!-- Sample 3: F1 ザ・ムービー / Dolby Atmos (DD+) — Auto モード / multeq OFF -->
<param name="dynamiceq" control="2">0</param>
<param name="reflevoffset" control="1">1</param>
<param name="dynamicvol" control="2">0</param>
<param name="multeq" control="2">0</param>
```

> **Audyssey 設定の 5 サンプル比較**:
>
> | 設定 | S1 (TrueHD) | S2 (IMAX) | S3 (DD+) | S4 (PCM) | S5 (STANDBY) |
> |------|------------|----------|---------|---------|-------------|
> | multeq | **3** (Reference) | 0 | 0 | 0 | 0 |
> | dynamiceq | 0 | 0 | 0 | 0 | 0 |
> | dynamicvol | 0 | 0 | 0 | 0 | 0 |
> | reflevoffset | 0 | 0 | **1** | **1** | **1** |
>
> - S1 (BD/movie/Dolby Atmos) のみ `multeq=3` — Audyssey Reference/XT32 有効
> - S2 は IMAX Enhanced が MultEQ を強制 OFF
> - S3〜S5 (MPLAY/Auto) はすべて `multeq=0` + `reflevoffset=1`
> - STANDBY 時も最終設定が保持される

#### `GetAudyssyInfo`

Audyssey 設定情報を人間可読な形式で返す。

**パラメータ**: `dynamiceq`, `dynamicvol`（他のパラメータ名は認識されず）

```xml
<param name="dynamiceq" control="1">Off</param>
<param name="dynamicvol" control="1">Off</param>
```

> `GetAudyssey` が数値を返すのに対し、`GetAudyssyInfo` はテキスト値（Off/On 等）を返す。

#### `GetAudysseyEQCurveType`

Audyssey EQ カーブタイプを返す。

**状態**: コマンドは認識されるが、テスト済みの全パラメータ名（`curveall`, `curvetype`, `eqcurve`, `flat`, `bypasslr`, `containment`）で空リストを返す。Audyssey キャリブレーション実行中のみ有効か、AVC-A110 では未対応の可能性あり。

---

### EQ（イコライザー）

#### `GetEQParameter`

グラフィック EQ のバンド値を返す。

**パラメータ**: `eqparam`（または `eqparamall`）

```xml
<!-- 9 バンド × 2 チャンネル = 18 値 -->
<param name="1" control="2">0.0</param>
<param name="2" control="2">0.0</param>
<param name="3" control="2">0.0</param>
<!-- ... 9 バンド分 × 2 セット -->
```

> パラメータ名が番号のみ（"1" 〜 "9"）で返る。2 セット返るのは L/R チャンネルに対応していると思われる。

#### `GetEQAdjustChList`

EQ 調整対象チャンネルの状態を返す。

**パラメータ**: `adjustch`

```xml
<param name="adjustch" control="2">1</param>
```

---

### ソース管理 (0300 形式)

#### `GetHideSources`

ソースの表示/非表示設定を返す。パラメータ不要（空リストでデータ返却）。

```xml
<!-- リクエスト（空リスト）-->
<cmd id="3">
<name>GetHideSources</name>
<list />
</cmd>

<!-- レスポンス -->
<param name="CBL/SAT" control="2">1</param>
<param name="DVD" control="2">1</param>
<param name="Blu-ray" control="1">2</param>
<param name="Media Player" control="2">1</param>
<param name="GAME" control="2">1</param>
<param name="AUX1" control="2">1</param>
<param name="AUX2" control="2">1</param>
<param name="TV AUDIO" control="2">1</param>
<param name="CD" control="2">1</param>
<param name="PHONO" control="2">1</param>
<param name="TUNER" control="2">1</param>
```

- `1` = 表示、`2` = 非表示（推定）
- `control="1"` のソースはユーザーが切替可能

#### `GetSourceRename`

ソースのリネーム設定を返す（0300 形式）。パラメータ不要。

```xml
<!-- リクエスト（空リスト）-->
<cmd id="3">
<name>GetSourceRename</name>
<list />
</cmd>

<!-- レスポンス -->
<param name="CBL/SAT" control="2">CBL/SAT     </param>
<param name="DVD" control="2">DVD         </param>
<param name="Blu-ray" control="2">Blu-ray     </param>
<param name="Media Player" control="2">Media Player</param>
<param name="GAME" control="2">Game        </param>
<param name="AUX1" control="2">AUX1        </param>
<param name="AUX2" control="2">AUX2        </param>
<param name="TV AUDIO" control="2">TV Audio    </param>
<param name="CD" control="2">CD          </param>
<param name="PHONO" control="2">Phono       </param>
<param name="TUNER" control="2">Tuner       </param>
<param name="AUX3" control="0"></param>
<!-- AUX4 〜 AUX7 も control="0" で空 -->
```

> `GetRenameSource`（AppCommand.xml）と同等の情報を 0300 形式で返す。

---

### システム情報

#### `GetNetworkInfo`

ネットワーク接続情報を返す。

**パラメータ**: `dhcp`, `ssid`, `connection`

```xml
<param name="dhcp" control="1">Off</param>
<param name="ssid" control="1"><SSID></param>
<param name="connection" control="1">Wireless (Wi-Fi)</param>
```

> `ip`, `mac`, `gateway`, `subnet`, `dns`, `wifistrength`, `friendlyname` は認識されない。

#### `GetHdmiSetup`

HDMI 設定を返す。

**パラメータ**: `audioout`

```xml
<param name="audioout" control="1">1</param>
```

> `control`, `arc`, `passthrough`, `submode`, `hdmiaudio`, `hdmicontrol` 等は認識されない。

#### `GetUpdateInfo`

ファームウェア更新情報を返す。

**パラメータ**: `status`

```xml
<param name="status" control="1">1</param>
```

- `status`: `1` = 更新なし（推定）

---

## 2026-07 プローブで解明したコマンド（0300 形式）

Deviceinfo.xml の FuncName から候補を導出し一括送信する方式で、旧「パラメータ名
不明」11 コマンドのうち **5 個を解明**した。

| コマンド | パラメータ | 返却例 | 意味 |
|----------|-----------|--------|------|
| `GetDialogEnhancer` | **`mode`** | `0` | 0=OFF, 1=Low, 2=Medium, 3=High |
| `GetEQSetting` | **`speakerselection`** | `3` | 1=L/R, 2=Each, 3=All |
| `GetEQOtherFunc` | **`curvecopy`** | `1` | カーブコピー可否 |
| `GetSetupLock` | **`lock`** | `0` | 0=解除, 1=ロック中 |
| `GetInputSelect` | **`inputmode`** | `1` | 0=No Input, 1=Auto, 2=HDMI, 3=Digital, 4=Analog, 5=7.1CH IN, 6=ARC, 7=eARC |

補足:

- `GetEQParameter` は `eqparamall` 指定で 9 バンド分（パラメータ名 `1`〜`9`）を返す
- `GetEQAdjustChList` は `adjustch` で動作
- `GetResolutionHDMIList` / `GetResolutionAnalogList` は**送ったパラメータ名を
  そのままエコーする**挙動（ビデオプロセッシング無効時は全て `control="0"` 値 `1`）

## 未解明のまま残るコマンド（0300 形式）

| コマンド | 状況 | 代替手段 |
|----------|------|---------|
| `GetDynCompList` | 全候補で空リスト | `GetSurroundParameter` の `dyncomp` / telnet `PSDRC ?` |
| `GetIMAXList` | 全候補で空リスト（IMAX 再生中も） | — |
| `GetFirmware` | 全候補で空リスト | telnet `SSINFFRM ?` / ajax `general/Firmware` |
| `GetIpScalerList` | 全候補で空リスト | ajax `video/OutputSettings` |
| `GetAudysseyEQCurveType` | 全候補で空リスト | — |

### CMD ERR 返却

| コマンド | 備考 |
|----------|------|
| `GetStatus` | 空リスト・パラメータ指定の両方で `<CMD ERR>` |
| `GetExternalContol` | 空リスト・パラメータ指定の両方で `<CMD ERR>`（2026-07 再確認） |
| `GetDeleteSource` | 空リスト・パラメータ指定の両方で `<CMD ERR>` — `GetDeletedSource`（AppCommand.xml）を使用 |

---

## コマンド一覧サマリー

### AppCommand.xml（21 コマンド動作確認済み）

| コマンド | カテゴリ | 主な返却値 |
|----------|---------|-----------|
| `GetAllZonePowerStatus` | ゾーン | 全ゾーン電源状態 |
| `GetAllZoneSource` | ゾーン | 全ゾーン入力ソース |
| `GetAllZoneVolume` | ゾーン | 全ゾーン音量・制限 |
| `GetAllZoneMuteStatus` | ゾーン | 全ゾーンミュート状態 |
| `GetAllZoneStereo` | ゾーン | All Zone Stereo 状態 |
| `GetZoneName` | ゾーン | ゾーンカスタム名 |
| `GetSurroundModeStatus` | サラウンド | 現在のサラウンドモード名 |
| `GetToneControl` | オーディオ | バス・トレブル設定 |
| `GetSubwooferLevel` | オーディオ | サブウーファーレベル |
| `GetChLevel` | オーディオ | 全チャンネルレベル（32ch） |
| `GetChannelIndicators` | オーディオ | インジケーター表示状態 |
| `GetRenameSource` | ソース | ソースリネーム一覧 |
| `GetDeletedSource` | ソース | ソース有効/無効一覧 |
| `GetFriendlyName` | システム | デバイス表示名 |
| `GetQuickSelectName` | システム | クイックセレクト名/ソース |
| `GetAutoStandby` | システム | オートスタンバイ設定 |
| `GetDimmer` | システム | ディスプレイ明るさ |
| `GetECO` | システム | ECO モード設定 |
| `GetECOMeter` | システム | ECO メーター値 |
| `GetPictureMode` | ビデオ | ピクチャーモード状態 |
| `GetVideoSelect` | ビデオ | ビデオセレクト状態 |

### AppCommand0300.xml（データ返却確認済み: 28 コマンド / 2026-07 更新）

Deviceinfo.xml の `Commands` 宣言による正式サポート Get コマンドは全 35 個。
うち 28 個がデータ返却確認済み、5 個が未解明、2 個が CMD ERR。

| コマンド | パラメータ | カテゴリ |
|----------|-----------|---------|
| `GetAudioInfo` | `inputmode`, `output`, `signal`, `sound`, `fs` | オーディオ |
| `GetAudioDelay` | `audiodelay` | オーディオ |
| `GetBassSync` | `basssync` | オーディオ |
| `GetBassTreble` | `bass`, `treble` | オーディオ |
| `GetRestorerMode` | `mode` | オーディオ |
| `GetDialogEnhancer` | `mode` ★ | オーディオ |
| `GetVideoInfo` | `videooutput`, `hdmisigin`, `hdmisigout` | ビデオ |
| `GetOutputSettings` | `videomode` | ビデオ |
| `GetResolutionHDMIList` | `resolution`, `hdmiresolution`, `resolutionlist`（エコー挙動） | ビデオ |
| `GetResolutionAnalogList` | `resolutionanalog` 等（エコー挙動）★ | ビデオ |
| `GetInputSignal` | `inputsigall` | 入力信号 |
| `GetInputSelect` | `inputmode` ★ | 入力 |
| `GetActiveSpeaker` | `activespall` | スピーカー |
| `GetLRchLevel` | `lrchlevel` | スピーカー |
| `GetSoundMode` | `movie`, `music`, `game`, `pure` | サラウンド |
| `GetSoundModeList` | `genrelist` | サラウンド |
| `GetSurroundParameter` | 13 個（`centerimage`, `dimension`, `centerwidth`, `panorama`, `cinemaeq`, `loudness`, `dyncomp`, `dialogcontrol`, `lfe`, `imax`, `auro3dmode`, `delaytime`, `roomsize`）★ | サラウンド |
| `GetAudyssey` | `dynamiceq`, `reflevoffset`, `dynamicvol`, `multeq`, `audysseylfc` ★ | Audyssey |
| `GetAudyssyInfo` | `dynamiceq`, `dynamicvol` | Audyssey |
| `GetEQParameter` | `eqparamall`（`1`〜`9` のバンド値が返る） | EQ |
| `GetEQAdjustChList` | `adjustch` | EQ |
| `GetEQSetting` | `speakerselection` ★ | EQ |
| `GetEQOtherFunc` | `curvecopy` ★ | EQ |
| `GetSetupLock` | `lock` ★ | システム |
| `GetHideSources` | (空リスト可) | ソース |
| `GetSourceRename` | (空リスト可) | ソース |
| `GetNetworkInfo` | `dhcp`, `ssid`, `connection` | システム |
| `GetHdmiSetup` | `audioout` | システム |
| `GetUpdateInfo` | `status` | システム |

★ = 2026-07 実機プローブで解明・拡張。

### その他の読み取りデータソース

10443 ajax API / telnet(23) 照会 / UPnP(60006) / HEOS(1255) の詳細は
[api-notes.md](api-notes.md) の「追加データソース」章を参照。一括収集は
`tools/probe_all.py`。
