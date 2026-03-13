import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

const approvalsPath = path.join(config.workspaceDir, "exec-approvals.json");

type ApprovalsMap = Record<string, string[]>;

function loadApprovals(): ApprovalsMap {
  if (!fs.existsSync(approvalsPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(approvalsPath, "utf-8")) as ApprovalsMap;
  } catch {
    return {};
  }
}

function saveApprovals(approvals: ApprovalsMap): void {
  fs.writeFileSync(approvalsPath, JSON.stringify(approvals, null, 2), "utf-8");
}

/** Checks if a binary is permanently approved for the given agent. */
export function isApproved(agentId: string, bin: string): boolean {
  const approvals = loadApprovals();
  return (approvals[agentId] ?? []).includes(bin);
}

/** Permanently approves a binary for the given agent. Deduplicates. */
export function permanentlyApprove(agentId: string, bin: string): void {
  const approvals = loadApprovals();
  if (!approvals[agentId]) approvals[agentId] = [];
  if (!approvals[agentId].includes(bin)) {
    approvals[agentId].push(bin);
    saveApprovals(approvals);
    console.log(`[approvals] Permanently approved "${bin}" for ${agentId}`);
  }
}
