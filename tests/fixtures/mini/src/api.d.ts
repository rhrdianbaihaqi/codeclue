export interface Api {
  get(path: string): Promise<string>;
}
export declare function createApi(): Api;
