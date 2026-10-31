"""Volt Electronics API.
MongoDB   -> products, users, carts, orders
Cassandra -> sessions (sliding TTL) and per-session activity log
"""
import os, re, time, uuid, datetime as dt
from functools import wraps

from bson import ObjectId
from bson.errors import InvalidId
from cassandra.cluster import Cluster
from flask import Flask, g, jsonify, request
from pymongo import MongoClient
from werkzeug.security import check_password_hash, generate_password_hash

SESSION_TTL = int(os.getenv("SESSION_TTL", 1800))  # seconds, renewed on every request
FREE_SHIPPING_AT, SHIPPING_FEE = 2999.0, 99.0

app = Flask(__name__)
db = MongoClient(os.getenv("MONGO_URI", "mongodb://mongo:27017"))["shop"]

# ---------- Cassandra ----------
def connect_cassandra():
    hosts = os.getenv("CASSANDRA_HOSTS", "cassandra").split(",")
    for attempt in range(60):
        try:
            s = Cluster(hosts).connect()
            s.execute("CREATE KEYSPACE IF NOT EXISTS shop_sessions WITH replication = "
                      "{'class': 'SimpleStrategy', 'replication_factor': 1}")
            s.set_keyspace("shop_sessions")
            s.execute("CREATE TABLE IF NOT EXISTS sessions (session_token text PRIMARY KEY, user_id text, "
                      "email text, name text, created_at timestamp)")
            s.execute("CREATE TABLE IF NOT EXISTS activity (owner text, ts timeuuid, action text, detail text, "
                      "PRIMARY KEY (owner, ts)) WITH CLUSTERING ORDER BY (ts DESC)")
            return s
        except Exception as e:
            print(f"Cassandra not ready ({attempt + 1}/60): {e}", flush=True)
            time.sleep(5)
    raise RuntimeError("Cassandra unavailable")

cass = connect_cassandra()
P_SAVE = cass.prepare("INSERT INTO sessions (session_token, user_id, email, name, created_at) VALUES (?,?,?,?,?) USING TTL ?")
P_GET = cass.prepare("SELECT user_id, email, name, created_at FROM sessions WHERE session_token = ?")
P_DEL = cass.prepare("DELETE FROM sessions WHERE session_token = ?")
P_LOG = cass.prepare("INSERT INTO activity (owner, ts, action, detail) VALUES (?, now(), ?, ?) USING TTL 604800")
P_ACT = cass.prepare("SELECT toTimestamp(ts) AS at, action, detail FROM activity WHERE owner = ? LIMIT 25")

def save_session(s):
    cass.execute(P_SAVE, (s["token"], s["user_id"], s["email"], s["name"], s["created_at"], SESSION_TTL))

def load_session(token):
    if not token:
        return None
    r = cass.execute(P_GET, (token,)).one()
    if not r:
        return None
    return {"token": token, "user_id": r[0] or "", "email": r[1] or "", "name": r[2] or "", "created_at": r[3]}

def log(owner, action, detail=""):
    cass.execute(P_LOG, (owner, action, detail))

def with_session(f):
    @wraps(f)
    def wrapper(*a, **kw):
        s = load_session(request.headers.get("X-Session-Token"))
        if not s:
            return jsonify(error="session_expired"), 401
        save_session(s)  # sliding expiration: rewrite the row with a fresh TTL
        g.s = s
        g.owner = f"user:{s['user_id']}" if s["user_id"] else f"guest:{s['token']}"
        return f(*a, **kw)
    return wrapper

@app.after_request
def ttl_header(resp):
    if "s" in g:
        resp.headers["X-Session-TTL"] = str(SESSION_TTL)
    return resp

def payload(s, token=None):
    d = {"user": {"name": s["name"], "email": s["email"]} if s["user_id"] else None,
         "ttl": SESSION_TTL, "id": s["token"][-6:], "created_at": s["created_at"].isoformat() + "Z"}
    if token:
        d["token"] = token
    return d

