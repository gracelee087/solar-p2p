// Tariff parameters. ASSUMPTIONS for the simulation, not quotes. Shown as such in the UI.
export const TARIFF = {
  retailCt: 35, // what a member pays the grid supplier per kWh (assumed)
  feedInCt: 8, // what a member gets for exporting to the grid per kWh (assumed)
  localSpreadCt: 12, // local price = wholesale + spread, clamped to [feedIn, retail - minSaving]
  minSavingCt: 5, // buyers always pay at least this much less than retail
};

export const PV_PERFORMANCE_RATIO = 0.8; // simple PV model: kWp * GHI/1000 * PR

// 1 ct/kWh = 10 micro-EUR per Wh. Prices are kept in whole micro-EUR/Wh (0.1 ct/kWh steps)
// so every amount is an exact integer: amountMicro = wh * priceMicroPerWh.
export const ctPerKwhToMicroPerWh = (ct) => Math.round(ct * 10);

// Local community price for one 15-min slot, from the real wholesale price (EUR/MWh = 0.1 ct/kWh).
export function localPriceMicroPerWh(wholesaleEurMWh, t = TARIFF) {
  const wholesaleCt = wholesaleEurMWh / 10;
  const ct = Math.min(Math.max(wholesaleCt + t.localSpreadCt, t.feedInCt), t.retailCt - t.minSavingCt);
  return ctPerKwhToMicroPerWh(ct);
}
