; 要る暖かさ (src/recommend.ts の targetWarmth) の性質。
; 決まり: 証明したい性質の「否定」を assert し、(check-sat) が unsat なら証明できた。

(define-fun target ((t Real)) Int
  (ite (>= t 25.0) 2
  (ite (>= t 20.0) 3
  (ite (>= t 15.0) 5
  (ite (>= t 10.0) 7
  (ite (>= t 5.0) 9 11))))))

; 1. 寒いほど下がらない (a <= b なら target(a) >= target(b))
(push)
(declare-const a Real)
(declare-const b Real)
(assert (<= a b))
(assert (< (target a) (target b)))
(check-sat)
(pop)

; 2. 範囲は 2〜11
(push)
(declare-const t Real)
(assert (not (and (<= 2 (target t)) (<= (target t) 11))))
(check-sat)
(pop)
