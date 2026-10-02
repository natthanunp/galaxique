"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CheckIcon, CopyIcon, GlobeIcon, Loader2Icon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getOwnedWorlds, manageLink, saveOwnedWorld } from "@/lib/ownedWorlds";
import { useQuizStore } from "@/store/quizStore";
import type { Language, UniverseReveal } from "@/types/universe";

const T = {
  en: {
    retry: "Share my world",
    publishing: "Sharing your world…",
    live: "Your world is live",
    title: "Your world is live!",
    body: "Visitors can land on your planet, meet your companion and hear your song. Your quiz answers and chats are never shared.",
    visit: "Visit my world",
    manage: "Save this private link to manage or unpublish your world from another device:",
    copy: "Copy link",
    copied: "Copied",
    failed: "Could not share your world. Tap to try again.",
  },
  th: {
    retry: "แชร์โลกของฉัน",
    publishing: "กำลังแชร์โลกของคุณ…",
    live: "โลกของคุณออนไลน์แล้ว",
    title: "โลกของคุณออนไลน์แล้ว!",
    body: "ผู้มาเยือนจะลงจอดบนดาวของคุณ ทักทายเพื่อนคู่ใจ และฟังเพลงของคุณได้ คำตอบแบบทดสอบและบทสนทนาจะไม่ถูกเปิดเผย",
    visit: "ไปที่โลกของฉัน",
    manage: "เก็บลิงก์ส่วนตัวนี้ไว้จัดการหรือยกเลิกการเผยแพร่จากอุปกรณ์อื่น:",
    copy: "คัดลอกลิงก์",
    copied: "คัดลอกแล้ว",
    failed: "แชร์โลกไม่สำเร็จ แตะเพื่อลองอีกครั้ง",
  },
};

type State = { phase: "idle" | "busy" | "failed" } | { phase: "live"; id: string; link: string };

/** Shares the reveal as a public world as soon as it is created. */
export function PublishWorld({ reveal, language }: { reveal: UniverseReveal; language: Language }) {
  const t = T[language];
  const revealToken = useQuizStore((s) => s.revealToken);
  const [state, setState] = useState<State>({ phase: "idle" });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const attempted = useRef<string | null>(null);

  const publish = useCallback(async () => {
    if (!reveal.reveal_id || !revealToken) return;
    setState({ phase: "busy" });
    // The reading is left out only if it appears to contain contact details.
    for (const includeReading of [true, false]) {
      try {
        const res = await fetch("/api/worlds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revealId: reveal.reveal_id, revealToken, includeReading }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          saveOwnedWorld(data.world.id, data.ownerToken);
          setState({ phase: "live", id: data.world.id, link: manageLink(data.world.id, data.ownerToken) });
          return;
        }
        if (data.error === "already_published" && data.id) {
          const token = getOwnedWorlds()[data.id];
          setState({ phase: "live", id: data.id, link: token ? manageLink(data.id, token) : "" });
          return;
        }
        if (data.error !== "personal_info") break;
      } catch {
        break;
      }
    }
    setState({ phase: "failed" });
  }, [reveal.reveal_id, revealToken]);

  useEffect(() => {
    if (!reveal.reveal_id || !revealToken || attempted.current === reveal.reveal_id) return;
    attempted.current = reveal.reveal_id;
    void publish();
  }, [reveal.reveal_id, revealToken, publish]);

  if (!reveal.reveal_id || !revealToken) return null;

  const pill = "pointer-events-auto gap-1.5 rounded-full bg-card/60 ring-1 ring-white/10 backdrop-blur-md";
  const live = state.phase === "live" ? state : null;

  return (
    <>
      {state.phase === "failed" ? (
        <Button variant="ghost" size="sm" className={pill} onClick={() => void publish()}>
          <GlobeIcon className="size-4" /> {t.failed}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className={pill} disabled={!live} onClick={() => setOpen(true)}>
          {live ? <GlobeIcon className="size-4" /> : <Loader2Icon className="size-4 animate-spin" />}
          {live ? t.live : t.publishing}
        </Button>
      )}
      <AnimatePresence>
        {open && live && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
            onClick={() => setOpen(false)}>
            <motion.div role="dialog" aria-modal="true" aria-labelledby="publish-title"
              initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-t-2xl border border-border/50 bg-card/95 p-5 shadow-2xl backdrop-blur-xl sm:rounded-2xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 id="publish-title" className="text-base font-semibold">{t.title}</h2>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 hover:bg-muted">
                  <XIcon className="size-4" />
                </button>
              </div>
              <p className="mb-4 text-sm text-muted-foreground">{t.body}</p>
              {live.link && (
                <div className="mb-4">
                  <p className="mb-2 text-sm text-muted-foreground">{t.manage}</p>
                  <div className="flex gap-2">
                    <input readOnly value={live.link} className="min-w-0 flex-1 rounded-md bg-black/40 px-2 py-1 text-xs" />
                    <Button size="sm" variant="secondary" onClick={() => {
                      void navigator.clipboard.writeText(live.link).then(() => setCopied(true));
                    }}>
                      {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                      <span className="sr-only">{copied ? t.copied : t.copy}</span>
                    </Button>
                  </div>
                </div>
              )}
              <Button asChild className="w-full"><Link href={`/w/${live.id}`}>{t.visit}</Link></Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
