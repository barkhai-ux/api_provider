#!/usr/bin/env node
// Prints fresh secrets for a new deployment as KEY=value lines:
//
//   node scripts/generate-secrets.mjs > .env.production   (gitignored)
//
// API_KEY_PEPPER, GATEWAY_SECRET and SITE_API_KEY must be identical in the
// Convex deployment and the API service; SITE_API_KEY also goes to the web
// service. Keep them in your host's secret settings; never commit them.
import { randomBytes, randomInt } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const base62 = (length) => Array.from({ length }, () => BASE62[randomInt(BASE62.length)]).join("");

console.log(`API_KEY_PEPPER=${randomBytes(32).toString("base64url")}`);
console.log(`GATEWAY_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`SITE_API_KEY=geo_${base62(32)}`);
