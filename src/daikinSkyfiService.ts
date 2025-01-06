import { Logger } from 'homebridge';
import axios, { AxiosInstance } from 'axios';
import { Cache, throttleAdapterEnhancer, retryAdapterEnhancer } from 'axios-extensions';
import { AcState, DaikinService, Mode, AcModel, TempThreshold } from './daikinService';
import { v4 as uuidv4 } from 'uuid';
import { CoolingThresholdDefault, HeatingThresholdDefault } from './constants';
import { Mutex } from 'async-mutex';
import { operation } from 'retry';

type SensorInfo = {
  ret?: string;
  err?: string;
  htemp: number;
  otemp: number;
};

type ControlInfo = {
  ret?: string;
  pow: number;
  mode: number;
  operate: number;
  bk_auto: number;
  stemp: number;
  dt1: number;
  dt2: number;
  f_rate: number;
  dfr1: number;
  dfr2: number;
  f_airside: number;
  airside1: number;
  airside2: number;
  f_auto: number;
  auto1: number;
  auto2: number;
  f_dir: number;
  dfd1: number;
  dfd2: number;
  filter_sign_info: number;
  cent: number;
  en_cent: number;
  remo: number;
};

type ModelInfo = {
  ret?: string;
  err: number;
  model: string;
  type: string;
  humd: number;
  s_humd: number;
  en_zone: number;
  en_linear_zone: number;
  en_filter_sign: number;
  acled: number;
  land: number;
  elec: number;
  temp: number;
  m_dtct: number;
  ac_dst: number;
  dmnd: number;
  en_temp_setting: number;
  en_frate: number;
  en_fdir: number;
  en_rtemp_a: number;
  en_spmode: number;
  en_ipw_sep: number;
  en_scdltmr: number;
  en_mompow: number;
  en_patrol: number;
  en_airside: number;
  en_quick_timer: number;
  en_auto: number;
  en_dry: number;
  en_common_zone: number;
  cool_l: number;
  cool_h: number;
  heat_l: number;
  heat_h: number;
  frate_steps: number;
  en_frate_auto: number;
};

type BasicInfo = {
  ret?: string;
  type: string;
  reg: string;
  dst: number;
  ver: string;
  rev: number;
  pow: number;
  err: number;
  location: number;
  name: string;
  icon: number;
  method: string;
  port: number;
  id: string;
  pw: string;
  lpw_flag: number;
  adp_kind: number;
  led: number;
  en_setzone: number;
  mac: string;
  adp_mode: string;
  ssid: string;
  err_type: number;
  err_code: number;
  en_ch: number;
  holiday: number;
  en_hol: number;
  sync_time: number;
};

type ZoneInfo = {
  ret?: string;
  zone_name: string;
  zone_onoff: string;
};

type PowerSubFunc = () => void;

export class DaikinSkyfiService implements DaikinService {
  private readonly get_sensor_info = '/skyfi/aircon/get_sensor_info';
  private readonly get_model_info = '/skyfi/aircon/get_model_info';
  private readonly get_control_info = '/skyfi/aircon/get_control_info';
  private readonly set_control_info = '/skyfi/aircon/set_control_info';
  private readonly get_basic_info = '/skyfi/common/basic_info';
  private readonly get_zone_setting = '/skyfi/aircon/get_zone_setting';
  private readonly set_zone_setting = '/skyfi/aircon/set_zone_setting';
  private readonly modeMapping = {
    1: Mode.HEAT,
    2: Mode.COOL,
    3: Mode.AUTO,
  };

  private readonly http: AxiosInstance;
  private readonly powerSubscribers : PowerSubFunc[] = [];
  private readonly acStateCache: Cache<string, object>;
  private readonly cache: Cache<string, object>;
  constructor(
    private readonly url: string,
    public readonly log: Logger,
  ) {
    this.http = axios.create({
      baseURL: this.url,
      timeout: 10000,
      adapter: throttleAdapterEnhancer(retryAdapterEnhancer(axios.getAdapter(axios.defaults.adapter), {times: 5}), { threshold: 2000 }),
    });
    this.acStateCache = new Cache({ ttl: 5 * 60 * 1000, ttlAutopurge: true }); // by default cache AC state for 5 mins.
    this.cache = new Cache({ max: 10 });
  }

