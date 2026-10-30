# Parcel: shopping cart with session management

Stack: Flask (API), React + Vite (UI), MongoDB (products, users, carts, orders), Cassandra (sessions and activity log), Docker Compose.

## Run
    docker compose up --build
Open http://localhost:3000. The first start takes 1 to 2 minutes because Cassandra boots slowly; the backend waits for it.

## How the pieces fit
- Every visitor gets a guest session in Cassandra (`sessions` table). The row has a TTL of 30 minutes and is rewritten on every request, so the session slides forward while the user is active.
- Cart activity is written to a Cassandra `activity` table (clustering by time, 7 day TTL) and shown in the Session activity panel.
- Carts live in MongoDB, keyed by session owner. Signing in rotates the session token and merges the guest cart into the user cart.
- Checkout decrements stock atomically per product and rolls back if any item runs short.

## Local development (without Docker for the app)
    docker compose up mongo cassandra
    cd backend && pip install -r requirements.txt && MONGO_URI=mongodb://localhost:27017 CASSANDRA_HOSTS=localhost flask --app app run
    cd frontend && npm install && npm run dev   # http://localhost:3000, proxies /api to :5000

## API
POST /api/session, GET /api/session, POST /api/auth/register|login|logout, GET /api/categories, GET /api/products?q=&category=,
GET|POST /api/cart, PATCH|DELETE /api/cart/<id>, POST /api/checkout, GET /api/orders, GET /api/activity.
Send the session token in the `X-Session-Token` header.
