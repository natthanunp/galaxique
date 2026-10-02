"use client";

/** Owner tokens for published worlds, kept only on this device. */
const KEY = "galaxique-owned-worlds";

export function getOwnedWorlds(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOwnedWorld(worldId: string, token: string): void {
  localStorage.setItem(KEY, JSON.stringify({ ...getOwnedWorlds(), [worldId]: token }));
}

export function forgetOwnedWorld(worldId: string): void {
  const { [worldId]: _removed, ...rest } = getOwnedWorlds();
  void _removed;
  localStorage.setItem(KEY, JSON.stringify(rest));
}

/** The token travels in the URL fragment, which browsers never send to the server. */
export function manageLink(worldId: string, token: string): string {
  return `${window.location.origin}/w/${worldId}#manage=${token}`;
}
