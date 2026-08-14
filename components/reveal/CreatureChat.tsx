"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircleIcon, SendIcon, XIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Language, UniverseReveal } from "@/types/universe";

interface CreatureChatProps {
  reveal: UniverseReveal;
  language: Language;
  /** When true, the chat panel is open. Controlled by parent. */
  isOpen?: boolean;
  /** Called when the open state changes. */
  onOpenChange?: (open: boolean) => void;
}

interface ChatEntry {
  role: "user" | "creature";
  content: string;
}

function getSessionId(): string {
  if (typeof window === "undefined") return "";
  const key = "galaxique-chat-session";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export function CreatureChat({ reveal, language, isOpen: controlledIsOpen, onOpenChange }: CreatureChatProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledIsOpen ?? internalOpen;
  const setIsOpen = (v: boolean) => { setInternalOpen(v); onOpenChange?.(v); };
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setSessionId(getSessionId()); }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const creatureName = reveal.creature?.name ?? (language === "th" ? "เพื่อนคู่ใจ" : "Companion");

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || !sessionId) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsLoading(true);
    try {
      const res = await fetch("/api/creature-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text, reveal, language }),
      });
      const data = await res.json();
      if (data.success && data.response) {
        setMessages((prev) => [...prev, { role: "creature", content: data.response }]);
      } else {
        const fallback = language === "th" ? "*เอ่อ... ดาวตกขัดจังหวะ เดี๋ยวพูดใหม่นะ*" : "*a shooting star interrupted — ask me again?*";
        setMessages((prev) => [...prev, { role: "creature", content: fallback }]);
      }
    } catch {
      const fallback = language === "th" ? "*สัญญาณไม่ดี ลองใหม่นะ*" : "*the cosmic signal is weak... try again*";
      setMessages((prev) => [...prev, { role: "creature", content: fallback }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId, reveal, language]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
  };

  const greeting = language === "th"
    ? `สวัสดี! ฉันชื่อ${creatureName} ✨ มีอะไรอยากคุยด้วยไหม?`
    : `Hey! I'm ${creatureName} ✨ I'm your cosmic companion. Want to talk?`;

  const primaryColor = reveal.primary_color ?? "#7c3aed";

  return (
    <>
      {/* Chat trigger — glowing, animated, impossible to miss */}
      <motion.button
        type="button"
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 left-4 z-40 flex items-center gap-2 rounded-full border border-white/20 px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur-md transition-all hover:brightness-110"
        style={{
          backgroundColor: primaryColor + "cc",
          color: "#fff",
          boxShadow: `0 0 20px ${primaryColor}60, 0 0 40px ${primaryColor}30`,
        }}
        initial={{ opacity: 0, y: 20, scale: 0.8 }}
        animate={{
          opacity: 1,
          y: [0, -4, 0],
          scale: 1,
        }}
        transition={{
          opacity: { duration: 0.4 },
          y: { duration: 2, repeat: Infinity, ease: "easeInOut" },
          scale: { duration: 0.4 },
        }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        aria-label={language === "th" ? `คุยกับ${creatureName}` : `Chat with ${creatureName}`}
      >
        <MessageCircleIcon className="size-5" />
        <span className="hidden sm:inline">{creatureName}</span>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed bottom-4 left-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/95 shadow-2xl backdrop-blur-xl sm:bottom-6 sm:left-6"
          >
            <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary" />
                <span className="text-sm font-semibold">{creatureName}</span>
              </div>
              <button type="button" onClick={() => setIsOpen(false)}
                className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label={language === "th" ? "ปิด" : "Close"}>
                <XIcon className="size-4" />
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ maxHeight: "min(400px, 60vh)" }}>
              {messages.length === 0 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted/50 px-3 py-2 text-sm leading-relaxed text-foreground/90">{greeting}</div>
                </div>
              )}
              {messages.map((msg, i) => (
                <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    msg.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted/50 text-foreground/90"
                  }`}>{msg.content}</div>
                </motion.div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    <span className="inline-flex gap-1">
                      <span className="animate-bounce [animation-delay:0ms]">·</span>
                      <span className="animate-bounce [animation-delay:150ms]">·</span>
                      <span className="animate-bounce [animation-delay:300ms]">·</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2">
              <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={language === "th" ? `พูดกับ${creatureName}...` : `Say something to ${creatureName}...`}
                maxLength={500}
                className="flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none" />
              <Button size="sm" variant="ghost" onClick={() => void sendMessage()}
                disabled={!input.trim() || isLoading} className="size-8 p-0">
                <SendIcon className="size-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