  private readonly sensorInfoMutex = new Mutex();
  async getSensorInfo(cache = true) : Promise<SensorInfo | null>{
    return await this.sensorInfoMutex.runExclusive(async () => {
      const responsePromise = this.acStateCache.get(this.get_sensor_info);
      if (cache && responsePromise){
        this.log.debug(`Using cached value for sensor info, refresh in ${Math.round(
          this.acStateCache.getRemainingTTL(this.get_sensor_info)/1000)}s`);
        return responsePromise as SensorInfo;
      }

      try {
        this.log.debug('Getting new sensor info from AC controller.');
        const response = await this.http.get(this.get_sensor_info);
        this.log.debug(`New sensor info from AC controller: ${response.data}`);
        const data = this.parseResponse(response.data) as SensorInfo;
        if (data.ret !== 'OK' || `${data.htemp}` === '-') {
          throw Error(`failed to get sensor info. ${response.data}`);
        }

        this.acStateCache.set(this.get_sensor_info, data);
        this.cache.set(this.get_sensor_info, data);
        return data;
      } catch (error) {
        this.log.error(`getSensorInfo error: ${error}. Using stale cached data.`);
        const cachedPromise = this.cache.get(this.get_sensor_info);
        if (cachedPromise === null){
          this.log.debug('There are no cached data for this query.');
          return null;
        } else {
          return cachedPromise as SensorInfo;
        }
      }
    });
  }

  private readonly controlInfoMutex = new Mutex();
  async getControlInfo(cache = true) : Promise<ControlInfo | null>{
    return await this.controlInfoMutex.runExclusive(async () => {
      const responsePromise = this.acStateCache.get(this.get_control_info);
      if (cache && responsePromise){
        this.log.debug(`Using cached value for control info, refresh in ${Math.round(
          this.acStateCache.getRemainingTTL(this.get_control_info)/1000)}s`);
        return responsePromise as ControlInfo;
      }

      try {
        this.log.debug('Getting new control info from AC controller.');
        const response = await this.http.get(this.get_control_info, { cache: cache });
        this.log.debug(`New control info from AC controller: ${response.data}`);
        const data = this.parseResponse(response.data) as ControlInfo;
        if (data.ret !== 'OK') {
          throw Error(`failed to get control info. ${response.data}`);
        }

        data.ret = undefined;
        this.acStateCache.set(this.get_control_info, data);
        this.cache.set(this.get_control_info, data);
        return data;
      } catch (error) {
        this.log.error(`getControlInfo error: ${error}. Using stale cached data.`);
        const cachedPromise = this.cache.get(this.get_control_info);
        if (cachedPromise === null){
          this.log.debug('There are no cached data for this query.');
          return null;
        } else {
          return cachedPromise as ControlInfo;
        }
      }
    });
  }

  async getAcState() : Promise<AcState>{
    const sensorInfo = await this.getSensorInfo();
    const controlInfo = await this.getControlInfo();

    let fanSpeed = controlInfo?.f_rate ?? 0;
    if (controlInfo?.f_airside === 1) {
      fanSpeed = 7;
    }
    if (controlInfo?.f_auto === 1 && fanSpeed > 5) {
      fanSpeed = 5;
    }

    return {
      power: (controlInfo?.pow === 1) ? true : false,
      mode: this.modeMapping[controlInfo?.mode ?? 8],
      currentTemp: sensorInfo?.htemp ?? 0,
      heatingTemp: controlInfo?.dt1 ?? HeatingThresholdDefault.min,
      coolingTemp: controlInfo?.dt2 ?? CoolingThresholdDefault.min,
      fanSpeed: fanSpeed,
      fanAuto: controlInfo?.f_auto === 1 || controlInfo?.f_airside === 1,
    };
  }

