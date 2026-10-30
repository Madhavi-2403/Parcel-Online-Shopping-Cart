import { useEffect, useState } from "react";
import { api } from "./api";

export const money = n => `$${Number(n).toFixed(2)}`;
export const fmt = s => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const LABEL = { session_started: "Session started", add: "Added to cart", update: "Changed quantity", remove: "Removed from cart",
  login: "Signed in", register: "Account created", checkout: "Order placed" };
const time = iso => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function useCountdown(expiresAt) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  return expiresAt ? Math.max(0, Math.round((expiresAt - now) / 1000)) : 0;
}

export function Header({ q, setQ, user, expiresAt, count, onCart, onPanel, onLogout }) {
  const left = useCountdown(expiresAt);
  return (
    <header className="hdr"><div className="wrap">
      <a className="logo" href="#/"><i />Parcel</a>
      <input className="search" type="search" placeholder="Search products" value={q} onChange={e => setQ(e.target.value)} aria-label="Search products" />
      <button className="btn" onClick={onPanel}>Session {left > 0 ? fmt(left) : "expired"}</button>
      {user ? (<><span className="hi">Hi, {user.name.split(" ")[0]}</span><button className="btn" onClick={onLogout}>Sign out</button></>)
        : (<><a className="btn" href="#/login">Sign in</a><a className="btn blue" href="#/signup">Sign up</a></>)}
      <button className="btn dark" onClick={onCart} aria-label={`Open cart, ${count} items`}>Cart <b key={count} className="badge">{count}</b></button>
    </div></header>
  );
}

export function Hero({ user, expiresAt, onPanel }) {
  const left = useCountdown(expiresAt);
  const pct = Math.min(100, (left / 1800) * 100);
  return (
    <section className="hero">
      <div>
        <h1>Fill your cart. We’ll hold it for you.</h1>
        <p>Your session stays open for 30 minutes after your last click. Sign in whenever you like and the cart you built as a guest comes with you.</p>
      </div>
      <aside className="ticket">
        <span className="tlabel">Your session</span>
        <div className="ring" style={{ "--p": pct }}><div><strong>{fmt(left)}</strong><small>left</small></div></div>
        <p>{user ? `Signed in as ${user.name}` : "Browsing as a guest"}</p>
        <button className="btn" onClick={onPanel}>See session activity</button>
      </aside>
    </section>
  );
}

export function ProductCard({ p, onAdd, busy }) {
  return (
    <article className="card">
      <div className="art" style={{ "--h": p.hue }}>
        <span aria-hidden="true">{p.emoji}</span>
        {p.stock <= 5 && <em className="tag low">Only {p.stock} left</em>}
      </div>
      <div className="info">
        <small>{p.category}</small>
        <h3>{p.name}</h3>
        <p>{p.description}</p>
        <div className="rate">{"★".repeat(Math.round(p.rating))}<span>{"★".repeat(5 - Math.round(p.rating))}</span> {p.rating.toFixed(1)}</div>
      </div>
      <div className="buy">
        <strong>{money(p.price)}</strong>
        <button className="btn blue" onClick={onAdd} disabled={busy || p.stock === 0}>{p.stock === 0 ? "Sold out" : busy ? "Adding" : "Add to cart"}</button>
      </div>
    </article>
  );
}

export function CartDrawer({ open, cart, onClose, setQty, remove, checkout, checking, user }) {
  const away = Math.max(0, cart.free_at - cart.subtotal);
  return (
    <>
      <div className={"scrim" + (open ? " on" : "")} onClick={onClose} />
      <aside className={"drawer" + (open ? " on" : "")} aria-hidden={!open} aria-label="Your cart">
        <div className="dhead"><h2>Your receipt</h2><button className="x" onClick={onClose} aria-label="Close cart">✕</button></div>
        {cart.items.length === 0 ? (
          <div className="dempty"><p>Nothing here yet.</p><button className="btn" onClick={onClose}>Browse products</button></div>
        ) : (
          <>
            <div className="ship">
              <p>{away > 0 ? `Add ${money(away)} more for free shipping.` : "You’ve unlocked free shipping."}</p>
              <div className="meter"><u style={{ width: Math.min(100, (cart.subtotal / cart.free_at) * 100) + "%" }} /></div>
            </div>
            <ul className="lines">
              {cart.items.map(it => (
                <li key={it.id}>
                  <div className="thumb" style={{ "--h": it.hue }}>{it.emoji}</div>
                  <div className="lname">
                    <b>{it.name}</b>
                    <div className="step">
                      <button onClick={() => setQty(it.id, it.qty - 1)} aria-label={`Remove one ${it.name}`}>−</button>
                      <span key={it.qty} className="flash">{it.qty}</span>
                      <button onClick={() => setQty(it.id, it.qty + 1)} disabled={it.qty >= it.stock} aria-label={`Add one ${it.name}`}>+</button>
                      <button className="link" onClick={() => remove(it.id)}>Remove</button>
                    </div>
                  </div>
                  <span key={it.qty} className="flash price">{money(it.price * it.qty)}</span>
                </li>
              ))}
            </ul>
            <dl className="sum">
              <div><dt>Subtotal</dt><dd>{money(cart.subtotal)}</dd></div>
              <div><dt>Shipping</dt><dd>{cart.shipping ? money(cart.shipping) : "Free"}</dd></div>
              <div className="tot"><dt>Total</dt><dd>{money(cart.total)}</dd></div>
            </dl>
            <button className="btn blue big" onClick={checkout} disabled={checking}>{checking ? "Placing order" : user ? "Place order" : "Sign in to place order"}</button>
          </>
        )}
      </aside>
    </>
  );
}

