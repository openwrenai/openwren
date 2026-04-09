import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";

// ---------------------------------------------------------------------------
// Auto-growing textarea hook
// ---------------------------------------------------------------------------

function useAutoResize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [ref, value]);
}

// ---------------------------------------------------------------------------
// ChatInput — composite container with textarea + agent picker
//
// Two modes:
//   "fresh"  — agent dropdown enabled, user picks which agent to chat with
//   "active" — agent dropdown visible but disabled (locked for this session)
//
// Layout:
//   ┌──────────────────────────────────────────┐
//   │                                          │
//   │  Type a message...                       │
//   │                                          │
//   │                              [▾ Atlas ]  │
//   └──────────────────────────────────────────┘
//
// Enter sends, Shift+Enter inserts newline. No send button.
// ---------------------------------------------------------------------------

interface Agent {
  id: string;
  name: string;
}

interface ChatInputProps {
  mode: "fresh" | "active";
  agentId: string;
  onAgentChange: (agentId: string) => void;
  agents: Agent[];
  onSend: (text: string) => void;
  disabled?: boolean;
  connected?: boolean;
}

export function ChatInput({
  mode,
  agentId,
  onAgentChange,
  agents,
  onSend,
  disabled = false,
  connected = true,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(inputRef, input);

  // Auto-focus on mount (fresh mode) and after sending
  useEffect(() => {
    if (mode === "fresh") {
      inputRef.current?.focus();
    }
  }, [mode]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isDisabled = disabled || !connected;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden",
        "focus-within:ring-1 focus-within:ring-ring",
        isDisabled && "opacity-50",
      )}
    >
      {/* Textarea — borderless, fills the container */}
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={isDisabled}
        rows={3}
        className="w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:cursor-not-allowed"
      />

      {/* Bottom row — agent picker right-aligned */}
      <div className="flex items-center justify-end px-3 pb-2">
        <select
          value={agentId}
          onChange={(e) => onAgentChange(e.target.value)}
          disabled={mode === "active" || isDisabled}
          className={cn(
            "px-2 py-1 rounded-md text-xs bg-transparent border border-border/50 text-muted-foreground",
            "focus:outline-none focus:ring-1 focus:ring-ring",
            mode === "active" && "opacity-50 cursor-not-allowed",
          )}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
