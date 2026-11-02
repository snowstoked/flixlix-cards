import { getEntityState } from "@flixlix-cards/shared/states/utils/get-entity-state";
import { getEntityStateWatts } from "@flixlix-cards/shared/states/utils/get-entity-state-watts";
import { onlyNegative, onlyPositive } from "@flixlix-cards/shared/states/utils/negative-positive";
import {
  type ActionConfigSet,
  type BatteryUnit,
  type ComboEntity,
  type FlowCardPlusConfig,
} from "@flixlix-cards/shared/types";
import { type HomeAssistant } from "custom-card-helpers";
import { getFieldInState, getFieldOutState } from "./base";

/** A normalized battery unit (the main battery is unit 1, `batteries[]` holds units 2..n). */
export type BatteryUnitConfig = BatteryUnit & { isMain: boolean };

export type BatteryUnitState = ActionConfigSet & {
  index: number;
  isMain: boolean;
  name?: string;
  icon?: string;
  /** Entity opened on click (state of charge if available, else the power entity). */
  clickEntity?: string;
  stateOfChargeEntity?: string;
  stateOfCharge: number | null;
  /** Power flowing into this battery in W. */
  toBattery: number | null;
  /** Power flowing out of this battery in W. */
  fromBattery: number | null;
};

const hasEntity = (entity: BatteryUnit["entity"] | undefined): boolean => {
  if (!entity) return false;
  if (typeof entity === "string") return entity !== "";
  return !!(entity.consumption || entity.production);
};

/**
 * Returns all configured battery units. The main battery always comes first.
 * Extra units without an entity are ignored.
 */
export const getBatteryUnitConfigs = (config: FlowCardPlusConfig): BatteryUnitConfig[] => {
  const main = config.entities?.battery;
  if (!main) return [];

  const units: BatteryUnitConfig[] = [];
  if (hasEntity(main.entity)) {
    units.push({
      isMain: true,
      entity: main.entity,
      name: main.name,
      icon: main.icon,
      state_of_charge: main.state_of_charge,
      invert_state: main.invert_state,
      capacity: main.capacity,
      tap_action: main.tap_action,
      hold_action: main.hold_action,
      double_tap_action: main.double_tap_action,
    });
  }

  for (const extra of main.batteries ?? []) {
    if (!extra || !hasEntity(extra.entity)) continue;
    units.push({
      ...extra,
      isMain: false,
      invert_state: extra.invert_state ?? main.invert_state,
    });
  }

  return units;
};

/** True when additional batteries are configured, i.e. the multi battery logic applies. */
export const hasMultipleBatteries = (config: FlowCardPlusConfig): boolean =>
  getBatteryUnitConfigs(config).length > 1;

const getUnitStateOfCharge = (hass: HomeAssistant, unit: BatteryUnit): number | null => {
  if (unit.state_of_charge === undefined) return null;
  return getEntityState(hass, unit.state_of_charge);
};

const getUnitIn = (hass: HomeAssistant, unit: BatteryUnit): number => {
  if (typeof unit.entity === "string") {
    const state = getEntityStateWatts(hass, unit.entity);
    return unit.invert_state ? onlyPositive(state) : onlyNegative(state);
  }
  return getEntityStateWatts(hass, (unit.entity as ComboEntity).production);
};

const getUnitOut = (hass: HomeAssistant, unit: BatteryUnit): number => {
  if (typeof unit.entity === "string") {
    const state = getEntityStateWatts(hass, unit.entity);
    return unit.invert_state ? onlyNegative(state) : onlyPositive(state);
  }
  return getEntityStateWatts(hass, (unit.entity as ComboEntity).consumption);
};

/** Per unit states, used to render the battery unit overview. */
export const getBatteryUnitStates = (
  hass: HomeAssistant,
  config: FlowCardPlusConfig
): BatteryUnitState[] =>
  getBatteryUnitConfigs(config).map((unit, index) => {
    const entity = unit.entity;
    const powerEntity =
      typeof entity === "string" ? entity : (entity.production ?? entity.consumption);
    return {
      index,
      isMain: unit.isMain,
      name: unit.name,
      icon: unit.icon,
      stateOfChargeEntity: unit.state_of_charge,
      clickEntity: unit.state_of_charge ?? powerEntity,
      stateOfCharge: getUnitStateOfCharge(hass, unit),
      toBattery: getUnitIn(hass, unit),
      fromBattery: getUnitOut(hass, unit),
      tap_action: unit.tap_action,
      hold_action: unit.hold_action,
      double_tap_action: unit.double_tap_action,
    };
  });

/**
 * Net power of all units. Units charging and discharging at the same time cancel out,
 * because the flow lines can only show the battery system as a whole.
 */
const getNetPower = (hass: HomeAssistant, config: FlowCardPlusConfig): number => {
  let net = 0;
  for (const unit of getBatteryUnitConfigs(config)) {
    net += getUnitIn(hass, unit) - getUnitOut(hass, unit);
  }
  return net;
};

export const getBatteryStateOfCharge = (hass: HomeAssistant, config: FlowCardPlusConfig) => {
  if (hasMultipleBatteries(config)) {
    const withSoc = getBatteryUnitConfigs(config)
      .map((unit) => ({ unit, soc: getUnitStateOfCharge(hass, unit) }))
      .filter((item): item is { unit: BatteryUnitConfig; soc: number } => item.soc !== null);
    if (withSoc.length === 0) return null;

    // Weight by capacity only if it is known for every unit that reports a state of charge.
    const canWeight = withSoc.every(({ unit }) => (unit.capacity ?? 0) > 0);
    if (canWeight) {
      const totalCapacity = withSoc.reduce((sum, { unit }) => sum + unit.capacity!, 0);
      return withSoc.reduce((sum, { unit, soc }) => sum + soc * unit.capacity!, 0) / totalCapacity;
    }
    return withSoc.reduce((sum, { soc }) => sum + soc, 0) / withSoc.length;
  }

  const entity = config.entities.battery?.state_of_charge;

  if (entity === undefined) return null;

  return getEntityState(hass, entity);
};

export const getBatteryInState = (hass: HomeAssistant, config: FlowCardPlusConfig) =>
  hasMultipleBatteries(config)
    ? Math.max(getNetPower(hass, config), 0)
    : getFieldInState(hass, config, "battery");

export const getBatteryOutState = (hass: HomeAssistant, config: FlowCardPlusConfig) =>
  hasMultipleBatteries(config)
    ? Math.max(-getNetPower(hass, config), 0)
    : getFieldOutState(hass, config, "battery");
