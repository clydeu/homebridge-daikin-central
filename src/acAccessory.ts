import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { DaikinCentralPlatform, Device } from './platform';
import { DaikinService, Mode, AcState } from './daikinService';
import { HeatingThresholdDefault, CoolingThresholdDefault } from './constants';
import { HttpLogService } from './httpLogService';

export class ACAccessory {
  private acService: Service;
  private temperatureService: Service;

  private states : AcState = {
    power: false,
    mode: Mode.AUTO,
    currentTemp: 0,
    heatingTemp: HeatingThresholdDefault.min,
    coolingTemp: CoolingThresholdDefault.min,
    fanSpeed: 0,
    fanAuto: false,
  };

  constructor(
    private readonly platform: DaikinCentralPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly daikinService: DaikinService,
    private readonly httpLogService: HttpLogService | null,
  ) {

    this.daikinService.getAcModel().then((m) => {
      const device = this.accessory.context.device as Device;
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Daikin')
        .setCharacteristic(this.platform.Characteristic.Model, m.model)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, m.serial)
        .setCharacteristic(this.platform.Characteristic.FirmwareRevision, m.firmware)
        .setCharacteristic(this.platform.Characteristic.Name, device.displayName);
    });


    this.acService = this.accessory.getService(this.platform.Service.HeaterCooler) ||
                      this.accessory.addService(this.platform.Service.HeaterCooler);
    this.temperatureService = this.accessory.getService(this.platform.Service.TemperatureSensor) ||
                        this.accessory.addService(this.platform.Service.TemperatureSensor);

