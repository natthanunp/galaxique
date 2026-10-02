"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Canvas, useThree } from "@react-three/fiber";
import { ArrowLeftIcon, ChevronDownIcon, ChevronUpIcon, FlagIcon, SendIcon, SettingsIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LandingScene, STAGE_SECONDS, type LandingStage } from "@/components/landing/LandingScene";
import { VinylDisc } from "@/components/reveal/VinylDisc";
import { PersonalityReading } from "@/components/reveal/PersonalityReading";
import { forgetOwnedWorld, getOwnedWorlds, manageLink, saveOwnedWorld } from "@/lib/ownedWorlds";
import { targetDpr, tierDprCap } from "@/lib/perf";
import { cn } from "@/lib/utils";
import { useSoundtrack } from "@/lib/soundtrack";
import { useSceneActivity } from "@/lib/useSceneActivity";
import { useMediaStore } from "@/store/mediaStore";
import { usePerfStore } from "@/store/perfStore";
import { useQuizStore } from "@/store/quizStore";
import type { CreatureController } from "@/three/objects/SurfaceCreature";
import type { BehaviorStateName, Emotion } from "@/three/creature/behavior";
import type { WorldSnapshot } from "@/lib/worldStore";

interface Message { role: "visitor" | "creature"; text: string }

const STRINGS = {
  en: {
    back: "Back to the galaxy", skip: "Skip", report: "Report", manage: "Manage", typing: "Say something…",
    send: "Send", unavailable: "This world isn't available.", republish: "Republish", unpublish: "Unpublish", delete: "Delete world",
    confirmDelete: "Delete this world permanently?", copy: "Copy manage link", reported: "Thanks — this world is hidden while it's reviewed.",
    reporting: "Sending report…", reportFailed: "Report could not be sent. Please try again.",
    reasons: { personal_info: "Personal information", offensive: "Offensive", spam: "Spam", other: "Something else" },
    reportTitle: "Report this world", cancel: "Cancel", failed: "*the signal faded… try again?*", slow: "*catching my breath — try again in a moment*",
    reading: "This world's reading", looks: (name: string, r: string) => `${name} looks ${r}`, listening: (name: string) => `${name} is listening`,
  },
  th: {
    back: "กลับสู่กาแล็กซี", skip: "ข้าม", report: "รายงาน", manage: "จัดการ", typing: "พูดอะไรสักหน่อย…",
    send: "ส่ง", unavailable: "โลกนี้ไม่พร้อมให้เยี่ยมชม", republish: "เผยแพร่อีกครั้ง", unpublish: "ยกเลิกการเผยแพร่", delete: "ลบโลกนี้",
    confirmDelete: "ลบโลกนี้ถาวรใช่ไหม?", copy: "คัดลอกลิงก์จัดการ", reported: "ขอบคุณ — โลกนี้ถูกซ่อนระหว่างการตรวจสอบ",
    reporting: "กำลังส่งรายงาน…", reportFailed: "ส่งรายงานไม่สำเร็จ กรุณาลองอีกครั้ง",
    reasons: { personal_info: "ข้อมูลส่วนตัว", offensive: "ไม่เหมาะสม", spam: "สแปม", other: "อื่น ๆ" },
    reportTitle: "รายงานโลกนี้", cancel: "ยกเลิก", failed: "*สัญญาณหายไป... ลองอีกทีนะ*", slow: "*ขอพักหายใจแป๊บ เดี๋ยวคุยกันต่อ*",
    reading: "คำทำนายของโลกนี้", looks: (name: string, r: string) => `${name} ดู${r}`, listening: (name: string) => `${name} กำลังฟังอยู่`,
  },
};
const REACTION_WORDS: Record<string, { en: string; th: string }> = {
  happy: { en: "happy", th: "มีความสุข" }, shy: { en: "shy", th: "เขิน" }, curious: { en: "curious", th: "อยากรู้" },
  sleepy: { en: "sleepy", th: "ง่วง" }, excited: { en: "excited", th: "ตื่นเต้น" }, dizzy: { en: "dizzy", th: "มึน" },
};

function useOwnerToken(worldId: string) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    // A manage link carries the token in the fragment; move it into storage and clean the URL.
    const match = window.location.hash.match(/manage=([\w-]{16,128})/);
    if (match) {
      saveOwnedWorld(worldId, match[1]);
      history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(getOwnedWorlds()[worldId] ?? null);
  }, [worldId]);
  return token;
}

