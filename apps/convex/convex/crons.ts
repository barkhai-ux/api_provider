import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("prune expired usage and rate-limit data", { minutes: 10 }, internal.maintenance.prune, {});
crons.interval("reconcile Wire payments", { minutes: 1 }, internal.payments.reconcilePending, {});

export default crons;
