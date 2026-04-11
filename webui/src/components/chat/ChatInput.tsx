import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check, SendHorizonal } from "lucide-react";
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
// AgentPicker — custom dropdown replacing native <select>
// ---------------------------------------------------------------------------

interface Agent {
  id: string;
  name: string;
}

function AgentPicker({
  agents,
  value,
  onChange,
  disabled,
}: {
  agents: Agent[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = agents.find((a) => a.id === value);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-muted/50",
          disabled && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground",
        )}
      >
        <span>{selected?.name ?? value}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 min-w-[140px] max-h-[240px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg z-50">
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onChange(a.id); setOpen(false); }}
              className={cn(
                "flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs text-left transition-colors",
                a.id === value
                  ? "text-foreground bg-accent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <Check className={cn("h-3 w-3 shrink-0", a.id !== value && "invisible")} />
              {a.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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

  const hasInput = input.trim().length > 0;

    return (
      <div
        className={cn(
        "rounded-2xl border border-border bg-card transition-colors",
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
          rows={mode === "fresh" ? 3 : 1}
          className={cn(
            "w-full resize-none bg-transparent px-4 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:cursor-not-allowed",
            mode === "fresh" ? "pt-3 pb-1" : "pt-2 pb-1",
          )}
        />

        {/* Bottom row — agent picker (fresh only) left, send button right */}
        <div className={cn("flex items-center px-2 pb-2", mode === "fresh" ? "justify-between" : "justify-end")}>
          {mode === "fresh" && (
            <AgentPicker
              agents={agents}
              value={agentId}
              onChange={onAgentChange}
              disabled={isDisabled}
            />
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!hasInput || isDisabled}
            className={cn(
              "flex items-center justify-center size-8 rounded-lg transition-colors",
              hasInput && !isDisabled
                ? "bg-accent text-foreground hover:bg-accent/80 cursor-pointer"
                : "text-muted-foreground/30 cursor-not-allowed",
          )}
          >
            <SendHorizonal className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }
