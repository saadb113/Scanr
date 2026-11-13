# Scanr Coming Soon Website

Standalone responsive Scanr marketing and launch-update site. Its palette and visual language follow `../design-v2`: layered dark surfaces, hairline borders, Inter and Space Grotesk, and Scanr blue (`#2b7fff`). Existing product descriptions are adapted from `frontend/src/pages/Home.jsx`, `frontend/src/pages/Features.jsx`, and the `design-v2` marketing screens.

## Pages

- `/` — product introduction, illustrative interface preview, workflow, social links, and launch signup.
- `/features` — product direction and feature concepts. Each visual with sample prices or chart values is explicitly illustrative.
- `/about` — Scanr overview, builder profile, and creator social links.
- `/admin` — password-protected launch subscriber list and page-view dashboard.
- `/privacy` — explains newsletter signup handling.

## Run locally

Requires Node.js 18 or newer. No application dependencies are needed.

```sh
npm start
```

Set a local admin password in PowerShell before starting the server:

```powershell
$env:ADMIN_PASSWORD = "use-a-long-random-password"
npm start
```

Open `http://localhost:3000`. Without a newsletter provider configured, local submissions are saved to `data/subscribers.json` for prototype use only. Open `http://localhost:3000/admin` to view signups and page-view counts. Page analytics start after a visitor opts in at the site prompt. Country is read from a trusted hosting header when available; otherwise the server uses ipapi.co to estimate it and stores only the resulting country code, not the visitor IP.

## Creator profiles

The Overview and About pages link to the supplied X, TikTok, Instagram, and YouTube handles. The profile portrait is a local copy of the public image from [@saadbuilds on YouTube](https://www.youtube.com/@saadbuilds). Update `site-config.js` if any social URL changes.

## Render deployment

The root `render.yaml` now declares a separate free web service for this site, rooted at `scanr-coming-soon`, with automatic deployment on commits and `/api/health` as its health check. If this repository is already connected through a Render Blueprint, syncing the updated Blueprint adds the service. Otherwise create a Render Blueprint from this repository.

Set `ADMIN_PASSWORD` as a secret environment variable to unlock `/admin`. Set `SUBSCRIBE_WEBHOOK_URL` and, if needed, `SUBSCRIBE_WEBHOOK_TOKEN` to connect your mailing-list provider. `REQUIRE_SUBSCRIBE_WEBHOOK=true` is enabled for the Render service, so the form clearly reports that signups are not connected until that webhook is configured. The server sends `email`, `consent`, `source`, and `subscribedAt`; confirm the provider's expected payload before enabling the form.

Render's free web services have ephemeral storage. The JSON backup used for the admin subscriber list and analytics can be lost on restarts or deploys. The connected newsletter provider should be the durable source for emails; keeping the site's admin copy and view history across deploys requires a persistent disk on an eligible paid service or a database integration.

Render supports custom domains for free web services on its free plan. You must already own or register the domain separately, then configure the DNS records shown for your Render service. The Hobby workspace currently includes two custom domain entries. See [Render custom-domain documentation](https://render.com/docs/custom-domains) and [free-service limitations](https://render.com/docs/free).

## Safety and scope

The page is informational only; charts and prices are decorative sample UI, not market data. This website does not connect to exchange credentials, trade, or provide financial advice. The email endpoint validates consent, rate-limits basic abuse, rejects oversized requests, uses a honeypot, and does not expose the subscriber file through a public route. Analytics are opt-in and do not retain full IP addresses. When the host does not supply visitor country, ipapi.co estimates it from the request IP; the Privacy page describes this. A connected newsletter provider should handle unsubscribe links and delivery compliance before launch.
