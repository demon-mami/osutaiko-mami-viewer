# osu!taiko mami viewer

GitHub Pages向け、モバイル優先のosu!taiko区間確認ビューアです。

## 主な機能
- `.osz / .OSZ` を端末内だけで展開・解析
- osu!taiko難易度選択 + `xxxx hits`
- Web Audio単一クロックによる音源再生とv3.2ヒットサウンド同期
- 現在位置、±5秒、再生/一時停止、シーク
- 拡大可能なOBJECT TIMELINE
- Kiai区間を薄い黄色で表示
- SONG TIMELINEで曲全体のKiai位置、現在位置、START/ENDを表示
- START / ENDは1回タップで追加、もう1回タップで解除
- START-ENDの区間長をミリ秒精度で表示
- 用途 / 難易度 / 区間 / Fade-in/outをまとめてコピー

## 同期設計
旧版ではHTML Audioの`currentTime`を曲・UIの基準にし、Web Audioの`AudioContext.currentTime`でヒットサウンドを予約していました。
本版ではOSZ内音源も`decodeAudioData()`で`AudioBuffer`化し、MusicとHitSoundを同じ`AudioContext.currentTime`上へ予約します。
UIの再生位置は`getOutputTimestamp()`が利用可能な環境では出力側の時刻を優先します。

## v3.2割当
- 小Don → `hitnormal`
- 小Ka → `hitclap`
- 大Don → `hitfinish`
- 大Ka → `hitwhistle`
- Normal / Soft と譜面側Hitsound Volumeを反映

Music自体への固定ゲインは追加していません。
