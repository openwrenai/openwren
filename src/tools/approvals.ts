import * as fs from "fs";
import * as path from "path";
import { config } from "../config";

const approvalsPath = path.join(config.workspaceDir, "exec-approvals.json");

function loadApprovals(): string[] {
  if (!fs.existsSync(approvalsPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(approvalsPath, "utf-8")) as string[];
  } catch {
    return [];
  }
}

function saveApprovals(approvals: string[]): void {
  fs.writeFileSync(approvalsPath, JSON.stringify(approvals, null, 2), "utf-8");
}

export function isApproved(command: string): boolean {
  return loadApprovals().includes(command);
}

export function permanentlyApprove(command: string): void {
  const approvals = loadApprovals();
  if (!approvals.includes(command)) {
    approvals.push(command);
    saveApprovals(approvals);
    console.log(`[approvals] Permanently approved: ${command}`);
  }
}
