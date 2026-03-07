import type { ToolDefinition } from "../providers";
import { loadSkillBody } from "../agent/skills";

// ---------------------------------------------------------------------------
// load_skill tool — on-demand skill activation (Stage 2)
// ---------------------------------------------------------------------------

export const loadSkillToolDefinition: ToolDefinition = {
  name: "load_skill",
  description:
    "Load the full instructions for a skill by name. " +
    "Use this when you see a relevant skill in the Available Skills catalog " +
    "and want to activate it for the current conversation. " +
    "Returns the skill's detailed instructions.",
  input_schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The skill name from the catalog (e.g. 'web-search', 'agent-browser')",
      },
    },
    required: ["name"],
  },
};

export function loadSkill(name: string, agentId: string): string {
  const body = loadSkillBody(name, agentId);
  if (!body) {
    return `[skill error] Skill "${name}" not found or not available.`;
  }
  console.log(`[skills] ${name}: activated by agent`);
  return body;
}
