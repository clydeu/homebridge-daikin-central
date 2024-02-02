export type AcState = {
  power: boolean;
  mode: Mode;
  currentTemp: number;
  heatingTemp: number;
  coolingTemp: number;
}

export type AcModel = {
  serial: string;
  firmware: string;
  model: string;
}

export type TempThreshold = {
  low: number;
  high: number;
}

export interface DaikinService{
  getAcModel(): Promise<AcModel>;
  getAcState() : Promise<AcState>;
  getCoolingThreshold() : Promise<TempThreshold>;
  getHeatingThreshold() : Promise<TempThreshold>;
  getZoneStatus(zoneNum: number) : Promise<boolean>;
  getCurrentTemperature() : Promise<number>;
  setZoneStatus(zoneNum: number, active: boolean) : Promise<void>;
  setPower(on: boolean) : Promise<void>;
  setMode(mode: Mode) : Promise<void>;
  setHeatingTemp(temp: number) : Promise<void>;
  setCoolingTemp(temp: number) : Promise<void>;
  addPowerSubscriber(func: () => void) : void;
}

export enum Mode {
  AUTO,
  HEAT,
  COOL
}