# ---------- Mongo seed ----------
SEED = [
    ("Aurora Wireless Headphones", "Audio", 12999.00, "🎧", 265, 4.7, 25, "Adaptive noise cancelling and 40-hour battery life.", "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=800&q=85"),
    ("Pulse Smartwatch", "Wearables", 8999.00, "⌚", 190, 4.5, 14, "Advanced health tracking, GPS and seven-day battery.", "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=85"),
    ("Nimbus Mechanical Keyboard", "Computing", 6499.00, "⌨️", 215, 4.8, 30, "Hot-swappable switches and smooth wireless typing.", "https://images.unsplash.com/photo-1587829741301-dc798b83add3?auto=format&fit=crop&w=800&q=85"),
    ("Vertex Gaming Mouse", "Computing", 3999.00, "🖱️", 330, 4.4, 40, "26K DPI sensor in an ultra-light 60 g shell.", "https://images.unsplash.com/photo-1527814050087-3793815479db?auto=format&fit=crop&w=800&q=85"),
    ("Nova 4K Monitor", "Computing", 24999.00, "🖥️", 205, 4.8, 12, "27-inch IPS display with 144 Hz refresh rate.", "https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=800&q=85"),
    ("Pocket Cinema Projector", "Entertainment", 19999.00, "📽️", 48, 4.3, 9, "1080p portable projector with automatic focus.", "https://images.unsplash.com/photo-1574269909862-7e1d70bb8078?auto=format&fit=crop&w=800&q=85"),
    ("Echo Home Speaker", "Audio", 7999.00, "🔊", 185, 4.6, 20, "Room-filling spatial audio with a voice assistant.", "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=800&q=85"),
    ("Aero True Wireless Earbuds", "Audio", 3999.00, "🎧", 225, 4.5, 35, "Compact ANC earbuds with a 30-hour charging case.", "https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?auto=format&fit=crop&w=800&q=85"),
    ("Snap Action Camera", "Photography", 29999.00, "📷", 25, 4.7, 16, "4K stabilization camera with waterproof housing.", "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=800&q=85"),
    ("Orbit Drone Mini", "Photography", 49999.00, "🚁", 345, 4.4, 8, "4K camera drone with obstacle sensing and 28-minute flight.", "https://images.unsplash.com/photo-1507582020474-9d02b4ebbbd4?auto=format&fit=crop&w=800&q=85"),
    ("Arc Fast Charger", "Accessories", 1999.00, "🔌", 155, 4.6, 50, "Compact 65 W GaN charger for phones and laptops.", "https://images.unsplash.com/photo-1583863788434-e58a36330cf0?auto=format&fit=crop&w=800&q=85"),
    ("Flux Power Bank", "Accessories", 2499.00, "🔋", 125, 4.7, 42, "20,000 mAh portable battery with 30 W fast charging.", "https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?auto=format&fit=crop&w=800&q=85"),
]

def seed():
    db.products.create_index("name", unique=True)
    db.products.delete_many({"name": {"$nin": [p[0] for p in SEED]}})
    for product in SEED:
        n, c, p, e, h, r, s, d = product[:8]
        image = product[8] if len(product) == 9 else None
        db.products.update_one({"name": n}, {"$set": dict(
            name=n, category=c, price=p, emoji=e, hue=h, rating=r, stock=s, description=d, image=image)}, upsert=True)
    db.users.create_index("email", unique=True)
    db.carts.create_index("owner", unique=True)

seed()

def pub(p):
    data = {"id": str(p["_id"]), **{k: p[k] for k in ("name", "category", "price", "emoji", "hue", "rating", "stock", "description")}}
    data["image"] = p.get("image")
    return data

def get_product(pid):
    try:
        return db.products.find_one({"_id": ObjectId(pid)})
    except (InvalidId, TypeError):
        return None

def fail(msg, code=400):
    return jsonify(error=msg), code

