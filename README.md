# osu!taiko mami viewer

GitHub Pages向けのモバイル優先・静的OSZ確認ビューアです。

## 主な機能
- `.osz / .OSZ` をブラウザ内だけで展開・解析
- osu!taiko難易度を選択し、各難易度の `xxxx hits` を表示
- OSZ内音源の再生 / 一時停止 / シーク / ±5秒移動
- 現在位置 `MM:SS:mmm` 表示・コピー
- 現在位置をSTART / ENDとして記録
- 現在位置±3秒のヒットポイントを細横長タイムラインで表示
- Kiai区間を薄い黄色で表示
- 全体ビューはKiai位置を中心に表示
- 同梱v3.2ヒットサウンドを譜面時刻へ常時自動同期
- TimingPoint / HitSampleのHitsound VolumeとNormal / Soft sample setを反映
- 用途 `Stream / Normal / 1/6 / DoubleBPM` を選択
- Fade-in/out `含む / 含まない` を選択
- TitleUnicode優先（なければTitle）、用途、難易度、START-ENDをまとめてコピー

## コピー形式

```text
**曲名：Perfect Neglect**
用途：Stream
難易度：**Dilapidation**
区間：00:00:00～00:00:40（Fade-in/out：含まない）
```

## GitHub Pages
リポジトリ直下を `main / (root)` から公開します。ビルド処理は不要です。
