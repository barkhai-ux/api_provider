// Generates the RS256 key pair Convex Auth signs session JWTs with.
// Prints two lines: JWT_PRIVATE_KEY (PKCS#8, newlines as spaces) and JWKS.
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const jwk = publicKey.export({ format: "jwk" });

process.stdout.write(`${pem.trimEnd().replace(/\n/g, " ")}\n`);
process.stdout.write(`${JSON.stringify({ keys: [{ use: "sig", alg: "RS256", ...jwk }] })}\n`);