  async getCurrentTemperature(): Promise<number>{
    const sensorInfo = await this.getSensorInfo();
    return sensorInfo?.htemp ?? 0;
  }

  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private controlInfo: ControlInfo | null = null;
  private actualControlInfo: ControlInfo | null = null;
  private readonly setControlInfoMutex = new Mutex();
  async setControlInfo(updateControlInfo: (controlInfo:ControlInfo) => void) : Promise<void>{
    await this.setControlInfoMutex.runExclusive(async () => {
      if (this.controlInfo === null){
        this.log.info('setControlInfo: getting new control info.');
        this.actualControlInfo = await this.getControlInfo(false);
        const controlInfo = this.actualControlInfo ? { ...this.actualControlInfo } : null;
        if (controlInfo === null){
          this.log.error('setControlInfo error: could not get control info. no change in settings.');
          return;
        }
        this.controlInfo = controlInfo;
      }

      updateControlInfo(this.controlInfo);
      this.acStateCache.set(this.get_control_info, this.controlInfo as ControlInfo);
    } );


    if (this.timeoutId === null) {
      this.timeoutId = setTimeout(async() => {
        const controlInfo = this.controlInfo;
        const timeoutId = this.timeoutId;
        const actualControlInfo = this.actualControlInfo;
        this.controlInfo = null;
        this.timeoutId = null;
        this.actualControlInfo = null;
        if (actualControlInfo !== null){
          if (JSON.stringify(controlInfo) === JSON.stringify(actualControlInfo)){
            this.log.debug('setControlInfo: no control update needed');
            return;
          }
        }

        await this.controlInfoMutex.runExclusive(async () => {
          const op = operation({
            retries: 3,
            factor: 2,
            minTimeout: 5000,
            maxTimeout: 60000,
          });

          op.attempt(async() => {
            try {
              this.log.debug(`setControlInfo: updating control with ${JSON.stringify(controlInfo)}`);
              const resp = await this.http.get(this.set_control_info, {params: controlInfo, cache: false });
              const data = this.parseResponse(resp.data);
              if (resp.status === 200 && data['ret'] === 'OK') {
                this.log.info('setControlInfo: successfully updated control info.');
              } else {
                throw Error(`failed to update control info. ${resp.data}`);
              }
            } catch (error) {
              this.log.error('setControlInfo error: ' + error);
              if (op.retry(error)) {
                return;
              }
              this.log.error('failed to update control info');
              this.acStateCache.set(this.get_control_info, actualControlInfo as ControlInfo);
            } finally {
              clearTimeout(timeoutId as ReturnType<typeof setTimeout>);
            }
          });
        });
      }, 2000);
    }
  }

  async setPower(on: boolean) : Promise<void>{
    await this.setControlInfo((controlInfo) => {
      controlInfo.pow = (on) ? 1 : 0;
      this.log.info(`Updating power to ${controlInfo.pow}`);
    });
    this.powerSubscribers.forEach((e) => e());
  }

  async setMode(mode: Mode) : Promise<void>{
    await this.setControlInfo((controlInfo) => {
      switch(mode){
        case Mode.HEAT:
          controlInfo.mode = 1;
          controlInfo.stemp = controlInfo.dt1;
          break;
        case Mode.COOL:
          controlInfo.mode = 2;
          controlInfo.stemp = controlInfo.dt2;
          break;
        case Mode.AUTO:
          controlInfo.mode = 3;
          break;
      }
      this.log.info(`Updating mode to ${controlInfo.mode}`);
    });
  }

  async setHeatingTemp(temp: number) : Promise<void>{
    await this.setControlInfo((controlInfo) => {
      if (controlInfo.mode === Mode.HEAT) {
        controlInfo.stemp = temp;
      }
      controlInfo.dt1 = temp;
      this.log.info(`Updating heating temp to ${temp}`);
    });
  }

  async setCoolingTemp(temp: number) : Promise<void>{
    await this.setControlInfo((controlInfo) => {
      if (controlInfo.mode === Mode.COOL) {
        controlInfo.stemp = temp;
      }
      controlInfo.dt2 = temp;
      this.log.info(`Updating cooling temp to ${temp}`);
    });
  }

  async setFanRate(frate: number) : Promise<void>{
    await this.setControlInfo((controlInfo) => {
      controlInfo.f_rate = frate;
      if (frate > 5 && controlInfo.f_auto === 1){
        controlInfo.f_rate = 1;
        controlInfo.f_auto = 0;
        controlInfo.f_airside = 1;
      }else if (frate <= 5 && controlInfo.f_airside === 1){
        controlInfo.f_rate = frate;
        controlInfo.f_auto = 1;
        controlInfo.f_airside = 0;
      } else {
        controlInfo.f_rate = frate;
      }
      this.log.info(`Updating fan rate to ${frate}`);
    });
  }

