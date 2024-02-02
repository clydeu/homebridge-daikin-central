import axios, { AxiosInstance }  from 'axios';
import { Logger } from 'homebridge';

export class HttpLogService{
  private readonly http: AxiosInstance;
  constructor(
    public readonly url: string,
    private readonly log: Logger
  ) {
    const myURL = new URL(url);
    this.http = axios.create({
      timeout: 1000,
      headers: {
        'User-Agent': 'axios',
        'Host': myURL.hostname,
      }
    });
  }

  async logTempReading(reading: number) : Promise<void>{
    try {
      this.log.debug('logTempReading: ' + reading);
      await this.http.post(this.url, {
        sensor: 'DAIKINCENTRAL',
        measurement: 'Temperature',
        value: reading,
      });
    } catch (error) {
      this.log.error('logTempReading error: ' + error);
    }

  }
}