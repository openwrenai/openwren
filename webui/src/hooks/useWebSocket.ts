import { createContext, useContext, useRef, useEffect, useState, useCallback } from "react";
import type { WsSendMessage, WsServerEvent } from "@/lib/types.ts";

type EventHandler = (event: WsServerEvent) => void;

interface WebSocketContextValue {
  connected: boolean;
  send: (msg: WsSendMessage) => void;
  subscribe: (handler: EventHandler) => () => void;
}

export const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error("useWebSocket must be used within WebSocketProvider");
  return ctx;
}

export function useWebSocketConnection(): WebSocketContextValue {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<EventHandler>>(new Set());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disposedRef = useRef(false);

  const connect = useCallback(() => {
    if (disposedRef.current) return;

    const token = localStorage.getItem("ow_token");
    if (!token) return;

    // Close any existing connection before creating a new one
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const url = `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (disposedRef.current) { ws.close(); return; }
      setConnected(true);
    };

    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as WsServerEvent;
        for (const handler of handlersRef.current) {
          handler(event);
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (!disposedRef.current) {
        reconnectTimerRef.current = setTimeout(connect, 3000);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    connect();
    return () => {
      disposedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]);

  const send = useCallback((msg: WsSendMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const subscribe = useCallback((handler: EventHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  return { connected, send, subscribe };
}
