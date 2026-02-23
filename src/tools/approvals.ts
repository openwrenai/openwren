import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

const approvalsPath = path.join(config.workspaceDir, "exec-approvals.json");

type ApprovalsMap = Record<string, string[]>;

function loadApprovals(): ApprovalsMap {
  if (!fs.existsSync(approvalsPath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(approvalsPath, "utf-8"));
    // Migrate from old flat array format → keyed object
    if (Array.isArray(data)) {
      const migrated: ApprovalsMap = { atlas: data };
      saveApprovals(migrated);
      return migrated;
    }
    return data as ApprovalsMap;
  } catch {
    return {};
  }
}

function saveApprovals(approvals: ApprovalsMap): void {
  fs.writeFileSync(approvalsPath, JSON.stringify(approvals, null, 2), "utf-8");
}

export function isApproved(agentId: string, command: string): boolean {
  const approvals = loadApprovals();
  return (approvals[agentId] ?? []).includes(command);
}

export function permanentlyApprove(agentId: string, command: string): void {
  const approvals = loadApprovals();
  if (!approvals[agentId]) approvals[agentId] = [];
  if (!approvals[agentId].includes(command)) {
    approvals[agentId].push(command);
    saveApprovals(approvals);
    console.log(`[approvals] Permanently approved for ${agentId}: ${command}`);
  }
}
