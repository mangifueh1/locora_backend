## Delivery flow

When a business creates a delivery with `POST /api/v1/deliveries`, the response
always includes a `tracking_link`. If the customer has no saved location, the
response also includes a short-lived `picker_url`; the tracking link remains the
same after the customer submits their location.

The public tracking page reads the tracking token with:

`GET /api/v1/deliveries/by-token/:token`

Its response contains `customer_lat`/`customer_lng`, and either a `driver` object
with the driver's `id`, `lat`, and `lng`, or `driver: null` with
`assignment: "still_to_be_assigned"`.

Drivers see pending deliveries for their businesses with:

`GET /api/v1/drivers/me/available-deliveries`

They claim a delivery by sending their current coordinates to
`POST /api/v1/deliveries/:id/claim`. A driver can have at most two deliveries in
`assigned` or `in_progress` status. Later location updates use
`POST /api/v1/deliveries/:id/location`.

For an existing database, add the new columns before deploying the new routes:

```sql
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS driver_lat DOUBLE PRECISION;
ALTER TABLE deliveries ADD COLUMN IF NOT EXISTS driver_lng DOUBLE PRECISION;
```

## Deploy this backend to Render

This repository deploys as one Render **Web Service**. It runs the Express
HTTP API and Socket.IO from the same process. PostgreSQL is a separate Render
**PostgreSQL** service. There is no migration runner in this repository, so
database setup is a manual one-time step.

### Before pushing to Git

The local `.env` file is for your computer only. Do not upload it to GitHub or
paste it into Render as a file. Render stores environment variables in the
service dashboard.

This repository currently has `.env` tracked by Git even though `.gitignore`
contains `.env`. The local file contains a database password and a JWT secret.
Treat both as compromised: rotate the PostgreSQL password and generate a new
JWT secret before deploying.

From the repository root, after replacing those local values, remove `.env`
from Git tracking and commit that removal:

```bash
git rm --cached .env
git add .gitignore
git commit -m "Stop tracking local environment file"
git push
```

If the old `.env` was pushed to a remote repository, removing it in a new
commit is not enough to erase it from history. Rotate the exposed credentials
regardless, and rewrite repository history only if your team's Git process
requires it.

### 1. Create the Render PostgreSQL database

