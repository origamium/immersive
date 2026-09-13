> avcon原本からの移植資料（歴史的記録）。原本コミット: `dd8dc8a5ea09ed03b7548bc931305ad324875d17`。当時の実機観測・仮説を含み、現在の全環境での保証ではありません。IP/MAC表記は伏せています。現実装との差分は [移植状況](../migration-status.md) を参照してください。

# タスク完了時のチェックリスト

## 必須
1. コードが正常に実行できることを確認（`python main.py`）
2. `.env` の秘密情報がコミットに含まれていないことを確認
3. `from __future__ import annotations` が先頭にあることを確認（Python 3.9互換性）

## 推奨
- 新しい依存関係を追加した場合、`requirements.txt` を更新
- API の新しい知見が得られた場合、`denon_api_reference.md` メモリを更新
