import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("prune expired usage and rate-limit data", { minutes: 10 }, internal.maintenance.prune, {});

export default crons;
