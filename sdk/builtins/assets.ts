export interface AssetOptions {
  readonly index?: string;
  readonly spaFallback?: boolean;
}

export interface AssetStore {
  fetch(request: Request | object): Response;
}

export declare function openAssets(name: string, options?: AssetOptions): AssetStore;
