# osu!taiko mami viewer — mobile test

GitHub Pages向けの静的OSZ確認ビューアです。推奨リポジトリ名: `osutaiko-mami-viewer`。

## 機能
- `.osz` をブラウザ内だけで展開・解析
- osu!taiko難易度を選択
- OSZ内音源の再生 / 一時停止 / シーク
- 現在位置 `MM:SS:mmm` 表示・コピー
- Don / Ka / 大Don / 大Ka のヒットポイント表示
- Kiai区間表示
- START / END の区間チェック（現在位置または最寄りHit）
- 選択区間の長さ・区間内Hit数を自動表示
- `開始～終了` の簡易コピー / 詳細コピー
- START / END位置をタイムラインと全体ビューへ常時表示
- 同梱 `perfect-v3.2` ヒットサウンドを自動同期再生（初期ON）
- TimingPoint / HitSample のHitsound Volumeを反映
- Normal / Soft sample setを反映（Drum/不明はNormalへフォールバック）

## v3.2の割当
前回作成した確認WAVと同じ1打=1ファイル方式です。

- 小Don → `hitnormal`
- 小Ka → `hitclap`
- 大Don → `hitfinish`
- 大Ka → `hitwhistle`

Music自体には固定ゲインを追加していません。HitSoundには譜面側のHitsound Volumeのみを掛けます。

## GitHub Pages
このフォルダの中身をリポジトリ直下へ置き、Pagesの公開元を `main` / `/ (root)` にします。ビルド不要です。

## 注意
Web Audio APIを使うため、スマートフォンでは最初の再生操作がユーザー操作として必要です。直接 `file://` で開くのではなく、GitHub PagesなどHTTP(S)経由で使用してください。

## 区間チェックの使い方
1. 曲を再生・シークして開始候補へ移動
2. STARTの「現在位置」または「最寄りHit」を押す
3. 終了候補へ移動し、ENDを同様に登録
4. 区間長・区間内Hit数を確認
5. 「区間をコピー」で `00:35:680～01:15:042` 形式をコピー

「最寄りHit」は現在位置に最も近い実ヒットポイントの時刻へ正確に合わせます。任意の非Hit位置を使いたい場合は「現在位置」を使います。難易度またはOSZを切り替えると選択はリセットされます。