const strength = pw => {
  let n = 0;
  if (pw.length >= 8) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 12) n++;
  return n;
};
const STRENGTH = ["Too short", "Weak", "Fair", "Good", "Strong"];

export function AuthPage({ mode, onSubmit }) {
  const signup = mode === "signup";
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "", agree: false });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const score = strength(f.password);

  const submit = async e => {
    e.preventDefault();
    setErr("");
    if (signup) {
      if (f.password.length < 8) return setErr("Use at least 8 characters for your password.");
      if (f.password !== f.confirm) return setErr("The two passwords don’t match.");
      if (!f.agree) return setErr("Accept the terms of use to create your account.");
    }
    setBusy(true);
    try { await onSubmit(signup ? "register" : "login", { name: f.name, email: f.email, password: f.password }); }
    catch (x) { setErr(x.message); }
    setBusy(false);
  };

  return (
    <div className="authpage">
      <aside className="authside">
        <a className="logo light" href="#/"><i />Parcel</a>
        <div>
          <h1>{signup ? "Create your account in a minute." : "Welcome back."}</h1>
          <ul>
            <li>The cart you built as a guest moves into your account when you sign in.</li>
            <li>Place orders and see them all in one list.</li>
            <li>Stay signed in for 30 minutes after your last click.</li>
          </ul>
        </div>
        <p className="fine">Free shipping on orders over $150.</p>
      </aside>

      <main className="authmain">
        <div className="authcard">
          <nav className="seg" aria-label="Account">
            <a href="#/login" className={!signup ? "on" : ""}>Sign in</a>
            <a href="#/signup" className={signup ? "on" : ""}>Create account</a>
          </nav>
          <h2>{signup ? "Sign up" : "Sign in to Parcel"}</h2>
          <form onSubmit={submit} noValidate={false}>
            {signup && <label>Full name<input value={f.name} onChange={set("name")} autoComplete="name" required /></label>}
            <label>Email address<input type="email" value={f.email} onChange={set("email")} autoComplete="email" required /></label>
            <label>Password
              <span className="pw">
                <input type={show ? "text" : "password"} value={f.password} onChange={set("password")}
                  autoComplete={signup ? "new-password" : "current-password"} required />
                <button type="button" onClick={() => setShow(!show)} aria-pressed={show}>{show ? "Hide" : "Show"}</button>
              </span>
            </label>
            {signup && (
              <>
                <div className="strength" data-s={score} aria-live="polite">
                  <span><i /><i /><i /><i /></span>
                  <small>{f.password ? STRENGTH[score] : "Use 8 or more characters with upper and lower case letters and a number."}</small>
                </div>
                <label>Confirm password
                  <input type={show ? "text" : "password"} value={f.confirm} onChange={set("confirm")} autoComplete="new-password" required />
                </label>
                <label className="check"><input type="checkbox" checked={f.agree} onChange={set("agree")} />I agree to the terms of use and privacy policy.</label>
              </>
            )}
            {err && <div className="err" role="alert">{err}</div>}
            <button className="btn blue big" disabled={busy}>{busy ? "Please wait" : signup ? "Create account" : "Sign in"}</button>
          </form>
          <p className="switch">
            {signup ? <>Already have an account? <a href="#/login">Sign in</a></> : <>New to Parcel? <a href="#/signup">Create an account</a></>}
          </p>
          <a className="guest" href="#/">Continue shopping as a guest</a>
        </div>
      </main>
    </div>
  );
}

export function SessionPanel({ open, onClose, user, expiresAt }) {
  const left = useCountdown(expiresAt);
  const [act, setAct] = useState([]);
  const [orders, setOrders] = useState([]);
  useEffect(() => {
    if (!open) return;
    Promise.all([api("/activity"), api("/orders")]).then(([a, o]) => { setAct(a); setOrders(o); }).catch(() => {});
  }, [open]);
  if (!open) return null;
  return (
    <div className="modalwrap" onClick={onClose}>
      <div className="modal wide" onClick={e => e.stopPropagation()}>
        <div className="dhead"><h2>Session activity</h2><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
        <p className="mute">{user ? `Signed in as ${user.email}.` : "You’re browsing as a guest."} Your session expires in {fmt(left)} unless you keep shopping.</p>
        <h3>Recent actions</h3>
        <ol className="timeline">
          {act.length === 0 && <li className="mute">No activity yet.</li>}
          {act.map((a, i) => <li key={i}><time>{time(a.at)}</time><b>{LABEL[a.action] || a.action}</b><span>{a.detail}</span></li>)}
        </ol>
        {user && (<>
          <h3>Your orders</h3>
          {orders.length === 0 ? <p className="mute">No orders yet.</p> :
            <ul className="orders">{orders.map(o => <li key={o.id}><b>#{o.id}</b><span>{o.count} items</span><span>{money(o.total)}</span></li>)}</ul>}
        </>)}
      </div>
    </div>
  );
}

export function DoneModal({ order, onClose }) {
  if (!order) return null;
  return (
    <div className="modalwrap" onClick={onClose}>
      <div className="modal done" onClick={e => e.stopPropagation()}>
        <svg viewBox="0 0 52 52" width="84" height="84" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M14 27l8 8 16-17" /></svg>
        <h2>Order placed</h2>
        <p className="mute">Order #{order.order_id} for {money(order.total)} is confirmed.</p>
        <button className="btn blue big" onClick={onClose}>Keep shopping</button>
      </div>
    </div>
  );
}

export const Toasts = ({ items }) => (
  <div className="toasts" aria-live="polite">{items.map(t => <div key={t.id} className={"toast " + t.type}>{t.msg}</div>)}</div>
);