1. Sign in at [render.com](https://render.com) and open the correct workspace.
2. Select **New +** -> **PostgreSQL**.
3. Give it a name such as `locora-db`.
4. Choose a region. Use the same region for the web service below.
5. Choose the plan and storage appropriate for your workload, then create it.
6. Open the database after it is available. Keep its **Internal Database URL**
	available; it will become the web service's `DATABASE_URL`.

Use the internal URL when the web service and database are both on Render. It
keeps traffic inside Render's private network. Do not commit this URL or put
it in a frontend application.

### 2. Create the Render web service

Push the repository to GitHub, GitLab, or Bitbucket, then:

1. Select **New +** -> **Web Service**.
2. Connect the repository containing this backend.
3. Set **Root Directory** to the repository root (leave it blank if this
	repository is the root of the connected repository).
4. Choose **Runtime: Node**.
5. Set **Build Command** to `npm install`.
6. Set **Start Command** to `npm start`.
7. Select the same region as the PostgreSQL service.
8. Choose the plan you want to use and create the service.

Do not use `npm run dev` on Render. That command starts `nodemon`, which is a
development file watcher. Render should run the existing `npm start` script.

### 3. Add the Render environment variables

In the web service, open **Environment** -> **Add Environment Variable** and
add these values:

| Key | Value | Required |
|---|---|---|
| `DATABASE_URL` | Copy the PostgreSQL service's **Internal Database URL** | Yes |
| `JWT_SECRET` | A new long random secret, different from local development | Yes |
| `PUBLIC_APP_URL` | The public URL of the frontend that serves `/pick/...` and `/track/...` | Yes for correct links |
| `NODE_ENV` | `production` | Recommended |

Do not add `PORT` manually. Render provides `PORT`, and `src/server.js` already
listens on `process.env.PORT`. Do not put quotes around values in Render's
environment-variable fields.

Generate a JWT secret locally with Node if needed:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

`PUBLIC_APP_URL` must be the frontend origin, for example
`https://your-frontend.onrender.com`, not the backend URL, unless the frontend
is hosted by this same service. The backend uses it to build the `tracking_link`
and `picker_url` returned by `POST /api/v1/deliveries`.

For local development, keep using a local `.env` file with values like these,
but never commit that file:

```dotenv
PORT=4000
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/locora_db
JWT_SECRET=local-only-secret
NODE_ENV=development
PUBLIC_APP_URL=http://localhost:3000
```

The deployed service does not need a `.env` file. `dotenv` loads the file when
it exists locally, while Render supplies the same values through the process
environment.

### 4. Initialize the database schema

The application does not run `schema.sql` automatically. Before testing the
API, run the schema against the Render database. Use the database's **External
Database URL** with `psql` from your computer, or use the database's available
SQL shell in the Render dashboard.

For a brand-new Render database, run these commands from the repository root:

```bash
psql "<EXTERNAL_DATABASE_URL>" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
psql "<EXTERNAL_DATABASE_URL>" -f src/db/schema.sql
```

Replace `<EXTERNAL_DATABASE_URL>` with the real URL and do not commit it. The
`pgcrypto` extension is needed by the schema's `gen_random_uuid()` defaults.

If the database already existed before the driver-coordinate fields were
added, apply the migration after the schema is present:

```bash
psql "<EXTERNAL_DATABASE_URL>" -f src/db/migrations/001_adding_driver_coordinates.sql
```

The migration is safe to run more than once because it uses `IF NOT EXISTS`.
There is currently no migration table or automatic migration command, so run
future SQL migrations manually before deploying code that depends on them.

### 5. Configure the health check and deploy

In the web service settings, set **Health Check Path** to:

```text
/health
```

Deploy the service. A successful health check returns:

```json
{"status":"ok"}
```

The backend URL will look like `https://<service-name>.onrender.com`. The API
base URL is:

```text
https://<service-name>.onrender.com/api/v1
```

Socket.IO uses that same backend origin. There is no second WebSocket service
to create. The current server allows cross-origin requests and Socket.IO
connections, so the frontend can connect to the Render backend URL directly.

### 6. Verify the deployment

Run these checks after the first deploy:

```bash
curl https://<service-name>.onrender.com/health
```

Then use Postman or your frontend to verify, in order:

1. Register a business through `POST /api/v1/businesses/register`.
2. Log in and confirm the returned JWT can authenticate a protected route.
3. Create a delivery through `POST /api/v1/deliveries`.
4. Confirm its `tracking_link` and, when needed, `picker_url` use
	`PUBLIC_APP_URL` rather than a placeholder domain.
5. Open the public tracking endpoint from the returned token:
	`GET /api/v1/deliveries/by-token/:token`.
6. Connect the frontend Socket.IO client to the backend origin and verify
	delivery-room location updates.

Check **Logs** in Render if startup fails. The most common causes for this
repository are a missing `DATABASE_URL`, a missing `JWT_SECRET`, an uninitialized
database schema, or a `PUBLIC_APP_URL` that points at the wrong frontend.

### Render production notes

- Keep the web service and database in the same Render region.
- Use one web-service instance unless you add a shared Socket.IO adapter. The
  current in-memory Socket.IO rooms do not synchronize between multiple
  instances.
- The current CORS configuration allows all origins. Restrict it to the
  frontend origin before treating this as a hardened production deployment.
- `helmet` is installed but is not currently enabled in `src/server.js`; add
  and test it as a separate security hardening change if required.
- Render deploys from the connected Git branch. Pushing a new commit triggers
  a new build when auto-deploy is enabled.
