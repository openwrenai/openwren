import { config, AgentConfig } from "../config";

export interface RouteResult {
  agentId: string;
  agentConfig: AgentConfig;
  message: string; // with trigger prefix stripped
}

/**
 * Resolves which agent should handle a message based on trigger prefixes.
 *
 * If the message starts with an agent's triggerPrefix (e.g. "/einstein"),
 * that agent handles it and the prefix is stripped from the message.
 * Otherwise, falls back to the default agent.
 */
export function routeMessage(text: string): RouteResult {
  for (const [agentId, agentConfig] of Object.entries(config.agents)) {
    if (!agentConfig.triggerPrefix) continue;

    const prefix = agentConfig.triggerPrefix;

    // Exact match (just the prefix, no message body)
    if (text === prefix) {
      return { agentId, agentConfig, message: "" };
    }

    // Prefix followed by a space — strip prefix and the space
    if (text.startsWith(prefix + " ")) {
      return { agentId, agentConfig, message: text.slice(prefix.length + 1) };
    }
  }

  // No prefix matched — default agent, full message
  const agentId = config.defaultAgent;
  return { agentId, agentConfig: config.agents[agentId], message: text };
}
