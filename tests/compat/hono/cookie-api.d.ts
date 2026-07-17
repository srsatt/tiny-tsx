import type {HonoContextApi} from "hono";

export interface CookieOptionsApi {
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None" | "strict" | "lax" | "none";
}

export function generateCookie(
  name: string,
  value: string,
  options?: CookieOptionsApi,
): string;

export function setCookie(
  context: HonoContextApi,
  name: string,
  value: string,
  options?: CookieOptionsApi,
): void;

export function getCookie(context: HonoContextApi, name: string): string | undefined;
