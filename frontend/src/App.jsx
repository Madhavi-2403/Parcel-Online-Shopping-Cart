import { useCallback, useEffect, useState } from "react";
import { api, clearToken, ensureSession, onTTL, setSessionToken } from "./api";
import { AuthPage, CartDrawer, DoneModal, Header, Hero, ProductCard, SessionPanel, Toasts } from "./components";

const EMPTY = { items: [], count: 0, subtotal: 0, shipping: 0, total: 0, free_at: 150 };
const go = hash => { window.location.hash = hash; window.scrollTo(0, 0); };

export default function App() {
  const [route, setRoute] = useState(window.location.hash);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [products, setProducts] = useState([]);
  const [cats, setCats] = useState(["All"]);
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [cart, setCart] = useState(EMPTY);
  const [drawer, setDrawer] = useState(false);
  const [panel, setPanel] = useState(false);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(null);
  const [checking, setChecking] = useState(false);
  const [resume, setResume] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [stockTick, setStockTick] = useState(0);

  const toast = useCallback((msg, type = "ok") => {
    const id = Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);

  const loadCart = useCallback(() => api("/cart").then(setCart), []);

  useEffect(() => {
    const h = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);

  useEffect(() => onTTL(s => setExpiresAt(Date.now() + s * 1000)), []);

  useEffect(() => {
    const reset = () => { setUser(null); setCart(EMPTY); toast("Your session timed out, so we started a new one.", "warn"); };
    window.addEventListener("session-reset", reset);
    (async () => {
      const s = await ensureSession();
      setUser(s.user);
      setCats(["All", ...(await api("/categories"))]);
      await loadCart();
      setReady(true);
    })().catch(() => toast("Can't reach the server. Check that the containers are running.", "err"));
    return () => window.removeEventListener("session-reset", reset);
  }, [loadCart, toast]);

  const onShop = !route.startsWith("#/login") && !route.startsWith("#/signup");

  useEffect(() => {
    if (!ready || !onShop) return;
    const t = setTimeout(() => api(`/products?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`).then(setProducts), 200);
    return () => clearTimeout(t);
  }, [ready, onShop, q, cat, stockTick]);

  const run = fn => fn().catch(e => toast(e.message, "err"));

  const add = p => { setBusy(p.id); run(() => api("/cart", { method: "POST", body: { product_id: p.id, qty: 1 } })
    .then(c => { setCart(c); toast(`${p.name} is in your cart`); }).finally(() => setBusy(null))); };
  const setQty = (id, qty) => run(() => api(`/cart/${id}`, { method: "PATCH", body: { qty } }).then(setCart));
  const remove = id => run(() => api(`/cart/${id}`, { method: "DELETE" }).then(setCart));

  const checkout = () => {
    if (!user) { setDrawer(false); setResume(true); go("#/login"); toast("Sign in to place your order. Your cart is saved.", "warn"); return; }
    setChecking(true);
    run(() => api("/checkout", { method: "POST" })
      .then(r => { setDone(r); setCart(EMPTY); setDrawer(false); setStockTick(t => t + 1); })
      .finally(() => setChecking(false)));
  };

  const auth = async (mode, form) => {
    const s = await api(`/auth/${mode}`, { method: "POST", body: form });
    setSessionToken(s.token);
    setUser(s.user);
    await loadCart();
    go("#/");
    toast(mode === "register" ? `Welcome, ${s.user.name}. Your account is ready.` : `Welcome back, ${s.user.name}.`);
    if (resume) { setResume(false); setDrawer(true); }
  };

  const logout = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    clearToken();
    const s = await ensureSession();
    setUser(s.user);
    setCart(EMPTY);
    toast("You're signed out.");
  };

  if (!onShop) {
    const mode = route.startsWith("#/signup") ? "signup" : "login";
    return <><AuthPage key={mode} mode={mode} onSubmit={auth} /><Toasts items={toasts} /></>;
  }

  return (
    <>
      <Header q={q} setQ={setQ} user={user} expiresAt={expiresAt} count={cart.count}
        onCart={() => setDrawer(true)} onPanel={() => setPanel(true)} onLogout={logout} />
      <main className="wrap">
        <Hero user={user} expiresAt={expiresAt} onPanel={() => setPanel(true)} />
        <div className="tabs" role="tablist">
          {cats.map(c => <button key={c} role="tab" aria-selected={c === cat} className={c === cat ? "on" : ""} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        {products.length === 0 && ready ? (
          <div className="empty">
            <p>No products match your search.</p>
            <button className="btn" onClick={() => { setQ(""); setCat("All"); }}>Clear search and filters</button>
          </div>
        ) : (
          <div className="grid">{products.map(p => <ProductCard key={p.id} p={p} busy={busy === p.id} onAdd={() => add(p)} />)}</div>
        )}
      </main>
      <CartDrawer open={drawer} cart={cart} onClose={() => setDrawer(false)} setQty={setQty} remove={remove} checkout={checkout} checking={checking} user={user} />
      <SessionPanel open={panel} onClose={() => setPanel(false)} user={user} expiresAt={expiresAt} />
      <DoneModal order={done} onClose={() => setDone(null)} />
      <Toasts items={toasts} />
    </>
  );
}