  async setFanMode(isAuto: boolean) : Promise<void>{
    await this.setControlInfo((controlInfo) => {
      let fanMode = '';
      if (controlInfo.f_rate > 5 && isAuto){ // Airside
        controlInfo.f_rate = 1;
        controlInfo.f_airside = 1;
        fanMode = 'airside';
      } else if (isAuto){ // Auto
        controlInfo.f_auto = 1;
        fanMode = 'auto';
      } else {
        controlInfo.f_auto = 0;
        controlInfo.f_airside = 0;
        fanMode = 'manual';
      }
      this.log.info(`Updating fan mode to ${fanMode}`);
    });
  }

  private readonly modelInfoMutex = new Mutex();
  async getModelInfo(cache = true) : Promise<ModelInfo | null>{
    return await this.modelInfoMutex.runExclusive(async () => {
      const responsePromise = this.cache.get(this.get_model_info);
      if (cache && responsePromise){
        this.log.debug('Using cached value for model info');
        return responsePromise as ModelInfo;
      }

      try {
        const response = await this.http.get(this.get_model_info);
        this.log.debug(`New model info from AC controller: ${response.data}`);
        const data = this.parseResponse(response.data);
        this.cache.set(this.get_model_info, data);
        return data as ModelInfo;
      } catch (error) {
        this.log.error('getModelInfo error: ' + error);
        return null;
      }
    });
  }

  async getCoolingThreshold() : Promise<TempThreshold>{
    const modelInfo = await this.getModelInfo();
    return {
      low: modelInfo?.cool_l ?? HeatingThresholdDefault.min,
      high: modelInfo?.cool_h ?? HeatingThresholdDefault.max,
    };
  }

  async getHeatingThreshold() : Promise<TempThreshold>{
    const modelInfo = await this.getModelInfo();
    return {
      low: modelInfo?.heat_l ?? HeatingThresholdDefault.min,
      high: modelInfo?.heat_h ?? HeatingThresholdDefault.max,
    };
  }

  private readonly basicInfoMutex = new Mutex();
  async getBasicInfo(cache = true) : Promise<BasicInfo | null>{
    return await this.basicInfoMutex.runExclusive(async () => {
      const responsePromise = this.cache.get(this.get_basic_info);
      if (cache && responsePromise){
        this.log.debug('Using cached value for basic info');
        return responsePromise as BasicInfo;
      }
      try {
        const response = await this.http.get(this.get_basic_info);
        this.log.debug(`New basic info from AC controller: ${response.data}`);
        const data = this.parseResponse(response.data);
        this.cache.set(this.get_basic_info, data);
        return data as BasicInfo;
      } catch (error) {
        this.log.error('getBasicInfo error: ' + error);
        return null;
      }
    });
  }

  async getAcModel(): Promise<AcModel>{
    const basicInfo = await this.getBasicInfo();
    return {
      serial: basicInfo?.mac ?? uuidv4(),
      firmware: basicInfo?.ver.replace('_', '.') ?? '',
      model: basicInfo?.ssid ?? 'Daikin Model',
    };
  }

  private readonly zoneInfoMutex = new Mutex();
  private async getZoneInfo(cache = true) : Promise<ZoneInfo | null>{
    return await this.zoneInfoMutex.runExclusive(async () => {
      const responsePromise = this.acStateCache.get(this.get_zone_setting);
      if (cache && responsePromise){
        this.log.debug(`Using cached value for zone info, refresh in 
          ${Math.round(this.acStateCache.getRemainingTTL(this.get_zone_setting)/1000)}s`);
        return responsePromise as ZoneInfo;
      }

      try {
        this.log.debug('Getting new zone info from AC controller.');
        const response = await this.http.get(this.get_zone_setting, {cache: cache});
        this.log.debug(`New zone info from AC controller: ${response.data}`);
        const data = this.parseResponse(response.data) as ZoneInfo;
        if (data.ret !== 'OK') {
          throw Error(`failed to get zone info. ${response.data}`);
        }

        this.acStateCache.set(this.get_zone_setting, data);
        this.cache.set(this.get_zone_setting, data);
        return data;
      } catch (error) {
        this.log.error(`getZoneInfo error: ${error}. Using stale cached data.`);
        const cachedPromise = this.cache.get(this.get_zone_setting);
        if (cachedPromise === null){
          this.log.debug('There are no cached data for zone info query.');
          return null;
        } else {
          return cachedPromise as ZoneInfo;
        }
      }
    });
  }

