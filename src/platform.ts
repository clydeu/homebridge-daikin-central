import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ZoneAccessory } from './zoneAccessory';
import { ACAccessory } from './acAccessory';
import { DaikinSkyfiService } from './daikinSkyfiService';
import { DaikinService } from './daikinService';
import { HttpLogService } from './httpLogService';

export interface Device{
  uniqueId: string;
  displayName: string;
  num?: number;
}
export class DaikinCentralPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];

  private readonly daikinService: DaikinService;
  private readonly httpLogService: HttpLogService | null = null;

  public readonly enabledZones: string[];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      await this.discoverDevices();
    });
    this.daikinService = new DaikinSkyfiService(config['baseUrl'], log);
    if (config['logToHttp'] !== undefined){
      this.httpLogService = new HttpLogService(config['logToHttp'], log);
    }

    this.enabledZones = config['enabledZones'] ?? [];
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    this.accessories.push(accessory);
  }

  createZoneDevices(uniqueId: string) : Device[]{
    const zoneDevices: Device[] = [];
    this.enabledZones.forEach((z) => {
      zoneDevices.push({
        uniqueId: `Daikin-Central-Zone-${z}-${uniqueId}`,
        displayName: `Zone ${z}`,
        num: parseInt(z),
      });
    });
    return zoneDevices;
  }

  async discoverDevices() {
    const model = await this.daikinService.getAcModel();
    // Create AC device
    this.registerDevice({
      uniqueId: 'Daikin Central AC' + model.serial,
      displayName: 'Daikin',
    }, (accessory) => new ACAccessory(this, accessory, this.daikinService, this.httpLogService));
    // Create zone devices
    const zoneDevices = this.createZoneDevices(model.serial);
    for (const device of zoneDevices) {
      this.registerDevice(device, (accessory) => new ZoneAccessory(this, accessory, this.daikinService));
    }
  }

  registerDevice(device: Device, createAccessory: (accessory: PlatformAccessory) => void): void{
    const uuid = this.api.hap.uuid.generate(device.uniqueId);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      createAccessory(existingAccessory);
    } else {
      this.log.info('Adding new accessory:', device.displayName);

      const accessory = new this.api.platformAccessory(device.displayName, uuid);
      accessory.context.device = device;
      createAccessory(accessory);

      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}
