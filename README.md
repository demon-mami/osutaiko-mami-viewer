# osu!taiko mami viewer

GitHub Pages向け、モバイル優先のosu!taiko区間確認ビューアです。

## 主な機能
- `.osz / .OSZ` を端末内だけで展開・解析
- **Mode:1 (osu!taiko) のみ対応**。Mode:1が無いOSZは読み込み停止
- osu!taiko難易度選択 + `xxxx hits`
- OBJECT TIMELINE: ±0.75 / ±0.5 / ±0.25
- SONG TIMELINE: Kiai / BPM変化 / 時間目盛り / 現在位置 / START / END
- START / ENDは1回タップで追加、もう1回タップで解除
- START-ENDの区間長をミリ秒精度で表示
- 用途 / 難易度 / 区間 / Fade-in/outをまとめてコピー

## Audio同期設計
MusicとHitsoundは、再生中のJavaScriptタイマーで同期させません。

1. OSZ内Musicを`decodeAudioData()`で`AudioBuffer`化
2. HitObject時刻(ms)を`Math.round(time / 1000 * sampleRate)`でPCM frameへ変換
3. 全Hitsoundを事前に完成Effect AudioBufferへ配置
4. Music / Effectを同じ`AudioContext`、同じ`when`、同じ`offset`で`AudioBufferSourceNode.start()`
5. Pause / Seek / ±5秒ではMusic / Effectの2 sourceを破棄して同じoffsetから再生成

このAudio Engine設計はVisual Timelineの描画処理から分離しています。

## Visual clock
Native `AudioContext.prototype.getOutputTimestamp`は変更しません。

Viewer専用のvisual clockでは、native `getOutputTimestamp()`が返す`contextTime` / `performanceTime`のペアを保持し、`performance.now()`との差分でoutput sample frameのContext時刻を補間します。Native timestampを利用できない場合のみ`outputLatency`をfallbackとして使用します。

再生中のOBJECT TIMELINEにはCSS easing/transitionを掛けず、毎frameのaudible positionを直接描画座標へ反映します。Canvasの`getImageData()`によるcursor位置逆算は使用しません。描画用`requestAnimationFrame`はViewer本体の1本です。

## Hitsound仕様
- 小Don → `hitnormal`
- 小Ka → `hitclap`
- 大Don → `hitfinish`
- 大Ka → `hitwhistle`
- Normal / Softと譜面側Hitsound Volumeを反映
- 完成Effect busのViewer固定Gain = **0.80**
- Music Gain = **1.00**

### SampleSet=Drum
現在同梱しているv3.2 hitsound素材はNormal / Softのみです。そのためSampleSet=Drumは**意図的にNormalへフォールバック**します。osu!stableのDrum sampleset完全再現は現仕様の対象外です。

## Debug
URL末尾へ`?debug=1`を付けた時だけAudio Debugを表示します。

表示項目:
- sampleRate
- AudioContext.currentTime
- native contextTime
- native performanceTime
- baseLatency
- outputLatency
- enginePosition
- audiblePosition
- engine - audible差
- transportStartCtx
- transportOffset

例: `https://demon-mami.github.io/osutaiko-mami-viewer/?debug=1`

## 自動同期テスト
`tests/sync-tests.html`で以下を機械検査します。

- 1000ms → `round(1.000 * sampleRate)`
- 1125ms → `round(1.125 * sampleRate)`
- 2500ms → `round(2.500 * sampleRate)`
- 1sample impulseが上記frameへ正確に配置されること
- Music / Effectへ同一`start(when, 10.000)`が渡ること

Music自体への固定ゲインやタイミング補正値は追加していません。
