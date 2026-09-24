/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as gateway from "../gateway.js";
import type * as http from "../http.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_keys from "../lib/keys.js";
import type * as lib_passwordReset from "../lib/passwordReset.js";
import type * as lib_session from "../lib/session.js";
import type * as lib_time from "../lib/time.js";
import type * as maintenance from "../maintenance.js";
import type * as platform from "../platform.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  auth: typeof auth;
  crons: typeof crons;
  gateway: typeof gateway;
  http: typeof http;
  "lib/crypto": typeof lib_crypto;
  "lib/env": typeof lib_env;
  "lib/keys": typeof lib_keys;
  "lib/passwordReset": typeof lib_passwordReset;
  "lib/session": typeof lib_session;
  "lib/time": typeof lib_time;
  maintenance: typeof maintenance;
  platform: typeof platform;
  usage: typeof usage;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
