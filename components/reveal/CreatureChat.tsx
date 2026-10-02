"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SendIcon, XIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useQuizStore } from "@/store/quizStore";
import type { Language, UniverseReveal } from "@/types/universe";

interface CreatureChatProps {
  reveal: UniverseReveal;
  language: Language;
  /** Whether the chat panel is open. Fully controlled by the parent page. */
  isOpen: boolean;
  /** Called when the open state should change (close button, backdrop click). */
  onOpenChange: (open: boolean) => void;
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

export function CreatureChat({ reveal, language, isOpen, onOpenChange }: CreatureChatProps) {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const revealToken = useQuizStore((s) => s.revealToken);
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
  // Readings made before server-side storage have no token and cannot be verified.
  const chatAvailable = Boolean(reveal.reveal_id && revealToken);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading || !sessionId || !chatAvailable) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setIsLoading(true);
    try {
      const res = await fetch("/api/creature-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text, revealId: reveal.reveal_id, revealToken, language }),
      });
      const data = await res.json();
      if (data.success && data.response) {
        setMessages((prev) => [...prev, { role: "creature", content: data.response }]);
      } else {
        const fallback = res.status === 429
          ? (language === "th" ? "*ขอพักหายใจแป๊บนึงนะ เดี๋ยวค่อยคุยกันต่อ*" : "*let me catch my breath — talk again in a moment?*")
          : res.status === 404
            ? (language === "th" ? "*ฉันหาจักรวาลนี้ไม่เจอแล้ว ลองทำแบบทดสอบใหม่นะ*" : "*I can't find this universe anymore — try a new reading?*")
            : (language === "th" ? "*เอ่อ... ดาวตกขัดจังหวะ เดี๋ยวพูดใหม่นะ*" : "*a shooting star interrupted — ask me again?*");
        setMessages((prev) => [...prev, { role: "creature", content: fallback }]);
      }
    } catch {
      const fallback = language === "th" ? "*สัญญาณไม่ดี ลองใหม่นะ*" : "*the cosmic signal is weak... try again*";
      setMessages((prev) => [...prev, { role: "creature", content: fallback }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId, chatAvailable, reveal.reveal_id, revealToken, language]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(); }
  };

  const greeting = !chatAvailable
    ? (language === "th"
        ? `สวัสดี! ฉันชื่อ${creatureName} ✨ จักรวาลนี้สร้างก่อนที่ฉันจะคุยได้ ทำแบบทดสอบใหม่แล้วมาคุยกันนะ`
        : `Hey! I'm ${creatureName} ✨ This universe was made before I could talk — take a new reading to chat with me.`)
    : language === "th"
      ? `สวัสดี! ฉันชื่อ${creatureName} ✨ มีอะไรอยากคุยด้วยไหม?`
      : `Hey! I'm ${creatureName} ✨ I'm your cosmic companion. Want to talk?`;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — dims the page and closes the panel on click-outside */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
            aria-hidden
          />

          {/* Panel — bottom sheet on mobile, centered modal from sm: up */}
          <motion.div
            initial={{ opacity: 0, y: "100%" }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: "100%" }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border/50 bg-card/95 shadow-2xl backdrop-blur-xl sm:inset-0 sm:m-auto sm:h-fit sm:max-h-150 sm:w-105 sm:max-w-[90vw] sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={creatureName}
          >
            <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <SparklesIcon className="size-4 text-primary" />
                <span className="text-sm font-semibold">{creatureName}</span>
              </div>
              <button type="button" onClick={() => onOpenChange(false)}
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

            <div className="flex items-center gap-2 border-t border-border/30 px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              {/* text-base (16px) prevents iOS Safari's auto-zoom-on-focus; autoComplete="off" stops the "AutoFill Contact" QuickType bar */}
              <input ref={inputRef} type="text" value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="off"
                placeholder={language === "th" ? `พูดกับ ${creatureName}...` : `Say something to ${creatureName}...`}
                maxLength={500}
                disabled={!chatAvailable}
                className="flex-1 bg-transparent px-2 py-1.5 text-base text-foreground placeholder:text-muted-foreground outline-none" />
              <Button size="sm" variant="ghost" onClick={() => void sendMessage()}
                disabled={!input.trim() || isLoading} className="size-8 p-0">
                <SendIcon className="size-4" />
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
