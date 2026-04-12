import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { MessageSquare } from "lucide-react";
import { api } from "@/lib/api.ts";
import type { AgentChannelsResponse } from "@/lib/types.ts";

interface ChannelsTabProps {
  agentId: string;
  agentName: string;
}

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "Telegram",
  discord: "Discord",
  whatsapp: "WhatsApp",
};

export function ChannelsTab({ agentId, agentName }: ChannelsTabProps) {
  const [channels, setChannels] = useState<AgentChannelsResponse["channels"]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await api.get<AgentChannelsResponse>(`/api/agents/${agentId}/channels`);
      setChannels(res.channels);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    setLoading(true);
    fetchChannels();
  }, [fetchChannels]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground/40">
          Loading...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-medium">Channels</h3>
        <p className="text-sm text-muted-foreground/60 mt-0.5">
          Messaging channels bound to this agent.
        </p>
      </div>

      {channels.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground/40">
            No channels configured for {agentName}.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {channels.map((ch) => (
            <Card key={ch.name}>
              <CardContent className="px-4 py-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <MessageSquare className="h-4 w-4 text-muted-foreground/40" />
                    <div>
                      <h4 className="font-medium text-sm">
                        {CHANNEL_LABELS[ch.name] ?? ch.name}
                      </h4>
                      <p className="text-xs text-muted-foreground/40">{ch.name}</p>
                    </div>
                  </div>
                  <Badge
                    variant="default"
                    className="text-xs bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                  >
                    Connected
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
