"use client";

import { useEffect } from "react";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Registers the installable-app worker and makes deploy updates atomic for
 * clients it controls. The worker does not cache pages or API responses: its
 * only job is to detect a new Vercel deployment, take control immediately,
 * and reload the app into one matching client/server version.
 */
export function PwaUpdater() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const hadController = Boolean(navigator.serviceWorker.controller);
    let registration: ServiceWorkerRegistration | undefined;
    let reloadedForUpdate = false;

    const reloadForUpdatedWorker = () => {
      if (!hadController || reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      reloadForUpdatedWorker,
    );

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(async (nextRegistration) => {
        registration = nextRegistration;
        // Check on every fresh load, not only on the browser's 24-hour
        // service-worker update cadence.
        await registration.update();
      })
      .catch((error: unknown) => {
        console.error("[pwa] service worker registration failed", error);
      });

    const interval = window.setInterval(() => {
      void registration?.update();
    }, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        reloadForUpdatedWorker,
      );
    };
  }, []);

  return null;
}