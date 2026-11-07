# SolarP2P — demo video script (2:14)

Site: https://solar-p2p.onrender.com
All numbers below were measured in the app: real June 2026 prices and weather, fictional members.
Every scene is a recording of the real app; a yellow box marks what the narration is talking about.

---

## 0:00 · The problem
**Screen:** Day page, 21 June, playing. Box on "711 → 190 payments → transfers".

> Since June 2026, Germany lets neighbours share solar power over the public grid. But the law meters every fifteen minutes. In our test neighbourhood, one sunny day meant 711 tiny payments.

## 0:14 · One-line pitch
**Screen:** Story page headline.

> SolarP2P is the clearing layer for neighbourhood solar: matched every fifteen minutes, settled hourly on Solana, and checkable by anyone.

## 0:24 · One day, every fifteen minutes
**Screen:** Day replay up to 12:00, then the red dashed blocked flow and its reason, then the netting KPI.

> Every fifteen minutes, surplus solar goes to the own community first, then to a neighbouring one where the law allows. Red dashed lines are flows the law still blocks, with the reason underneath. Netted hour by hour, 711 payments become 190 transfers.

## 0:42 · Today's law vs 2028
**Screen:** Month page. Box on "blocked by the grid-zone rule", then click **Law from 2028-06-01**.

> Across June, today's rules blocked 3,013 kilowatt-hours. Switch to the 2028 rules, and sharing between neighbours rises from 2,200 to 5,213.

## 0:55 · Why Solana
**Screen:** Story page, "Why a blockchain" and "Why Solana".

> So why Solana? Without a shared ledger, members must trust one operator's database. Solana makes the payment the proof, lets the chain enforce each member's limit, and settled one hour for 25,000 lamports, using only SPL Token and Memo.

## 1:12 · Anyone can verify
**Screen:** Verify 2026-06-21 13:00. The five checks turn green; one box per check.

> Here is the proof. This page runs in your browser. It recomputes the Merkle root, finds the transactions on Solana devnet, checks that each memo carries that root, and matches every token movement to the statement, to the micro-euro. And if a single line changes by one micro-euro, the root no longer matches.

## 1:32 · On Solana's own explorer
**Screen:** Solana Explorer (devnet), the settlement transaction. Box on the memo log line `root=…`.

> And this is the same transaction on Solana's own explorer. The root is right there in the memo, public for anyone.

## 1:39 · An AI agent that works for each member
**Screen:** Member → Lena. Type `Never sell my solar under 20 cents.` → Ask → Claude's answer.

> Members just say what they want. Lena asks never to sell under 20 cents. Claude simulates it on real data first, shows that she would end up 45 cents worse off, and changes nothing unless she approves.

## 1:52 · A limit the chain enforces
**Screen:** Member → Jonas. Type `Lower my monthly limit to 15 euros.` → Ask → **Approve** → "applied · on-chain approval" → the limit card reads €15 from the chain.

> Jonas asks to lower his monthly limit to 15 euros. He presses Approve, and the limit is set on-chain, as a token approval the operator cannot exceed.

## 2:02 · Close
**Screen:** Story results table, then the headline.

> AI does the planning and negotiating. Solana does the payments, the limits and the public proof. SolarP2P: neighbourhood solar sharing, built for Germany's new law.

---

Notes
- Claude's wording changes between runs. Lena's result on 21 June was €2.29 → €1.84 both times we recorded it.
- The Verify checks wait for devnet responses, so they can take a few seconds.
