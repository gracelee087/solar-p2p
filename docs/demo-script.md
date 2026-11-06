# SolarP2P — demo video script (about 2:45)

Site: https://solar-p2p.onrender.com · Agent password: `keys/DEMO_PASSWORD.txt` (local only)
All numbers below were measured in the app (real June 2026 prices and weather, fictional members).

---

## 0:00–0:20 · The problem
**Screen:** Month page, top of the page.

> Since June 2026, Germany's new energy-sharing law lets neighbours share solar power over the public grid.
> But the law counts energy every fifteen minutes, it only allows sharing inside one grid zone until 2028, and every neighbour pays every other neighbour tiny amounts, all day.
> SolarP2P is the clearing layer a community or its local utility runs to make that work.

## 0:20–0:45 · A real month
**Screen:** Month page. Point at the KPI cards, then click **Law from 2028-06-01**, then back to **Law today**.

> This is all of June 2026, replayed on real German wholesale prices and real sunshine, with a fictional neighbourhood in Mainz and Wiesbaden.
> Under today's rules, 3,013 kilowatt-hours of neighbour sharing were blocked, because the communities sit in different grid zones.
> Switch to the 2028 rules, and exactly that amount gets shared instead.

## 0:45–1:10 · One day, every fifteen minutes
**Screen:** Click day **21** → Day page. Press **▶ Play day**, let it run to about 12:00, pause. Scroll to **Hourly settlement**.

> Here is the 21st of June. Every fifteen minutes the engine matches surplus solar to demand: own roof first, then the own community, then a neighbouring community only where the law allows, then the grid.
> Red dashed lines are flows the law blocks, with the reason.
> That day produced 711 fifteen-minute payments. Netted hour by hour, only 190 transfers had to move.

## 1:10–1:35 · Anyone can verify
**Screen:** In the settlement table click **✓ settled · verify** (13:00) → Verify page. Wait for the five green ticks.

> Each hour is settled on Solana devnet in a test-euro token, and the hour's statement is hashed into a Merkle root in the memo.
> This page runs in your browser: it fetches the transactions from Solana, recomputes the root, and checks that every token movement matches the statement, to the micro-euro.
> Change one line by a millionth of a euro, and the root no longer matches.

## 1:35–2:05 · An AI agent that works for each member
**Screen:** **Member** → Lena. In "Ask your energy agent" type `Never sell my solar under 20 cents.` → Ask. (Enter the demo password when asked.) Then choose **Jonas**, type `Lower my monthly limit to 15 euros.` → Ask → **Approve** → click **on-chain approval**.

> Members just say what they want. Claude turns it into a policy and simulates it on real data first.
> Lena asks for a 20-cent minimum. The agent shows it would cost her money: local prices that day never reach 20 cents, so she would sell nothing to neighbours. Nothing changes unless she approves.
> Jonas lowers his monthly limit. When he approves, the new limit is set on-chain, so the chain itself caps what can be pulled from his wallet.

## 2:05–2:30 · Planning tomorrow
**Screen:** **Live** → **Tomorrow**. Turn **Flex agent: on**. Point at "load moved by the flex agent".

> Tomorrow's wholesale prices are already published. With the live solar forecast, a second agent plans ahead: it moves flexible load at the school, the sports hall and the supermarket into the hours with spare neighbour solar.
> Backtested on all of June, it cut their energy costs by 2.1 percent under today's rules, and 3 percent under the 2028 rules. That is after grid fees, which shared energy still pays.

## 2:30–2:45 · Close
**Screen:** Back to Month, top.

> AI does the forecasting, planning and negotiating. Solana does the payments, the limits and the public proof.
> SolarP2P: neighbourhood solar sharing, built for Germany's new law.

---

### Recording notes (한국어)
- 녹화 **5분 전에 사이트를 한 번 열어** 두세요. 데이터를 미리 불러와 둬야 화면이 빨리 뜹니다.
- 브라우저 확대는 **90%** 가 보기 좋습니다. 창 크기는 1280×800 이상을 권합니다.
- 에이전트 답변은 매번 문장이 조금씩 다릅니다. 내레이션은 화면을 읽는 게 아니라 위 문장을 그대로 하시면 됩니다.
- Verify 화면의 초록 체크는 devnet 응답을 기다리느라 몇 초 걸립니다. 기다렸다가 말하세요.
- "Live → Tomorrow" 숫자는 날짜마다 달라집니다. 그래서 대본에는 6월 백테스트 숫자만 넣었습니다.
- 녹화 도구: Windows는 **Win + Alt + R**(Xbox Game Bar) 또는 OBS. 목소리는 따로 녹음해서 나중에 입혀도 됩니다.
