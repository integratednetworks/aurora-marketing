// The two Finviz screens this tool knows about, shared by the client UI and
// the server fetch route so the filter strings live in exactly one place.
//
// `filter` is the raw Finviz `f=` value. `view=111` (Overview) is used for the
// server-side fetch because every row on that view carries a `quote.ashx?t=`
// link we can parse tickers out of. The `url` is what we link the user to so
// they can open the same screen in Finviz themselves.

export type FinvizPreset = {
  id: string;
  label: string;
  blurb: string;
  filter: string;
};

export const PRESETS: FinvizPreset[] = [
  {
    id: "f13",
    label: "F13",
    blurb:
      "Strict quality-growth screen. Mid-cap and up, strong balance sheet, double-digit growth and returns, PEG under 2.",
    filter:
      "cap_midover,fa_curratio_o2,fa_debteq_u0.4,fa_epsyoy_o10,fa_epsyoy1_o10,fa_estltgrowth_o10,fa_peg_u2,fa_quickratio_o1,fa_roa_o10,fa_roe_o10,fa_roi_o10,sh_instown_o30",
  },
  {
    id: "flex",
    label: "Flexible VAX",
    blurb:
      "Looser version of F13. Relaxed ratios, no PEG filter and 5% return thresholds, so it returns more names.",
    filter:
      "cap_midover,fa_curratio_o1.5,fa_debteq_u0.5,fa_epsyoy_o10,fa_epsyoy1_o10,fa_estltgrowth_o10,fa_quickratio_o0.5,fa_roa_o5,fa_roe_o5,fa_roi_o5,sh_instown_o30",
  },
];

export function presetById(id: string): FinvizPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

// Human-facing Finviz screener link (Overview view, sorted by market cap).
export function finvizUrl(filter: string): string {
  return `https://finviz.com/screener.ashx?v=111&f=${filter}&o=-marketcap`;
}