# ---------- Cart helpers ----------
def cart_view(owner):
    cart = db.carts.find_one({"owner": owner}) or {"items": []}
    ids = [ObjectId(i["product_id"]) for i in cart["items"]]
    prods = {str(p["_id"]): p for p in db.products.find({"_id": {"$in": ids}})}
    items, subtotal = [], 0.0
    for i in cart["items"]:
        p = prods.get(i["product_id"])
        if not p:
            continue
        qty = min(i["qty"], p["stock"])
        items.append({"id": i["product_id"], "name": p["name"], "emoji": p["emoji"], "image": p.get("image"), "hue": p["hue"],
                      "price": p["price"], "qty": qty, "stock": p["stock"]})
        subtotal += p["price"] * qty
    shipping = 0.0 if (subtotal >= FREE_SHIPPING_AT or not items) else SHIPPING_FEE
    return {"items": items, "count": sum(i["qty"] for i in items), "subtotal": round(subtotal, 2),
            "shipping": shipping, "total": round(subtotal + shipping, 2), "free_at": FREE_SHIPPING_AT}

def store_items(owner, items):
    db.carts.update_one({"owner": owner}, {"$set": {"items": items, "updated_at": dt.datetime.utcnow()}}, upsert=True)

def merge_cart(src, dst):
    sc = db.carts.find_one({"owner": src})
    if not sc:
        return
    merged = {i["product_id"]: i["qty"] for i in (db.carts.find_one({"owner": dst}) or {"items": []})["items"]}
    for i in sc["items"]:
        merged[i["product_id"]] = merged.get(i["product_id"], 0) + i["qty"]
    store_items(dst, [{"product_id": k, "qty": v} for k, v in merged.items()])
    db.carts.delete_one({"owner": src})

# ---------- Session + auth ----------
@app.post("/api/session")
def create_session():
    s = {"token": uuid.uuid4().hex, "user_id": "", "email": "", "name": "", "created_at": dt.datetime.utcnow()}
    save_session(s)
    log(f"guest:{s['token']}", "session_started", "Guest")
    return jsonify(payload(s, s["token"])), 201

@app.get("/api/session")
@with_session
def get_session():
    return jsonify(payload(g.s))

def sign_in(user, action):
    """Rotate the token on login (prevents session fixation) and merge the guest cart."""
    old, old_owner = g.s, g.owner
    new = {"token": uuid.uuid4().hex, "user_id": str(user["_id"]), "email": user["email"],
           "name": user["name"], "created_at": dt.datetime.utcnow()}
    save_session(new)
    cass.execute(P_DEL, (old["token"],))
    owner = f"user:{new['user_id']}"
    merge_cart(old_owner, owner)
    log(owner, action, user["email"])
    return jsonify(payload(new, new["token"]))

@app.post("/api/auth/register")
@with_session
def register():
    d = request.get_json(force=True)
    name, email, pw = d.get("name", "").strip(), d.get("email", "").strip().lower(), d.get("password", "")
    if not name or "@" not in email or len(pw) < 8:
        return fail("Enter your name, a valid email and a password of at least 8 characters.")
    if db.users.find_one({"email": email}):
        return fail("An account with this email already exists. Try signing in.", 409)
    uid = db.users.insert_one({"name": name, "email": email, "password": generate_password_hash(pw)}).inserted_id
    return sign_in(db.users.find_one({"_id": uid}), "register")

@app.post("/api/auth/login")
@with_session
def login():
    d = request.get_json(force=True)
    u = db.users.find_one({"email": d.get("email", "").strip().lower()})
    if not u or not check_password_hash(u["password"], d.get("password", "")):
        return fail("Email or password is incorrect.", 401)
    return sign_in(u, "login")

@app.post("/api/auth/logout")
@with_session
def logout():
    cass.execute(P_DEL, (g.s["token"],))
    return jsonify(ok=True)

# ---------- Catalog ----------
@app.get("/api/categories")
@with_session
def categories():
    return jsonify(sorted(db.products.distinct("category")))

