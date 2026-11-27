import type { EntityNameItem, LovelaceCardConfig } from "../ha";

/**
 * The switch of a DIN rail module: "din" is a vertical lever like regular DIN
 * rail equipment (up is on, down is off), "button" is a horizontal stand-by
 * push button half as high.
 */
export type DinRailSwitchStyle = "din" | "button";

export interface DinRailSwitchCardConfig extends LovelaceCardConfig {
  entity: string;
  name?: string | EntityNameItem | EntityNameItem[];
  power_entity?: string;
  current_entity?: string;
  voltage_entity?: string;
  lcd_displays?: boolean;
  /** Show the power, current and voltage (each on by default) */
  show_power?: boolean;
  show_current?: boolean;
  show_voltage?: boolean;
  /** Device of the breaker; the editor offers only its entities */
  device?: string;
  /** Decimals on the LCD displays, 0 (the default) to 2. */
  precision?: number;
  /**
   * The rating of the breaker in A, printed on it. Found on the device of the
   * switch (number.*_over_current_threshold) when not set.
   */
  rating_entity?: string;
  /** Amperes; the current turns red above it (the rating by default) */
  max_current?: number;
  /** Volts; the displays turn gray below it (default 210) */
  voltage_low?: number;
  /** Volts; the displays turn red above it (default 250) */
  voltage_high?: number;
  /** The switch of the module, "din" (the default) or "button". */
  switch_style?: DinRailSwitchStyle;
  theme?: string;
}

export interface DinRailPanelModuleConfig {
  entity: string;
  name?: string;
  /** Device of the breaker; the editor offers only its entities */
  device?: string;
  power_entity?: string;
  current_entity?: string;
  voltage_entity?: string;
  /** The rating of the breaker, see DinRailSwitchCardConfig */
  rating_entity?: string;
  /** Amperes; the current display turns red above it (the rating by default) */
  max_current?: number;
}

export interface DinRailPanelCardConfig extends LovelaceCardConfig {
  title?: string;
  /** Show the power, current and voltage of all modules and the totals */
  show_power?: boolean;
  show_current?: boolean;
  show_voltage?: boolean;
  /** Color of the engraved title: a theme color (red, primary) or any CSS color */
  title_color?: string;
  /** Modules per rail, 1 to 12. */
  columns?: number;
  /** Decimals on the LCD displays, 0 (the default) to 2. */
  precision?: number;
  voltage_low?: number;
  voltage_high?: number;
  /** The meter of the board: total W and A, average V (shown by default) */
  show_totals?: boolean;
  /** Show a larger copy of the module under the mouse (on by default) */
  zoom_on_hover?: boolean;
  /** Each total, independent of the readings shown on the modules */
  show_total_power?: boolean;
  show_total_current?: boolean;
  show_total_voltage?: boolean;
  /** Entities shown instead of the totals of the modules, like a main meter */
  total_power_entity?: string;
  total_current_entity?: string;
  total_voltage_entity?: string;
  /** The switch of all modules, "din" (the default) or "button". */
  switch_style?: DinRailSwitchStyle;
  /** The colors of the board: "white" (the default) or "black" with light text */
  panel_theme?: "white" | "black";
  /** At most 3 rails of `columns` modules. */
  modules: DinRailPanelModuleConfig[];
  theme?: string;
}
