const KEY = "parcel_token";
let token = localStorage.getItem(KEY) || "";
const listeners = new Set();

export const onTTL = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = ttl => listeners.forEach(f => f(ttl));
export const setSessionToken = t => { token = t; localStorage.setItem(KEY, t); };
export const clearToken = () => { token = ""; localStorage.removeItem(KEY); };

async function raw(path, opts = {}) {
  const res = await fetch("/api" + path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Session-Token": token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const ttl = res.headers.get("X-Session-TTL");
  if (ttl) emit(Number(ttl));
  return { res, data: await res.json().catch(() => ({})) };
}

export async function newSession() {
  const { data } = await raw("/session", { method: "POST" });
  setSessionToken(data.token);
  emit(data.ttl);
  return data;
}

export async function api(path, opts = {}) {
  let { res, data } = await raw(path, opts);
  if (res.status === 401 && data.error === "session_expired") {
    await newSession();
    window.dispatchEvent(new Event("session-reset"));
    ({ res, data } = await raw(path, opts));
  }
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong."), { status: res.status });
  return data;
}

export const ensureSession = () => (token ? api("/session") : newSession());
