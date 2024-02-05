import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { DaikinCentralPlatform, Device } from './platform';
import { DaikinService } from './daikinService';

export class ZoneAccessory {
  private service: Service;

  private on = false;

  constructor(
    private readonly platform: DaikinCentralPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly daikinService: DaikinService,
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

    this.service = this.accessory.getService(this.platform.Service.Switch) ||
                    this.accessory.addService(this.platform.Service.Switch);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));

    this.daikinService.addPowerSubscriber(() => {
      this.getOnValue();
    });
  }

  async setOn(value: CharacteristicValue) {
    this.on = value as boolean;

    const device = this.accessory.context.device as Device;
    if (device.num !== undefined) {
      this.daikinService.setZoneStatus(device.num, this.on);
    }

    this.platform.log.debug(`Set Zone#${device.num} On ->${value}`);
  }

  async getOn(): Promise<CharacteristicValue> {
    this.platform.log.debug(`get Zone#${this.accessory.context.device.num} On ->${this.on}`);
    this.getOnValue();
    return this.on;
  }

  async getOnValue(){
    const acState = await this.daikinService.getAcState();
    const zoneStatus = await this.daikinService.getZoneStatus(this.accessory.context.device.num);
    this.on = zoneStatus && acState?.power;
    this.service.updateCharacteristic(this.platform.Characteristic.On, this.on);
  }
}