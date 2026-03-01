/**
 * scratch.ts — interactive terminal REPL for testing agents end-to-end.
 * Run with: npm run scratch
 *
 * Type a message and press Enter to chat with the default agent (Atlas).
 * Use /<agentId> to talk to other agents: /einstein, /wizard, /personal_trainer
 * Type "exit" or press Ctrl+C to quit.
 * Type "reset" to clear all session histories and start fresh.
 *
 * Scratch sessions use "local" as the userId — separate from real user sessions.
 */

import * as readline from "readline";
import { config, AgentConfig } from "./config";
import { initWorkspace } from "./workspace";
import { runAgentLoop } from "./agent/loop";
import { resetSession } from "./agent/history";

const SCRATCH_USER_ID = "local";

/**
 * Parse /<agentId> prefix from input. If the message starts with a known
 * agent ID (e.g. "/einstein hello"), returns that agent and the rest of the
 * message. Otherwise falls back to the default agent with the full input.
 */
function parseAgentPrefix(text: string): { agentId: string; agentConfig: AgentConfig; message: string } {
  if (text.startsWith("/")) {
    const spaceIdx = text.indexOf(" ");
    const prefix = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
    const agentConfig = config.agents[prefix];
    if (agentConfig) {
      const message = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);
      return { agentId: prefix, agentConfig, message };
    }
  }

  const agentId = config.defaultAgent;
  return { agentId, agentConfig: config.agents[agentId], message: text };
}

async function main() {
  // Ensure workspace dirs and soul files exist
  initWorkspace();

  const defaultAgent = config.agents[config.defaultAgent];
  const agentList = Object.keys(config.agents)
    .filter((id) => id !== config.defaultAgent)
    .map((id) => `/${id} (${config.agents[id].name})`)
    .join(", ");

  console.log(`\n🤖 Terminal REPL — default agent: "${defaultAgent.name}"`);
  console.log(`   Agents: ${agentList || "none"}`);
  console.log(`   Workspace: ${config.workspaceDir}`);
  console.log(`   Type "exit" to quit, "reset" to clear all sessions.\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("You: ", async (input) => {
      const raw = input.trim();

      if (!raw) {
        prompt();
        return;
      }

      if (raw.toLowerCase() === "exit") {
        console.log("Goodbye.");
        rl.close();
        process.exit(0);
      }

      if (raw.toLowerCase() === "reset") {
        for (const agentId of Object.keys(config.agents)) {
          resetSession(SCRATCH_USER_ID, agentId);
        }
        console.log("All sessions reset. Starting fresh.\n");
        prompt();
        return;
      }

      // Parse /<agentId> prefix — falls back to default agent
      const { agentId, agentConfig, message } = parseAgentPrefix(raw);

      if (!message) {
        console.log(`\n${agentConfig.name} is listening. Send a message after the prefix.\n`);
        prompt();
        return;
      }

      try {
        // Confirm callback for destructive commands — asks via readline
        const confirm = (command: string): Promise<boolean | "always"> => {
          return new Promise((resolve) => {
            rl.question(
              `\n⚠️  ${agentConfig.name} wants to run: ${command}\nApprove? (yes / always / no): `,
              (answer) => {
                const a = answer.trim().toLowerCase();
                if (a === "always") resolve("always");
                else if (a === "yes" || a === "y") resolve(true);
                else resolve(false);
              }
            );
          });
        };

        const result = await runAgentLoop(SCRATCH_USER_ID, agentId, agentConfig, message, confirm);

        if (result.compacted) {
          console.log(`\n📦 Session compacted — older messages summarized.`);
        }

        process.stdout.write(`\n${agentConfig.name}: `);
        console.log(result.text);
        console.log();

        if (result.nearThreshold) {
          console.log(`⚠️  Context is almost full — compaction will run soon.\n`);
        }
      } catch (err) {
        console.error("Error:", err);
      }

      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
