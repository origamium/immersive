> avcon原本からの移植資料（歴史的記録）。原本コミット: `dd8dc8a5ea09ed03b7548bc931305ad324875d17`。当時の実機観測・仮説を含み、現在の全環境での保証ではありません。IP/MAC表記は伏せています。現実装との差分は [移植状況](migration-status.md) を参照してください。

# DENON AVC-A110 HTTP API 呼び出しガイド

> 対象機種: AVC-A110 (CommApiVers 0301)
> テスト日: 2026-02-14

---

## 接続情報

| 項目 | 値 |
|------|-----|
| API ポート | **8080** (HTTP) |
| Web コントロール UI | 10443 (HTTPS, 自己署名証明書) |
| HEOS TCP | 1255 |
| HEOS HTTP | 60006 |
| CommApiVers | **0301** |

> **注意**: ポート 80 は HTTPS へリダイレクトされるため HTTP では使用不可。

---

## POST エンドポイントの使い分け

AVC-A110 では **2 種類の POST エンドポイント** があり、コマンドの種類によって使い分ける。

### `POST /goform/AppCommand.xml` — 基本コマンド

パラメータ不要の単純なコマンドに使用する。

```
POST /goform/AppCommand.xml HTTP/1.1
Content-Type: text/xml; charset=utf-8
```

```xml
<?xml version="1.0" encoding="utf-8" ?>
<tx>
<cmd id="1">コマンド名</cmd>
</tx>
```

### `POST /goform/AppCommand0300.xml` — 拡張コマンド

パラメータ付きの詳細情報取得コマンドに使用する（CommApiVers 0300 以降）。

```
POST /goform/AppCommand0300.xml HTTP/1.1
Content-Type: text/xml; charset=utf-8
```

```xml
<?xml version="1.0" encoding="utf-8" ?>
<tx>
<cmd id="3">
<name>コマンド名</name>
<list>
<param name="パラメータ名" />
</list>
</cmd>
</tx>
```

---

## 重要な制約・注意事項

### 1. 改行付き XML が必須

リクエスト XML は**改行付き**で送信すること。1 行にまとめると空の `<rx/>` が返る。

```bash
# NG — 空応答になる
curl -s -X POST "http://<IP>:8080/goform/AppCommand.xml" \
  -d '<?xml version="1.0" encoding="utf-8" ?><tx><cmd id="1">GetAllZonePowerStatus</cmd></tx>'

# OK — 改行付き
curl -s -X POST "http://<IP>:8080/goform/AppCommand.xml" \
  -H "Content-Type: text/xml; charset=utf-8" \
  -d '<?xml version="1.0" encoding="utf-8" ?>
<tx>
<cmd id="1">GetAllZonePowerStatus</cmd>
</tx>'
```

### 2. エンドポイントとリクエスト形式の一致

- `AppCommand.xml` にパラメータ形式（`<name>` + `<list>`）を送ると `<error>3</error>` が返る
- `AppCommand0300.xml` にテキスト直接形式（`<cmd id="1">Name</cmd>`）を送ると `<error>2</error>` が返る

### 3. Content-Type

`text/xml; charset=utf-8` を指定する。

### 4. 1 リクエスト最大 5 cmd

`AppCommand.xml` は 1 リクエストに 5 個以上の `<cmd>` を含むとエラーになる。

### 5. タイムアウト

5 秒程度が適切。

### 6. 固定長パディング

多くの文字列値は末尾にスペースが付加される。`strip()` で除去すること。

```xml
<!-- surround 値は 64 文字にパディングされている -->
<surround>Dolby Atmos                                                    </surround>
```

### 7. 0300 の空リスト

一部コマンド（`GetHideSources`, `GetSourceRename`）は空 `<list />` でもデータを返す。

### 8. コマンド重複

いくつかのコマンドは両エンドポイントで利用可能だが、返却形式が異なる:

| AppCommand.xml | AppCommand0300.xml | 備考 |
|---------------|-------------------|------|
| `GetRenameSource` | `GetSourceRename` | 同等情報、異なる XML 構造 |
| `GetDeletedSource` | `GetDeleteSource` | 0300 版は CMD ERR を返す |

---

## レスポンスの `control` 属性 (0300 形式)

AppCommand0300.xml のレスポンスに含まれる `control` 属性の意味:

| 値 | 意味 |
|----|------|
| `0` | 読み取り不可 / 現在のモードでは無効 |
| `1` | 読み取り可能 / ユーザー変更可能 |
| `2` | 読み取り可能 / システム管理 |

---

## エラーレスポンス

### AppCommand.xml / AppCommand0300.xml 共通

```xml
<rx><error>N</error></rx>
```

| コード | 意味 |
|--------|------|
| `2` | コマンドにはパラメータが必要（`AppCommand0300.xml` を使用すべき） |
| `3` | 無効なコマンド形式（エンドポイントとリクエスト形式の不一致） |

### 0300 コマンド内エラー

```xml
<list>
<CMD ERR>
</list>
```

