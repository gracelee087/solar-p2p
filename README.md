# ☀ SolarP2P

**Neighbourhood solar sharing for Germany's new energy-sharing law: 15-minute matching, hourly settlement on Solana, and an AI agent that works for each member.**

Since **1 June 2026**, § 42c EnWG lets households, public bodies and small businesses share solar power with neighbours over the public grid, within one distribution grid zone (adjacent zones follow on **1 June 2028**). The law requires quarter-hour metering. That creates hundreds of tiny payments per neighbourhood per day, and rules about who may share with whom.

SolarP2P is the clearing layer a community or its local utility (Stadtwerk) would run:

| Part | What it does |
|---|---|
| **Matching engine** | Every 15 minutes: own roof → own community → neighbouring community (only where § 42c allows) → grid |
| **§ 42c rule engine** | Blocks sharing the law does not allow yet and shows why (e.g. across grid zones before 2028-06-01, large enterprises) |
| **Solana settlement** | Nets each hour's 15-minute payments and moves only the net amounts in a test-EUR SPL token; members' SPL delegate limits cap what can be pulled |
| **Public verification** | Each hour's statement is hashed into a Merkle root in a Solana memo. Anyone can check the whole hour; each member can check their own line without seeing anyone else's |
| **AI (code)** | Flexible-load agent moves shiftable load (ventilation, pumps, pre-cooling) into hours with spare neighbour solar and low prices |
| **AI (Claude)** | Members ask in plain words ("never sell under 20 cents", "lower my limit to €15"); Claude turns it into a policy, simulates it on real data, and nothing changes until the member presses Approve |

> **Simulation, labelled as such.** Prices and weather are real; the neighbourhood is not. 3 fictional communities and 15 fictional members in Mainz and Wiesbaden, with synthetic load profiles. Payments run on Solana **devnet** with a test token. Tariffs are assumptions (see below).

## Real data

- **Wholesale price:** day-ahead DE-LU, quarter-hourly, from [SMARD.de](https://www.smard.de) (Bundesnetzagentur), series 4169. All of June 2026 (30 days, 96 slots each).
- **Sunshine:** quarter-hourly global horizontal irradiance from the [Open-Meteo](https://open-meteo.com) historical forecast API, Mainz.
- June 2026 had **199 quarter-hours with negative wholesale prices on 10 days**.

## Measured results (June 2026, real prices and weather, fictional members)

| | Today's rules | Rules from 2028-06-01 |
|---|---|---|
| Energy shared between neighbours | 2,200 kWh | 5,213 kWh |
| … of which between communities | 23 kWh | 3,036 kWh |
| Blocked by the grid-zone rule | **3,013 kWh** | 0 |
| Bought from the grid | 9,626 kWh | 6,613 kWh |
| Paid to local producers (energy part) | €276.88 | €655.19 |
| 15-minute payments → on-chain transfers after netting | 23,234 → 6,072 | 36,032 → 6,932 |

**Flexible-load agent, backtested on all 30 days** (school, sports hall, supermarket may move 30% of their load within 06:00–22:00):

| | Today's rules | From 2028 |
|---|---|---|
| Cost vs no shifting | −€32.29 (−2.1%) | −€44.49 (−3.0%) |
| Cost vs a simple fixed rule (run 11:00–15:00) | −€9.99 | −€15.06 |

The agent uses the day-ahead price and the solar forecast, and only counts spare solar the member may legally receive. In this simulation the same irradiance series is used as forecast and actual, so these figures are an upper bound for the effect.

**On Solana devnet:** 2 hours of 2026-06-21 settled and verified, ledger equal to chain to the micro-euro. A spending-limit change approved through the Claude agent was applied on-chain (`approveChecked`). Links are on the Verify page.

## Assumptions and limitations

- **Tariffs (assumed):** grid supply 35 ct/kWh all-in; feed-in 7 ct/kWh. Shared energy **still pays the usual grid fees and levies** ([Bundesnetzagentur, Energy Sharing](https://www.bundesnetzagentur.de/DE/Vportal/Energie/Energy_Sharing/start.html)); we assume 20 ct/kWh for grid fees, levies and taxes. So the local energy price is between 7 and 13 ct/kWh, and only that part is settled on-chain.
- Electricity tax may be exempt for plants up to 2 MW supplying consumers "in spatial connection" ([§ 9 StromStG](https://www.gesetze-im-internet.de/stromstg/__9.html)), with a permit. Not modelled.
- The § 42c rules are our reading of the law for a demo, not legal advice.
- Load profiles are synthetic; PV output is a simple model (kWp × irradiance × 0.8).
- Member wallets are demo keys held by the server. In production, members would hold their own wallets.
- **Known issue:** on 2026-11-06 the two demo hours were accidentally settled a second time on devnet (identical amounts). It is recorded openly in the hour records and on the Verify page. The settlement script now refuses any hour whose Merkle root is already on-chain.

## How it works

```
real prices + sunshine ─► 15-min matching (+ § 42c rules) ─► hourly statement lines
                                                              │
                         Merkle root ─► Solana memo           ├─► netting ─► test-EUR transfers
                                                              │   (members → pool → pools → sellers)
                         member proof ◄───────────────────────┘
```

- Amounts are integers in micro-EUR (the token has 6 decimals). Prices are kept in 0.1 ct/kWh steps, so every amount is exact and the ledger can match the chain exactly.
- Transfer order keeps every pool balance at or above zero.
- Members pay through their SPL delegate approval, so the chain enforces each member's limit.

## Run it

Requires Node 22.

```bash
npm install
npm test                 # 9 tests: energy balance, pool balance, § 42c, netting, Merkle, transfer order, blocked energy, agent limits
npm run build            # precompute site/data from data/
npm run serve            # http://localhost:5173  (Claude agent needs ANTHROPIC_API_KEY in .env)
```

Optional:

```bash
node scripts/fetch-day.js 2026-06-21               # fetch a real day
node scripts/flex-backtest.js [2028]               # agent backtest
node scripts/devnet-setup.js                       # devnet keys, test-EUR mint, delegate limits (fund the printed operator address via faucet.solana.com)
node scripts/settle-onchain.js 2026-06-21 12       # settle one hour on devnet
node scripts/verify-hour.js 2026-06-21 12          # check ledger == chain from the chain alone
```

## Repository

| Path | |
|---|---|
| `src/match.js` | 15-minute matching |
| `src/rules42c.js` | § 42c rules |
| `src/settle.js` | hourly settlement and netting |
| `src/merkle.js`, `site/merkle.js` | Merkle tree (Node and browser) |
| `src/flex-agent.js` | flexible-load agent |
| `src/claude-agent.js`, `src/policy.js` | Claude policy agent (dry-run tools) |
| `scripts/` | data fetch, devnet setup, settlement, verification, server |
| `site/` | web app (Month, Day, Member, Verify) |
| `data/` | real price and irradiance days, settled-hour records |
