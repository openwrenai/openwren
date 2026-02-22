/**
 * scratch.ts — interactive terminal REPL for testing agents end-to-end.
 * Run with: npm run scratch
 *
 * Type a message and press Enter to chat with the default agent (Atlas).
 * Use trigger prefixes to talk to other agents: /einstein, /wizard, /coach
 * Type "exit" or press Ctrl+C to quit.
 * Type "reset" to clear all session histories and start fresh.
 */

import * as readline from "readline";
import { config } from "./config";
import { initWorkspace } from "./workspace";
import { runAgentLoop } from "./agent/loop";
import { resetSession } from "./agent/history";
import { routeMessage } from "./agent/router";

async function main() {
  // Ensure workspace dirs and soul files exist
  initWorkspace();

  const defaultAgent = config.agents[config.defaultAgent];
  const agentList = Object.entries(config.agents)
    .filter(([, a]) => a.triggerPrefix)
    .map(([, a]) => `${a.triggerPrefix} (${a.name})`)
    .join(", ");

  console.log(`\n🤖 Terminal REPL — default agent: "${defaultAgent.name}"`);
  console.log(`   Agents: ${agentList || "none with prefixes"}`);
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
        for (const agentConfig of Object.values(config.agents)) {
          resetSession(agentConfig.sessionPrefix);
        }
        console.log("All sessions reset. Starting fresh.\n");
        prompt();
        return;
      }

      // Route to the correct agent based on prefix
      const { agentId, agentConfig, message } = routeMessage(raw);

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

        const result = await runAgentLoop(agentId, agentConfig, message, confirm);

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
