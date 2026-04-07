import { rootRoute } from "./routes/__root.ts";
import { dashboardLayout } from "./routes/_dashboard.ts";
import { chatLayout } from "./routes/_chat.ts";
import { indexRoute } from "./routes/index.ts";
import { chatRoute } from "./routes/chat.ts";
import { agentsRoute } from "./routes/agents.ts";
import { teamsRoute } from "./routes/teams.ts";
import { workflowsRoute } from "./routes/workflows.ts";
import { schedulesRoute } from "./routes/schedules.ts";
import { skillsRoute } from "./routes/skills.ts";
import { memoryRoute } from "./routes/memory.ts";
import { configRoute } from "./routes/config.ts";
import { usageRoute } from "./routes/usage.ts";
import { logsRoute } from "./routes/logs.ts";
import { approvalsRoute } from "./routes/approvals.ts";

export const routeTree = rootRoute.addChildren([
  dashboardLayout.addChildren([
    indexRoute,
    agentsRoute,
    teamsRoute,
    workflowsRoute,
    schedulesRoute,
    skillsRoute,
    memoryRoute,
    configRoute,
    usageRoute,
    logsRoute,
    approvalsRoute,
  ]),
  chatLayout.addChildren([
    chatRoute,
  ]),
]);
