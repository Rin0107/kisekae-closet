-- 守りの部分 (wakuwaku guard で書き換え禁止)。持ち主が 2026-11-21 に決めた (docs/spec-v2-fitting.md §8)。
-- 足すのは数だけの JSON (写真の中の位置の割合・cm・倍率・角度)。個人と結びつく情報は増えない。
-- clothes.fit: 服そのものの印 (どこが肩・袖口・ウエスト・裾か)。服の情報なので服に持つ
-- outfit_items.adj: そのコーデの中で、その服を指で直した量 (ずらす・大きさ・傾き)。コーデごと
-- outfits.pose: そのコーデのマネキンを指で直した量 (大きさ・傾き・ずらす・腕と脚の角度)。コーデごと
-- どれも null なら「まだない (自動のまま)」。

ALTER TABLE clothes ADD COLUMN fit TEXT;
ALTER TABLE outfit_items ADD COLUMN adj TEXT;
ALTER TABLE outfits ADD COLUMN pose TEXT;
