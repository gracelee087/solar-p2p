// Tariff parameters. ASSUMPTIONS for the simulation, not quotes. Shown as such in the UI.
// Energy shared under §42c EnWG still pays the usual grid fees and levies (Bundesnetzagentur, Energy
// Sharing page). So a buyer's all-in price for a shared kWh = local energy price + gridChargesCt.
export const TARIFF = {
  retailCt: 35, // all-in grid supply price per kWh incl. grid fees, levies, taxes (assumed)
  gridChargesCt: 20, // part of every kWh drawn from the grid that is paid even when shared: grid fees, levies, taxes (assumed)
  feedInCt: 7, // what a member gets for exporting surplus to the grid per kWh (assumed)
  localSpreadCt: 12, // local energy price = wholesale + spread, clamped to [feedIn, retail - gridCharges - minSaving]
  minSavingCt: 2, // a buyer's all-in price for shared energy is at least this much below retail
};

export const PV_PERFORMANCE_RATIO = 0.8; // simple PV model: kWp * GHI/1000 * PR

// 1 ct/kWh = 10 micro-EUR per Wh. Prices are kept in whole micro-EUR/Wh (0.1 ct/kWh steps)
// so every amount is an exact integer: amountMicro = wh * priceMicroPerWh.
export const ctPerKwhToMicroPerWh = (ct) => Math.round(ct * 10);

// Local energy price for one 15-min slot, from the real wholesale price (EUR/MWh = 0.1 ct/kWh).
// This is what moves between members on-chain; grid charges are billed separately as usual.
export function localPriceMicroPerWh(wholesaleEurMWh, t = TARIFF) {
  const wholesaleCt = wholesaleEurMWh / 10;
  const cap = t.retailCt - t.gridChargesCt - t.minSavingCt;
  const ct = Math.min(Math.max(wholesaleCt + t.localSpreadCt, t.feedInCt), cap);
  return ctPerKwhToMicroPerWh(ct);
}

// What a buyer really pays per Wh of shared energy (energy to the neighbour + grid charges).
export const sharedAllInMicroPerWh = (localMicroPerWh, t = TARIFF) => localMicroPerWh + ctPerKwhToMicroPerWh(t.gridChargesCt);
