import { useEffect, useRef, useState } from "react";
import { SendHorizonal } from "lucide-react";
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
// ChatInput — textarea + send button
// ---------------------------------------------------------------------------

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  connected?: boolean;
}

export function ChatInput({
  onSend,
  disabled = false,
  connected = true,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useAutoResize(inputRef, input);

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
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        disabled={isDisabled}
        rows={1}
        className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none disabled:cursor-not-allowed min-h-[3.5rem]"
      />

      <div className="flex items-center justify-end px-2 pb-2">
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