    this.acService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.acService
      .getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getHeaterCoolerState.bind(this));

    this.acService
      .getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    this.acService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.acService
      .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .onGet(this.getCoolingTemperature.bind(this))
      .onSet(this.setCoolingTemperature.bind(this));

    this.acService
      .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .onGet(this.getHeatingTemperature.bind(this))
      .onSet(this.setHeatingTemperature.bind(this));

    this.acService
      .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.getTemperatureDisplayUnits.bind(this));

    this.temperatureService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({minValue: Number.parseFloat('-50'),
        maxValue: Number.parseFloat('100')})
      .onGet(this.getCurrentTemperature.bind(this));

    daikinService.getCoolingThreshold().then((temp) => {
      const cooling = {
        minValue: temp.low,
        maxValue: temp.high,
        minStep: Number.parseFloat('1'),
      };
      this.platform.log.debug(`Setting cooling threshold temperature: ${JSON.stringify(cooling)}`);
      this.acService
        .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
        .setProps(cooling);
    });

    daikinService.getHeatingThreshold().then((temp) => {
      const heating = {
        minValue: temp.low,
        maxValue: temp.high,
        minStep: Number.parseFloat('1'),
      };
      this.platform.log.debug(`Setting heating threshold temperature: ${JSON.stringify(heating)}`);
      this.acService
        .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
        .setProps(heating);
    });

    this.acService
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 7,
        minStep: 1,
      })
      .onGet(this.getFanSpeed.bind(this))
      .onSet(this.setFanSpeed.bind(this));

    this.acService
      .getCharacteristic(this.platform.Characteristic.SwingMode)
      .onGet(this.getTargetFanMode.bind(this))
      .onSet(this.setTargetFanMode.bind(this));

    this.platform.log.debug('Finished initializing ACAccessory');

    if (httpLogService !== null){
      this.platform.log.debug(`HttpLogService configured to ${httpLogService.url}.`);
      setInterval(async () => {
        const temperature = await this.daikinService.getCurrentTemperature();
        this.states.currentTemp = temperature;
        this.temperatureService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, temperature);
        if (temperature !== this.states.currentTemp) {
          await httpLogService.logTempReading(temperature);
        }
      }, 15 * 60 * 1000); //every 15 mins
    }else {
      this.platform.log.debug('HttpLogService is NOT configured.');
    }

    this.daikinService.getAcState();
  }

  async queryAcValues(){
    const newStates = await this.daikinService.getAcState();

    this.states = newStates;
    this.platform.log.debug(`queryAcValues: ${JSON.stringify(newStates)}`);
    this.updateHeaterCoolerServiceState();

    if (this.httpLogService !== null && newStates.currentTemp > 0 && this.states.currentTemp !== newStates.currentTemp){
      await this.httpLogService.logTempReading(newStates.currentTemp);
    }
  }

  updateHeaterCoolerServiceState(){
    this.acService.updateCharacteristic(this.platform.Characteristic.Active, this.getActiveValue());
    this.acService.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, this.getHeaterCoolerState());
    this.acService.updateCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState, this.getTargetHeaterCoolerState());
    this.acService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperature());
    this.acService.updateCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature, this.getCoolingTemperature());
    this.acService.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.getHeatingTemperature());
    this.acService.updateCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits, this.getTemperatureDisplayUnits());
    this.acService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.getFanSpeed());
    this.temperatureService.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.getCurrentTemperature());
  }

  getActive(): CharacteristicValue{
    this.queryAcValues();
    const activeValue = this.getActiveValue();
    this.platform.log.debug(`getActive: ${activeValue}`);
    return activeValue;
  }

  getActiveValue(): CharacteristicValue{
    return (this.states.power)
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE;
  }

  async setActive(value: CharacteristicValue): Promise<void>{
    this.platform.log.debug(`setActive: ${value}`);
    this.states.power = value as boolean;
    await this.daikinService.setPower((value === this.platform.Characteristic.Active.ACTIVE) ? true : false);
    this.queryAcValues();
  }

  getHeaterCoolerState(): CharacteristicValue{
    if (!this.states.power) {
      return this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }

    let state: number;
    switch(this.states.mode){
      case Mode.HEAT: {
        state = this.platform.Characteristic.CurrentHeaterCoolerState.HEATING;
        break;
      }
      case Mode.COOL: {
        state = this.platform.Characteristic.CurrentHeaterCoolerState.COOLING;
        break;
      }
      default: {
        state = this.platform.Characteristic.CurrentHeaterCoolerState.IDLE;
        break;
      }
    }
    this.platform.log.debug(`getHeaterCoolerState: ${state}`);
    return state;
  }

  getTargetHeaterCoolerState(): CharacteristicValue{
    if (!this.states.power) {
      return this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
    }


    let state: number;
    switch (this.states.mode) {
      case Mode.HEAT: {
        state = this.platform.Characteristic.TargetHeaterCoolerState.HEAT;
        break;
      }
      case Mode.COOL: {
        state = this.platform.Characteristic.TargetHeaterCoolerState.COOL;
        break;
      }
      default: {
        state = this.platform.Characteristic.TargetHeaterCoolerState.AUTO;
        break;
      }
    }
    this.platform.log.debug(`getTargetHeaterCoolerState: ${state}`);
    return state;
  }

  async setTargetHeaterCoolerState(value: CharacteristicValue){
    let mode: Mode = Mode.AUTO;
    switch(value){
      case this.platform.Characteristic.TargetHeaterCoolerState.HEAT:
        mode = Mode.HEAT;
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.COOL:
        mode = Mode.COOL;
        break;
      case this.platform.Characteristic.TargetHeaterCoolerState.AUTO:
        mode = Mode.AUTO;
        break;
    }
    this.platform.log.debug(`setTargetHeaterCoolerState: ${mode}`);
    this.states.mode = mode;
    await this.daikinService.setMode(mode);
    this.acService.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState, this.getHeaterCoolerState());
  }

  getCurrentTemperature(): CharacteristicValue{
    this.platform.log.debug(`getCurrentTemperature: ${this.states.currentTemp}`);
    return this.states.currentTemp;
  }

  getCoolingTemperature(): CharacteristicValue{
    this.platform.log.debug(`getCoolingTemperature: ${this.states.coolingTemp}`);
    return this.states.coolingTemp;
  }

  async setCoolingTemperature(value: CharacteristicValue){
    this.platform.log.debug(`setCoolingTemperature: ${value}`);
    this.states.coolingTemp = value as number;
    await this.daikinService.setCoolingTemp(value as number);
  }

  getHeatingTemperature(): CharacteristicValue{
    this.platform.log.debug(`getHeatingTemperature: ${this.states.heatingTemp}`);
    return this.states.heatingTemp;
  }

  async setHeatingTemperature(value: CharacteristicValue){
    this.platform.log.debug(`setHeatingTemperature: ${value}`);
    this.states.heatingTemp = value as number;
    await this.daikinService.setHeatingTemp(value as number);
  }

  getTemperatureDisplayUnits(): CharacteristicValue{
    this.platform.log.debug(`getTemperatureDisplayUnits: ${this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS}`);
    return this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
  }

  getFanSpeed() : CharacteristicValue{
    this.platform.log.debug(`getFanSpeed: ${this.states.fanSpeed}`);
    return this.states.fanSpeed;
  }

  async setFanSpeed(value: CharacteristicValue){
    if (value === 0) {
      return;
    }
    this.platform.log.debug(`setFanSpeed: ${value}`);
    this.states.fanSpeed = value as number;
    await this.daikinService.setFanRate(value as number);
  }

  getTargetFanMode(): CharacteristicValue{
    this.platform.log.debug(`getTargetFanState: ${this.states.fanAuto}`);
    return this.states.fanAuto;
  }

  async setTargetFanMode(value: CharacteristicValue){
    this.platform.log.debug(`setTargetFanState: ${value}`);
    this.states.fanAuto = value as boolean;
    await this.daikinService.setFanMode(value as boolean);
  }
}