/**
 * scratch.ts — interactive terminal REPL for testing Atlas end-to-end.
 * Run with: npm run scratch
 *
 * Type a message and press Enter to chat with Atlas.
 * Type "exit" or press Ctrl+C to quit.
 * Type "reset" to clear the session history and start fresh.
 */

import * as readline from "readline";
import { config } from "./config";
import { initWorkspace } from "./workspace";
import { runAgentLoop } from "./agent/loop";
import { resetSession } from "./agent/history";

const AGENT_ID = config.defaultAgent;
const AGENT_CONFIG = config.agents[AGENT_ID];

async function main() {
  // Ensure workspace dirs and soul files exist
  initWorkspace();

  console.log(`\n🤖 Atlas terminal — talking to agent: "${AGENT_CONFIG.name}" (${AGENT_ID})`);
  console.log(`   Session: ${AGENT_CONFIG.sessionPrefix}`);
  console.log(`   Workspace: ${config.workspaceDir}`);
  console.log(`   Type "exit" to quit, "reset" to clear session history.\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("You: ", async (input) => {
      const message = input.trim();

      if (!message) {
        prompt();
        return;
      }

      if (message.toLowerCase() === "exit") {
        console.log("Goodbye.");
        rl.close();
        process.exit(0);
      }

      if (message.toLowerCase() === "reset") {
        resetSession(AGENT_CONFIG.sessionPrefix);
        console.log("Session reset. Starting fresh.\n");
        prompt();
        return;
      }

      try {
        // Confirm callback for destructive commands — asks via readline
        const confirm = (command: string): Promise<boolean | "always"> => {
          return new Promise((resolve) => {
            rl.question(
              `\n⚠️  Atlas wants to run: ${command}\nApprove? (yes / always / no): `,
              (answer) => {
                const a = answer.trim().toLowerCase();
                if (a === "always") resolve("always");
                else if (a === "yes" || a === "y") resolve(true);
                else resolve(false);
              }
            );
          });
        };

        process.stdout.write(`\n${AGENT_CONFIG.name}: `);
        const response = await runAgentLoop(AGENT_ID, AGENT_CONFIG, message, confirm);
        console.log(response);
        console.log();
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
