// Claude turns a member's plain-language request into a concrete, simulated policy proposal.
// Claude can only PROPOSE: every tool here is a dry run on the real-data engine. Nothing is applied
// until a human presses "approve" (server.js), and spending limits are then enforced on-chain.
import Anthropic from '@anthropic-ai/sdk';
import { runWithPolicies, memberEconomics } from './policy.js';
import { FLEX } from './flex-agent.js';

const MODEL = 'claude-opus-5-5';
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const strictObject = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const TOOLS = [
  {
    name: 'simulate_sell_floor',
    description: 'Dry-run: the member only sells to neighbours when the local price is at least min_price_ct (cent per kWh). Returns the measured effect on the selected day. Does not apply anything.',
    input_schema: strictObject({ member_id: { type: 'string' }, min_price_ct: { type: 'number' } }),
  },
  {
    name: 'simulate_flex_window',
    description: 'Dry-run: the flexible part of the member\'s load (ventilation, pumps, pre-cooling) may only run between start_hour and end_hour local time (0-24). Only for members with flexible load. Returns the measured effect. Does not apply anything.',
    input_schema: strictObject({ member_id: { type: 'string' }, start_hour: { type: 'integer' }, end_hour: { type: 'integer' } }),
  },
  {
    name: 'propose_spending_limit',
    description: 'Propose a new monthly spending limit in EUR that the operator may pull from the member\'s wallet. Applying it needs the member\'s approval and an on-chain transaction. Does not apply anything.',
    input_schema: strictObject({ member_id: { type: 'string' }, limit_eur: { type: 'number' } }),
  },
].map((t) => ({ ...t, strict: true }));

const eur = (m) => Math.round(m) / 1e6;
function effect(ctx, id, policies) {
  const before = memberEconomics(runWithPolicies(ctx.day, ctx.world, ctx.rulesOpts, ctx.policies), id);
  const after = memberEconomics(runWithPolicies(ctx.day, ctx.world, ctx.rulesOpts, policies), id);
  const view = (r) => ({ sold_kwh: r.soldWh / 1000, bought_kwh: r.boughtWh / 1000, grid_import_kwh: r.importWh / 1000, grid_export_kwh: r.exportWh / 1000, net_eur_for_the_day: eur(r.totalNetMicro) });
  return { day: ctx.day.day, before: view(before), after: view(after), change_eur: eur(after.totalNetMicro - before.totalNetMicro) };
}

function runTool(name, input, ctx) {
  const m = ctx.world.members.find((x) => x.id === input.member_id);
  if (!m) return { error: `unknown member_id ${input.member_id}` };
  if (m.id !== ctx.memberId) return { error: 'you may only act for the member you are talking to' };
  const p = structuredClone(ctx.policies);
  if (name === 'simulate_sell_floor') {
    if (!(input.min_price_ct >= 0 && input.min_price_ct <= 100)) return { error: 'min_price_ct must be 0-100' };
    if (!m.pvKwp) return { error: 'this member has no solar to sell' };
    (p.sellFloorCt ??= {})[m.id] = input.min_price_ct;
    return { proposal: { type: 'sell_floor', member_id: m.id, min_price_ct: input.min_price_ct }, effect: effect(ctx, m.id, p) };
  }
  if (name === 'simulate_flex_window') {
    if (!FLEX[m.id]) return { error: 'this member has no flexible load' };
    const { start_hour: a, end_hour: b } = input;
    if (!(Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b <= 24 && b - a >= 4)) return { error: 'window must be whole hours within 0-24 and at least 4 hours long' };
    (p.flexWindow ??= {})[m.id] = [a, b];
    return { proposal: { type: 'flex_window', member_id: m.id, start_hour: a, end_hour: b }, effect: effect(ctx, m.id, p) };
  }
  if (name === 'propose_spending_limit') {
    if (!(input.limit_eur >= 0 && input.limit_eur <= 200)) return { error: 'limit_eur must be 0-200 (demo cap)' };
    return { proposal: { type: 'spending_limit', member_id: m.id, limit_eur: input.limit_eur }, note: 'needs the member\'s on-chain approval' };
  }
  return { error: `unknown tool ${name}` };
}

/**
 * @param ctx { world, day, rulesOpts, policies, memberId }
 * @returns { reply, proposals: [{ proposal, effect }], toolCalls }
 */
export async function askAgent(ctx, userText) {
  const m = ctx.world.members.find((x) => x.id === ctx.memberId);
  const system = [
    'You are the SolarP2P energy assistant of a neighbourhood energy-sharing community in Germany (simulation on real June 2026 prices and weather; payments in a test-EUR token on Solana devnet).',
    `You act only for this member: ${JSON.stringify({ id: m.id, name: m.name, kind: m.kind, pv_kwp: m.pvKwp, daily_load_kwh: m.loadKwh, has_flexible_load: Boolean(FLEX[m.id]), current_policies: ctx.policies })}.`,
    `Selected day: ${ctx.day.day}. Rules: ${ctx.rulesOpts.ruleDateMs ? 'from 2028-06-01 (adjacent grid zone allowed)' : 'as today (one grid zone)'}. Grid tariffs are simulation assumptions.`,
    'Turn the member\'s request into a proposal by calling exactly one of your tools; if the request does not fit any tool, say so plainly instead of guessing.',
    'You cannot apply anything. After the tool result, explain in 2-4 short sentences what would change, using only numbers from the tool result, and say that the member must press Approve. Reply in the language the member wrote in. Write plain sentences without Markdown (no **, no bullet lists, no headings).',
  ].join('\n');
  const messages = [{ role: 'user', content: userText }];
  const proposals = [];
  let toolCalls = 0;
  for (let turn = 0; turn < 4; turn++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      tools: TOOLS,
      messages,
    });
    if (res.stop_reason === 'refusal') return { reply: 'The assistant declined this request.', proposals, toolCalls };
    const uses = res.content.filter((b) => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || uses.length === 0) {
      return { reply: res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim(), proposals, toolCalls };
    }
    messages.push({ role: 'assistant', content: res.content });
    const results = uses.map((u) => {
      toolCalls++;
      const out = runTool(u.name, u.input, ctx);
      if (out.proposal) proposals.push(out);
      return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out), ...(out.error ? { is_error: true } : {}) };
    });
    messages.push({ role: 'user', content: results });
  }
  return { reply: 'Stopped after too many steps.', proposals, toolCalls };
}