コマンド自体は認識されるが、指定されたパラメータが無効。

---

## 使用不可エンドポイント (403 Forbidden)

AVC-A110 (CommApiVers 0301) で 403 を返すエンドポイント:

- `GET /goform/formMainZone_MainZoneXmlStatus.xml`（Lite 版を使用すること）
- `GET /goform/formMainZone_MainZoneXml.xml`
- `GET /goform/formNetAudio_StatusXml.xml`
- `GET /goform/formTuner_TunerXml.xml`
- `GET /goform/formBluetooth_BluetoothXml.xml`
- `GET /goform/formDSP_DSPInfoXml.xml`
- `GET /goform/formNetAudio_StatusXmlInfo.xml`
- `GET /goform/formMoviePlayer_MoviePlayerXml.xml`
- `POST /goform/AppCommand0301.xml`

---

## 追加データソース（2026-07 実機調査で確認）

ポート 8080 以外にも以下の読み取り経路がある。すべて実機 AVC-A110 で動作確認済み。

### ポート一覧

| ポート | プロトコル | 内容 |
|--------|-----------|------|
| 23 | telnet | 公式制御プロトコル（公式アプリ経路）。`?` 照会でステータス取得 |
| 1255 | HEOS CLI (TCP/JSON) | `heos://player/get_*` 等の読み取りコマンド |
| 1256 | 独自バイナリ | Audyssey MultEQ Editor 用（未解析） |
| 8080 | HTTP | 本書メインの XML API |
| 10443 | HTTPS (自己署名) | セットアップ Web UI + ajax get_config API |
| 60006 | HTTP (UPnP) | ディスクリプタ群（シリアル番号・サービス一覧） |

### 10443 ajax API — `GET /ajax/<section>/get_config?type=N`

セットアップ Web UI が使う読み取り API。**AppCommand では取れない設定領域**
（スピーカー距離・クロスオーバー・アンプアサイン・入力端子アサイン・
ネットワーク詳細・ファームウェア情報等）を XML で返す。

- section: `globals` / `home` / `audio` / `video` / `inputs` / `speakers` / `network` / `general`
- type 番号は Web UI の JS（`*ServerInterface.js` の `CONFIG_*` 定数）から抽出
- 検証済み type 一覧はコード `avcon/setupapi.py` の `WORKING_TYPES` が正
- **注意（ハング）**: `speakers` type 15-19（SpeakerLayout 等）と `network` type 3、
  `general` type 19-21、`account` 系は応答せずサーバーを数十秒ハングさせる。
  ハング後は他 type も巻き添えでタイムアウトするため、45 秒程度の冷却が必要
- リクエスト間隔 0.4 秒程度を空けること（連続で叩くと web サーバーが息切れする）
- 4xx/5xx を返す type は現在状態で無効なだけの場合がある（例: `network/Connection` は
  接続方式によって 400）

### telnet (23) — 照会コマンド

公式「DENON AVR control protocol」準拠。**同時 1 接続制限**あり（公式アプリ
接続中は接続拒否される）。改行は CR。

- 実機で応答確認済みの照会 74 種は `avcon/telnet.py` の `DEFAULT_QUERIES` が正
- 代表例: `PW?` `MV?`（MVMAX 含む）`CV?`（17ch レベル）`SSSPC ?`（18 スピーカー構成）
  `SSINFFRM ?`（**ファームウェアバージョン** — 0300 の GetFirmware 不通の代替）
  `SSINFSIGRES ?`（入出力解像度）`SSQSNZMA ?`（クイックセレクト名）
- **応答はイベントストリームと混線する**ため、行の帰属は順序でなく
  プレフィックス（`MV` → `MV435` / `MVMAX 70`）で判定すること
- 無応答照会は状態依存（例: `PSMDAX ?` はロッシー音源時のみ、`PSVSS ?` は
  対応サウンドモード時のみ）

### UPnP (60006)

- ルートディスクリプタ: `GET /upnp/desc/aios_device/aios_device.xml`
- シリアル番号・UDN・`X_AudysseyPort`(1256)・`X_WebAPIPort`(8080) 等を含む
- サービス 10 種（AVTransport / RenderingControl / denon 独自 ZoneControl,
  GroupControl, ErrorHandler, ACT 等）。各 SCPD XML も取得可能

### HEOS CLI (1255)

TCP 接続し `heos://player/get_players` 等を CRLF 送信、JSON 1 行応答。
読み取りに使えるもの: `system/heart_beat`, `player/get_players`,
`player/get_play_state`, `player/get_now_playing_media`, `player/get_volume`,
`player/get_mute`, `player/get_play_mode`（いずれも `?pid=` 必須）。

### 一括収集

上記全ソースの読み取りスナップショットは以下で取得できる:

```bash
uv run python tools/probe_all.py            # samples/probe_<timestamp>/ に出力
curl localhost:8000/api/snapshot            # サーバー API（数十秒かかる）
curl localhost:8000/api/capabilities        # Deviceinfo.xml 機能カタログ
```
