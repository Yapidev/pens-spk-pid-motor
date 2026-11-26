export type ColorSchemePreference = "light dark" | "light" | "dark";
export type ResolvedColorScheme = "light" | "dark";

const STORAGE_KEY = "color-scheme";

// In-memory Map cache for synchronous localStorage reads (js-cache-storage)
const storageCache = new Map<string, string | null>();
let cacheListenersBound = false;

function ensureCacheInvalidationListeners(): void {
  if (cacheListenersBound || typeof window === "undefined") return;
  cacheListenersBound = true;

  window.addEventListener("storage", (e) => {
    if (e.key === null) {
      storageCache.clear();
    } else {
      storageCache.delete(e.key);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      storageCache.clear();
    }
  });
}

function readStorageCached(key: string): string | null {
  if (typeof window === "undefined") return null;
  ensureCacheInvalidationListeners();
  if (storageCache.has(key)) {
    return storageCache.get(key) ?? null;
  }
  try {
    const val = window.localStorage.getItem(key);
    storageCache.set(key, val);
    return val;
  } catch {
    return null;
  }
}

function writeStorageCached(key: string, value: string): void {
  storageCache.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Tetap terapkan ke halaman walau localStorage diblokir
  }
}

function removeStorageCached(key: string): void {
  storageCache.set(key, null);
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Abaikan jika localStorage diblokir
  }
}

function getMetaElement(): HTMLMetaElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
}

export function getSystemColorScheme(): ResolvedColorScheme {
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function getStoredColorScheme(): "light" | "dark" | null {
  const val = readStorageCached(STORAGE_KEY);
  return val === "light" || val === "dark" ? val : null;
}

export function getResolvedColorScheme(): ResolvedColorScheme {
  const metaContent = getMetaElement()?.content;
  if (metaContent === "dark" || metaContent === "light") {
    return metaContent;
  }
  return getStoredColorScheme() ?? "dark";
}

export function applyColorSchemeMeta(pref: ColorSchemePreference): void {
  const meta = getMetaElement();
  if (meta && meta.content !== pref) {
    meta.content = pref;
  }
}

/**
 * Two-state toggle dengan Phoenix Dark Mode sebagai default.
 */
export function toggleColorScheme(): {
  resolved: ResolvedColorScheme;
  followingSystem: boolean;
} {
  const currentRendered = getResolvedColorScheme();
  const target: ResolvedColorScheme = currentRendered === "dark" ? "light" : "dark";

  applyColorSchemeMeta(target);
  writeStorageCached(STORAGE_KEY, target);
  return { resolved: target, followingSystem: false };
}

/**
 * Berlangganan perubahan tema (dari toggle, tab lain via `storage`, atau perubahan OS via `matchMedia`).
 * Tidak pernah menghapus nilai tersimpan secara retroaktif saat preferensi OS berubah.
 */
export function subscribeColorSchemeChange(
  onChange: (resolved: ResolvedColorScheme) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  ensureCacheInvalidationListeners();

  const notify = () => onChange(getResolvedColorScheme());

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", notify);

  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      storageCache.delete(STORAGE_KEY);
      const stored = getStoredColorScheme();
      applyColorSchemeMeta(stored ?? "light dark");
      notify();
    }
  };
  window.addEventListener("storage", onStorage);

  const meta = getMetaElement();
  let observer: MutationObserver | null = null;
  if (meta) {
    observer = new MutationObserver(notify);
    observer.observe(meta, { attributes: true, attributeFilter: ["content"] });
  }

  return () => {
    mql.removeEventListener("change", notify);
    window.removeEventListener("storage", onStorage);
    observer?.disconnect();
  };
}