function OwnerPanel({ worldId, token, published, language }: { worldId: string; token: string; published: boolean; language: "en" | "th" }) {
  const t = STRINGS[language];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const call = async (method: "PATCH" | "DELETE", body?: unknown) => {
    const res = await fetch(`/api/worlds/${worldId}`, {
      method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  };
  return (
    <div className="relative">
      <Button size="sm" variant="ghost" className="gap-1 rounded-full bg-card/60 backdrop-blur" onClick={() => setOpen((v) => !v)}>
        <SettingsIcon className="size-4" /> {t.manage}
      </Button>
      {open && (
        <div className="absolute right-0 top-10 z-40 flex w-56 flex-col gap-1 rounded-xl border border-white/10 bg-card/95 p-2 text-sm shadow-xl">
          <button className="rounded px-2 py-1.5 text-left hover:bg-muted" onClick={async () => { if (await call("PATCH", { published: !published })) router.refresh(); }}>
            {published ? t.unpublish : t.republish}
          </button>
          <button className="rounded px-2 py-1.5 text-left hover:bg-muted" onClick={() => void navigator.clipboard.writeText(manageLink(worldId, token))}>{t.copy}</button>
          <button className="rounded px-2 py-1.5 text-left text-red-300 hover:bg-muted" onClick={async () => {
            if (!confirm(t.confirmDelete)) return;
            if (await call("DELETE")) { forgetOwnedWorld(worldId); router.push("/"); }
          }}>{t.delete}</button>
        </div>
      )}
    </div>
  );
}

export function PlanetLanding({ worldId, world }: { worldId: string; world: WorldSnapshot | null }) {
  const router = useRouter();
  const language = useQuizStore((s) => s.language);
  const t = STRINGS[language];
  const ownerToken = useOwnerToken(worldId);
  const animate = useSceneActivity();
  const tier = usePerfStore((state) => state.tier);
  useEffect(() => { usePerfStore.getState().initialize(); }, []);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [readingOpen, setReadingOpen] = useState(false);
  const chatScroll = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<LandingStage>("approach");
  const stageStart = useRef(0);
  const [veil, setVeil] = useState(0);
  const controller = useRef<CreatureController | null>(null);
  const [creatureState, setCreatureState] = useState<BehaviorStateName>("idle");
  const [cue, setCue] = useState("");
  const [greeting, setGreeting] = useState<{ text: string; emotion: Emotion } | null>(null);
  const [visitorId, setVisitorId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [shown, setShown] = useState<{ index: number; chars: number } | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const songPlaying = useMediaStore((s) => s.mode === "spotify" && s.previewAudible);
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState("");
  const [quiet] = useState(() => !!world && Date.now() - world.createdAt > 14 * 86_400_000);
  const typingTimer = useRef<number | undefined>(undefined);
  const abort = useRef<AbortController | null>(null);

  useSoundtrack(stage === "surface" ? "surface" : "approach", songPlaying);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReducedMotion(reduce);
    if (reduce) setStage("surface");
    return () => abort.current?.abort();
  }, []);

  useEffect(() => {
    const query = matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight });
  }, [messages, shown, pending]);

  const toSurface = useCallback(() => {
    setStage("surface");
    setVeil(0);
  }, []);

  // Approach → descent → surface; each stage can be skipped.
  useEffect(() => {
    if (!world || stage === "surface") return;
    const ms = (stage === "approach" ? STAGE_SECONDS.approach : STAGE_SECONDS.descent) * 1000;
    if (stage === "descent") requestAnimationFrame(() => setVeil(1));
    const timer = window.setTimeout(() => (stage === "approach" ? setStage("descent") : toSurface()), ms);
    return () => window.clearTimeout(timer);
  }, [stage, world, toSurface]);

  // Arrival: fetch the greeting (never on hover) and let the creature notice the visitor.
  useEffect(() => {
    if (!world || stage !== "surface") return;
    const stored = sessionStorage.getItem(`galaxique-visitor:${worldId}`) ?? "";
    fetch(`/api/worlds/${worldId}/greeting?lang=${language}&visitor=${stored}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) return;
        setVisitorId(data.visitorId);
        sessionStorage.setItem(`galaxique-visitor:${worldId}`, data.visitorId);
        setGreeting({ text: data.text, emotion: data.emotion });
      })
      .catch(() => setGreeting({ text: language === "th" ? `สวัสดี! ฉันชื่อ${world.creature.name} ✨` : `Hi! I'm ${world.creature.name} ✨`, emotion: "happy" }));
    const timer = window.setTimeout(() => controller.current?.dispatch({ type: "arrive" }), 600);
    return () => window.clearTimeout(timer);
  }, [stage, world, worldId, language]);

  // The greeting appears in sync with the greet animation (or shortly after, as a fallback).
  useEffect(() => {
    if (!greeting || messages.length) return;
    const show = () => setMessages([{ role: "creature", text: greeting.text }]);
    if (creatureState === "greet") show();
    const fallback = window.setTimeout(show, 4000);
    return () => window.clearTimeout(fallback);
  }, [greeting, creatureState, messages.length]);

  // Typewriter for the newest creature message; "talk" plays while it streams.
  useEffect(() => {
    const index = messages.length - 1;
    if (index < 0 || messages[index].role !== "creature") return;
    const full = messages[index].text;
    const isGreeting = index === 0;
    if (!isGreeting) controller.current?.dispatch({ type: "talkStart" });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown({ index, chars: reducedMotion ? full.length : 0 });
    if (reducedMotion) return;
    const timer = window.setInterval(() => {
      setShown((s) => {
        if (!s || s.index !== index) return s;
        const chars = Math.min(full.length, s.chars + 2);
        if (chars >= full.length) window.clearInterval(timer);
        return { index, chars };
      });
    }, 30);
    return () => window.clearInterval(timer);
  }, [messages, reducedMotion]);

  const lastEmotion = useRef<Emotion>("neutral");
  useEffect(() => {
    const index = messages.length - 1;
    if (!shown || index < 1 || shown.index !== index || shown.chars < messages[index].text.length) return;
    controller.current?.dispatch({ type: "talkEnd", emotion: lastEmotion.current });
  }, [shown, messages]);

  const onCreatureState = useCallback((state: BehaviorStateName, reaction?: string) => {
    setCreatureState(state);
    if (!world) return;
    if (state === "react" && reaction && REACTION_WORDS[reaction]) setCue(t.looks(world.creature.name, REACTION_WORDS[reaction][language]));
    else if (state === "listen") setCue(t.listening(world.creature.name));
  }, [world, t, language]);

  const send = async () => {
    const text = input.trim();
    if (!text || pending || !visitorId) return;
    setInput("");
    controller.current?.dispatch({ type: "typing", active: false });
    setMessages((m) => [...m, { role: "visitor", text }]);
    setPending(true);
    abort.current?.abort();
    abort.current = new AbortController();
    try {
      const res = await fetch(`/api/worlds/${worldId}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal,
        body: JSON.stringify({ visitorId, message: text, language }),
      });
      const data = await res.json();
      lastEmotion.current = data.emotion ?? "neutral";
      setMessages((m) => [...m, { role: "creature", text: data.success ? data.response : res.status === 429 ? t.slow : t.failed }]);
    } catch (error) {
      if ((error as Error).name !== "AbortError") setMessages((m) => [...m, { role: "creature", text: t.failed }]);
    } finally {
      setPending(false);
    }
  };

  const onType = (value: string) => {
    setInput(value);
    controller.current?.dispatch({ type: "typing", active: value.length > 0 });
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => controller.current?.dispatch({ type: "typing", active: false }), 2500);
  };

  const back = () => {
    if (document.referrer.startsWith(window.location.origin) && history.length > 1) router.back();
    else router.push("/");
  };

  const report = async (reason: string) => {
    setReporting(true);
    setReportError("");
    try {
      const response = await fetch(`/api/worlds/${worldId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) throw new Error("Report request failed");
      setReported(true);
      setReportOpen(false);
    } catch {
      setReportError(t.reportFailed);
    } finally {
      setReporting(false);
    }
  };

  if (!world) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg">{t.unavailable}</p>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => router.push("/")}><ArrowLeftIcon className="size-4" /> {t.back}</Button>
          {ownerToken && <OwnerPanel worldId={worldId} token={ownerToken} published={false} language={language} />}
        </div>
      </main>
    );
  }

  const visible = (m: Message, i: number) => (shown && shown.index === i && m.role === "creature" ? m.text.slice(0, shown.chars) : m.text);

  return (
    <main className="fixed inset-0 overflow-hidden bg-black">
      <Canvas
        shadows
        dpr={tierDprCap(tier, targetDpr())}
        frameloop={animate || stage !== "surface" ? "always" : "demand"}
        camera={{ position: [0, 4, 36], fov: 50, near: 0.05, far: 300 }}
        onCreated={({ clock }) => { stageStart.current = clock.elapsedTime; }}
      >
        <StageClock stage={stage} stageStart={stageStart} />
        <LandingScene
          world={world}
          stage={stage}
          stageStart={stageStart}
          reducedMotion={reducedMotion}
          active={animate}
          quiet={quiet}
          controller={controller}
          onCreatureState={onCreatureState}
        />
      </Canvas>

      {/* Atmospheric descent veil in the planet's colors. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 transition-opacity duration-700"
        style={{ opacity: veil, background: `radial-gradient(circle at 50% 60%, ${world.planet.secondary_color}cc, ${world.planet.primary_color}ee 55%, #000 100%)` }} />

      <header className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex items-center justify-between gap-2">
        <Button size="sm" variant="ghost" className="gap-1 rounded-full bg-card/60 backdrop-blur" onClick={back}>
          <ArrowLeftIcon className="size-4" /> <span className="hidden sm:inline">{t.back}</span>
        </Button>
        <div className="flex items-center gap-2">
          {stage !== "surface" && <Button size="sm" variant="ghost" className="rounded-full bg-card/60 backdrop-blur" onClick={toSurface}>{t.skip}</Button>}
          {ownerToken ? <OwnerPanel worldId={worldId} token={ownerToken} published language={language} /> : (
            <Button size="sm" variant="ghost" className="gap-1 rounded-full bg-card/60 backdrop-blur" onClick={() => setReportOpen(true)} aria-label={t.report}>
              <FlagIcon className="size-4" />
            </Button>
          )}
        </div>
      </header>

      <p className="sr-only" aria-live="polite">{cue}</p>

      {stage === "surface" && world.song && (
        <div className="pointer-events-none absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+2.75rem)] z-20 flex justify-center lg:inset-x-auto lg:bottom-8 lg:left-8 lg:top-auto lg:justify-start">
          <VinylDisc query={`${world.song.name} ${world.song.artist}`} trackId={world.song.track_id} language={language}
            primaryColor={world.planet.primary_color} size={isDesktop ? "hero" : "mini"} blend={false} className="pointer-events-auto" />
        </div>
      )}

      {stage === "surface" && (
        <section className="pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto flex max-h-[55dvh] w-full max-w-lg flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:inset-x-auto lg:right-20 lg:mx-0 lg:max-w-xl lg:w-[40%]">
          {world.reading && (
            <>
              <button type="button" aria-expanded={readingOpen} onClick={() => setReadingOpen((v) => !v)}
                className="pointer-events-auto flex items-center gap-1 self-start rounded-full bg-card/70 px-3 py-1.5 text-xs backdrop-blur-md lg:hidden">
                {t.reading} {readingOpen ? <ChevronDownIcon className="size-3.5" /> : <ChevronUpIcon className="size-3.5" />}
              </button>
              <PersonalityReading reading={world.reading} vibe={world.scene.vibe} theme={world.scene.theme}
                language={language} className={cn("pointer-events-auto max-h-[28dvh] shrink-0 overflow-y-auto p-3 sm:p-4 lg:block lg:max-h-[24dvh] lg:p-4 [&_p]:text-sm", !readingOpen && "hidden")} />
            </>
          )}
          <div className="pointer-events-auto flex min-h-0 flex-col gap-2 rounded-xl border border-white/10 bg-card/70 p-3 backdrop-blur-md">
            <div ref={chatScroll} className="flex min-h-0 max-h-[15dvh] flex-col gap-2 overflow-y-auto lg:max-h-[30dvh]" aria-live="polite">
            {messages.map((m, i) => (
              <p key={i} className={m.role === "creature" ? "self-start rounded-2xl rounded-bl-md bg-muted/50 px-3 py-2 text-sm" : "self-end rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground"}>
                {m.role === "creature" && <span className="mr-1 font-semibold">{world.creature.name}:</span>}
                {visible(m, i)}
              </p>
            ))}
            {pending && <p className="self-start text-sm text-muted-foreground">…</p>}
            </div>
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <label className="sr-only" htmlFor="visit-chat">{t.typing}</label>
              <input id="visit-chat" value={input} onChange={(e) => onType(e.target.value)} maxLength={500} autoComplete="off"
                placeholder={t.typing} disabled={!visitorId}
                className="min-w-0 flex-1 rounded-md bg-black/30 px-2 py-1.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-primary/60" />
              <Button type="submit" size="sm" disabled={!input.trim() || pending || !visitorId} aria-label={t.send}><SendIcon className="size-4" /></Button>
            </form>
          </div>
        </section>
      )}

      {reported && <p role="status" className="absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-md bg-card/90 px-3 py-2 text-center text-xs text-muted-foreground">{t.reported}</p>}

      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setReportOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label={t.reportTitle} className="w-full max-w-sm rounded-2xl bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 font-semibold">{t.reportTitle}</p>
            {reporting && <p role="status" className="mb-2 text-sm text-muted-foreground">{t.reporting}</p>}
            {reportError && <p role="alert" className="mb-2 text-sm text-red-300">{reportError}</p>}
            <div className="flex flex-col gap-2">
              {(Object.keys(t.reasons) as (keyof typeof t.reasons)[]).map((reason) => (
                <Button key={reason} variant="secondary" disabled={reporting} onClick={() => void report(reason)}>{t.reasons[reason]}</Button>
              ))}
              <Button variant="ghost" disabled={reporting} onClick={() => setReportOpen(false)}>{t.cancel}</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/** Restarts the stage clock whenever the stage changes. */
function StageClock({ stage, stageStart }: { stage: LandingStage; stageStart: React.RefObject<number> }) {
  const get = useThree((s) => s.get);
  useEffect(() => { stageStart.current = get().clock.elapsedTime; }, [stage, stageStart, get]);
  return null;
}
