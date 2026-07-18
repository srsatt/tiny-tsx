declare module "hono/secure-headers" {
  import type {HonoMiddlewareApi} from "hono";

  export interface SecureHeadersOptions {
    crossOriginEmbedderPolicy?: boolean | string;
    crossOriginResourcePolicy?: boolean | string;
    crossOriginOpenerPolicy?: boolean | string;
    originAgentCluster?: boolean | string;
    referrerPolicy?: boolean | string;
    strictTransportSecurity?: boolean | string;
    xContentTypeOptions?: boolean | string;
    xDnsPrefetchControl?: boolean | string;
    xDownloadOptions?: boolean | string;
    xFrameOptions?: boolean | string;
    xPermittedCrossDomainPolicies?: boolean | string;
    xXssProtection?: boolean | string;
    removePoweredBy?: boolean;
  }

  export function secureHeaders(options?: SecureHeadersOptions): HonoMiddlewareApi;
}
