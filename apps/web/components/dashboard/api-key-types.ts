import type { api } from "@geo-platform/convex/api";
import type { FunctionReturnType } from "convex/server";

export type ApiKey = FunctionReturnType<typeof api.apiKeys.list>[number];
export type RevealedSecret = { name: string; secret: string; regenerated: boolean };