@app.get("/api/products")
@with_session
def products():
    f, q, c = {}, request.args.get("q", "").strip(), request.args.get("category", "")
    if q:
        f["name"] = {"$regex": re.escape(q), "$options": "i"}
    if c and c != "All":
        f["category"] = c
    return jsonify([pub(p) for p in db.products.find(f).sort("name", 1)])

# ---------- Cart ----------
@app.get("/api/cart")
@with_session
def cart_get():
    return jsonify(cart_view(g.owner))

@app.post("/api/cart")
@with_session
def cart_add():
    d = request.get_json(force=True)
    p = get_product(d.get("product_id"))
    if not p:
        return fail("Product not found.", 404)
    qty = max(1, int(d.get("qty", 1)))
    items = (db.carts.find_one({"owner": g.owner}) or {"items": []})["items"]
    for i in items:
        if i["product_id"] == d["product_id"]:
            i["qty"] = min(i["qty"] + qty, p["stock"])
            break
    else:
        items.append({"product_id": d["product_id"], "qty": min(qty, p["stock"])})
    store_items(g.owner, items)
    log(g.owner, "add", p["name"])
    return jsonify(cart_view(g.owner))

@app.patch("/api/cart/<pid>")
@with_session
def cart_update(pid):
    qty, p = int(request.get_json(force=True).get("qty", 1)), get_product(pid)
    if not p:
        return fail("Product not found.", 404)
    items = (db.carts.find_one({"owner": g.owner}) or {"items": []})["items"]
    items = [i for i in items if i["product_id"] != pid] + ([{"product_id": pid, "qty": min(qty, p["stock"])}] if qty > 0 else [])
    store_items(g.owner, items)
    log(g.owner, "update" if qty > 0 else "remove", f"{p['name']} x{max(qty, 0)}")
    return jsonify(cart_view(g.owner))

@app.delete("/api/cart/<pid>")
@with_session
def cart_remove(pid):
    p = get_product(pid)
    items = [i for i in (db.carts.find_one({"owner": g.owner}) or {"items": []})["items"] if i["product_id"] != pid]
    store_items(g.owner, items)
    log(g.owner, "remove", p["name"] if p else pid)
    return jsonify(cart_view(g.owner))

# ---------- Checkout, orders, activity ----------
@app.post("/api/checkout")
@with_session
def checkout():
    if not g.s["user_id"]:
        return fail("Sign in to place your order.", 403)
    view = cart_view(g.owner)
    if not view["items"]:
        return fail("Your cart is empty.")
    done = []
    for it in view["items"]:  # atomic per product: only decrement when enough stock remains
        r = db.products.update_one({"_id": ObjectId(it["id"]), "stock": {"$gte": it["qty"]}}, {"$inc": {"stock": -it["qty"]}})
        if r.modified_count == 0:
            for pid, q in done:
                db.products.update_one({"_id": ObjectId(pid)}, {"$inc": {"stock": q}})
            return fail(f"Sorry, {it['name']} just ran low on stock.", 409)
        done.append((it["id"], it["qty"]))
    oid = db.orders.insert_one({"user_id": g.s["user_id"], "items": view["items"], "subtotal": view["subtotal"],
                                "shipping": view["shipping"], "total": view["total"], "created_at": dt.datetime.utcnow()}).inserted_id
    db.carts.delete_one({"owner": g.owner})
    log(g.owner, "checkout", f"₹{view['total']:,.2f}")
    return jsonify(order_id=str(oid)[-8:].upper(), total=view["total"])

@app.get("/api/orders")
@with_session
def orders():
    if not g.s["user_id"]:
        return jsonify([])
    rows = db.orders.find({"user_id": g.s["user_id"]}).sort("created_at", -1).limit(10)
    return jsonify([{"id": str(o["_id"])[-8:].upper(), "total": o["total"], "count": sum(i["qty"] for i in o["items"]),
                     "at": o["created_at"].isoformat() + "Z"} for o in rows])

@app.get("/api/activity")
@with_session
def activity():
    return jsonify([{"at": r.at.isoformat() + "Z", "action": r.action, "detail": r.detail}
                    for r in cass.execute(P_ACT, (g.owner,))])
