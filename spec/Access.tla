---- MODULE Access ----
\* 誰のデータに届くか (src/worker/db.ts・session.ts) の仕様。
\* - 服を読む・消すのは、生きているセッションの持ち主だけ (db.ts は全部 WHERE user_id = ? で絞る)
\* - セッションは期限 (expires_at) の前だけ生きている (session.ts・db.ts の findLogin)
\* Access.cfg の INVARIANT ごとに、実装を検査するテスト "Spec_<名前>: …" がある (tests/unit/db.test.ts・worker.test.ts)。
EXTENDS Naturals

CONSTANTS Users, Items, MaxTime, None

VARIABLES owner, sessions, now, reads, last

vars == <<owner, sessions, now, reads, last>>

Init == /\ owner = [i \in Items |-> None]
        /\ sessions = {}
        /\ now = 0
        /\ reads = {}
        /\ last = None

\* u のセッションが今 生きている (期限の前)
Live(u) == \E s \in sessions : s[1] = u /\ now < s[2]

Tick == /\ now < MaxTime
        /\ now' = now + 1
        /\ UNCHANGED <<owner, sessions, reads, last>>

Login(u) == /\ now + 1 <= MaxTime
            /\ sessions' = sessions \cup {<<u, now + 1>>}
            /\ UNCHANGED <<owner, now, reads, last>>

Add(u, i) == /\ Live(u)
             /\ owner[i] = None
             /\ owner' = [owner EXCEPT ![i] = u]
             /\ last' = <<u, i, now>>
             /\ UNCHANGED <<sessions, now, reads>>

\* 読めるのは持ち主のものだけ
Read(u, i) == /\ Live(u)
              /\ owner[i] = u
              /\ reads' = reads \cup {<<u, i>>}
              /\ last' = <<u, i, now>>
              /\ UNCHANGED <<owner, sessions, now>>

Delete(u, i) == /\ Live(u)
                /\ owner[i] = u
                /\ owner' = [owner EXCEPT ![i] = None]
                /\ reads' = {r \in reads : r[2] # i}
                /\ last' = <<u, i, now>>
                /\ UNCHANGED <<sessions, now>>

\* 時間の終わり (行き詰まりではない)
Done == /\ now = MaxTime
        /\ UNCHANGED vars

Next == \/ Tick
        \/ Done
        \/ \E u \in Users : Login(u)
        \/ \E u \in Users, i \in Items : Add(u, i) \/ Read(u, i) \/ Delete(u, i)

Spec == Init /\ [][Next]_vars

\* 読んだものは、全部 読んだ人のもの
OwnerOnly == \A r \in reads : owner[r[2]] = r[1]

\* 最後に触れたのは、その時に生きていたセッションから
NoExpiredAccess == last = None \/ \E s \in sessions : s[1] = last[1] /\ last[3] < s[2]
====