  async getZoneStatus(zoneNum: number) : Promise<boolean>{
    const data = await this.getZoneInfo();
    if (data === null) {
      return false;
    }

    const zones = decodeURIComponent(data.zone_onoff).split(';');
    return zones[zoneNum - 1] === '1';
  }

  private zoneTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private zoneStatus: ZoneInfo | null = null;
  private readonly setZoneInfoMutex = new Mutex();
  private actualZoneInfo: ZoneInfo | null = null;
  async setZoneStatus(zoneNum: number, active: boolean) : Promise<void>{
    await this.setZoneInfoMutex.runExclusive(async () => {
      if (this.zoneStatus === null){
        this.log.info('setZoneStatus: getting new zone status info.');
        this.actualZoneInfo = await this.getZoneInfo(false);
        const zoneStatus = this.actualZoneInfo ? { ...this.actualZoneInfo } : null;
        if (zoneStatus === null){
          this.log.error('setZoneStatus error: could not get zone info. no change in settings.');
          return;
        }
        this.zoneStatus = zoneStatus;
      }

      const zones = decodeURIComponent(this.zoneStatus.zone_onoff).split(';');
      zones[zoneNum -1] = (active) ? '1' : '0';
      this.zoneStatus.zone_onoff = encodeURIComponent(zones.join(';'));
      this.acStateCache.set(this.get_zone_setting, this.zoneStatus);
    });

    if (this.zoneTimeoutId === null) {
      this.zoneTimeoutId = setTimeout(async() => {
        const zoneStatus = this.zoneStatus;
        const zoneTimeoutId = this.zoneTimeoutId;
        const actualZoneInfo = this.actualZoneInfo;
        this.zoneStatus = null;
        this.zoneTimeoutId = null;
        this.actualZoneInfo = null;

        if (actualZoneInfo !== null){
          if (JSON.stringify(zoneStatus) === JSON.stringify(actualZoneInfo)){
            this.log.debug('setZoneStatus: no zone update needed');
            return;
          }
        }

        await this.zoneInfoMutex.runExclusive(async () => {
          const op = operation({
            retries: 3,
            factor: 2,
            minTimeout: 5000,
            maxTimeout: 60000,
          });

          op.attempt(async() => {
            try {
              const resp = await this.http.get(
                `${this.set_zone_setting}?zone_name=${zoneStatus?.zone_name}&zone_onoff=${zoneStatus?.zone_onoff}`,
                {cache: false });
              const data = this.parseResponse(resp.data);
              if (resp.status === 200 && data['ret'] === 'OK') {
                this.log.info('setZoneStatus: successfully updated zone info.');
              } else {
                throw Error(`failed to update zone info. ${resp.data}`);
              }
            } catch (error) {
              this.log.error('setZoneStatus error: ' + error);
              if (op.retry(error)) {
                return;
              }
              this.log.error('failed to update zone status');
              this.acStateCache.set(this.get_zone_setting, actualZoneInfo as ZoneInfo);
            } finally {
              clearTimeout(zoneTimeoutId as ReturnType<typeof setTimeout>);
            }
          });
        });
      }, 2000);
    }
  }

  addPowerSubscriber(func: () => void) : void{
    this.powerSubscribers.push(func);
  }

  private parseResponse(response: string) : object {
    const vals = {};
    if (response) {
      const items = response.split(',');
      const length = items.length;
      for (let i = 0; i < length; i++) {
        const keyValue = items[i].split('=');
        if (isNaN(+keyValue[1])) {
          vals[keyValue[0]] = keyValue[1];
        } else {
          vals[keyValue[0]] = +keyValue[1];
        }
      }
    }
    return vals;
  }
}
