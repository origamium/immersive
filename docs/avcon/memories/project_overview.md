> avcon原本からの移植資料（歴史的記録）。原本コミット: `dd8dc8a5ea09ed03b7548bc931305ad324875d17`。当時の実機観測・仮説を含み、現在の全環境での保証ではありません。IP/MAC表記は伏せています。現実装との差分は [移植状況](../migration-status.md) を参照してください。

# avcon - DENON AVC-A110 ネットワーク制御プロジェクト

## 概要
DENON AVC-A110 AVアンプをネットワーク経由で制御するPythonプロジェクト。
HTTP API（XMLベース）を使い、電源状態の確認・音量操作・入力切替などを行う。

## 対象デバイス
- **機種**: DENON AVC-A110
- **IP**: `.env` の `D_AVAMP_IP` で指定（デフォルト: <AVR_IP>）
- **MAC**: `.env` の `D_AVAMP_MAC` で指定

## Tech Stack
- **言語**: Python 3.9+（`.python-version` = 3.9）
- **パッケージ管理**: pip + requirements.txt（pyproject.toml も存在するがdependenciesは空）
- **仮想環境**: `.venv/`（system Python 3.9 で作成）
- **ビルドツール**: uv（uv.lock が存在）
- **IDE**: PyCharm（.idea/ ディレクトリ存在）

## 依存ライブラリ
- `requests` — HTTP通信
- `python-dotenv` — .env ファイル読み込み
- `xml.etree.ElementTree` — XMLパース（標準ライブラリ）

## プロジェクト構成
```
avcon/
├── main.py              # メインスクリプト（導通チェック）
├── .env                 # デバイスIP/MAC設定（git管理外）
├── requirements.txt     # pip依存関係
├── pyproject.toml       # プロジェクトメタデータ
├── .python-version      # Python 3.9
├── uv.lock              # uvロックファイル
├── .venv/               # 仮想環境
├── .gitignore           # 標準的なPython/Node/JetBrains用
└── README.md            # （空）
```
