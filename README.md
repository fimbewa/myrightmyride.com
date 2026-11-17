# myrightmyride.com

A free, zero-commission ride-booking website for bikes, autos and cars, run as a citizens' initiative.

- **No commission** from drivers or passengers. Passengers pay the driver directly by cash, UPI or card.
- **Fare as per the vehicle's own meter**, or a fare the passenger decides at booking (the driver can only accept or decline it).
- **No Google, no app store, no payment company.** Maps are OpenStreetMap. Everything runs on your own server, so no company takes a cut however many users you get.
- **Optional ride insurance** from partner insurers is recommended at every booking. This is the planned revenue stream.
- **Owner panel** at `/admin`: change every text, vehicle type, insurance plan and map setting, approve drivers and places, and see who is logged in, all without touching code.

## What is inside

| Part | What it does |
|---|---|
| Passenger | Mobile + OTP login, pickup and drop by search, GPS, map tap, or State → District → Taluka lists (stations, ST stands, courts, Collector, Tahsildar and SDO offices, government and private hospitals, housing societies, clubs and more), vehicle, fare, payment, insurance, safety and pay undertakings, live driver tracking, ride OTP, UPI QR payment, ride timeline |
| Driver | Registration with vehicle, licence and UPI ID, fare undertaking, owner approval, go online, live requests, accept, OTP start, enter the meter fare, payment received |
| Owner panel | Overview, users and logins, drivers, rides, website texts, vehicles, insurance plans, rules, map services, places (one at a time or from a CSV sheet) |

## Put it online (one-time setup, about an hour)

You need:

1. **A server (VPS)** with Ubuntu 24.04, about ₹500 to ₹1,500 a month from any Indian or international hosting company. 2 GB RAM is enough to start.
2. **Your domain** `myrightmyride.com`. At your domain company, add an "A record" for `myrightmyride.com` and `www` pointing to your server's IP address.
3. **An SMS company account** for login OTPs (MSG91, Fast2SMS, Textlocal or any other). You need DLT registration for your OTP message. SMS is the only thing that costs money per use, and it is charged by the SMS company, not by any platform.

Then open your server's terminal (Hostinger: **VPS → Terminal** in hPanel) and paste this one command:

```bash
curl -fsSL https://raw.githubusercontent.com/fimbewa/myrightmyride.com/main/deploy/install.sh | bash
```

It installs Node.js, downloads the website, creates the settings file with a random owner password, starts the website as a service, connects the domain with free HTTPS (through CloudPanel if it is installed, otherwise Caddy), and sets up a daily backup. At the end it prints your owner panel password (also saved in `/root/myrightmyride-admin-password.txt`).

The site starts in **test mode**: no SMS is sent and the login OTP is shown on screen. When your SMS company is ready, edit `/opt/myrightmyride/.env` (set `SMS_PROVIDER=http`, `SMS_HTTP_URL=...`, `SHOW_OTP_ON_SCREEN=false`) and run `systemctl restart myrightmyride`.

### Getting future changes

Run the same install command again. It updates the code and keeps all data, settings and the password.

Useful commands: `systemctl status myrightmyride` (is it running?), `journalctl -u myrightmyride -n 50` (recent log).

### Backups

All users, drivers, rides and settings are in one file, `/opt/myrightmyride/data/myrightmyride.db`. The installer copies it every night to `/var/backups/myrightmyride/` and keeps 30 days. Also download a copy to your own computer now and then, or turn on Hostinger's weekly VPS backups.

## Day-to-day use (no coding)

Everything below is done from the **owner panel** at `/admin`:

- **Approve drivers**: Drivers tab. Check their vehicle number and licence, then press Approve.
- **Change any text** (disclaimer, safety text, undertakings, tagline): Website texts tab, then Save.
- **Insurance plans**: "Vehicles, insurance & maps" tab. Leave the price empty until it is finalised with the insurer, and passengers see "Details coming soon".
- **Add places** (a new court, hospital or society): Places tab. Add one, or upload a CSV sheet with columns `name,category,state,district,taluka,lat,lng`. Passengers' suggested places wait here for your approval.
- **See who is logged in** and block misuse: Users & logins tab.

## Maps at large scale (staying free of per-use fees)

The site starts with the free public OpenStreetMap services. They are fine for testing and early use, but their fair-use rules do not allow heavy traffic. When you grow, run your own copies on your own server (free software, you only pay for the server) and put their addresses in the owner panel under "Map services":

- **Map tiles**: a tile server such as OpenMapTiles / TileServer GL with the India extract from Geofabrik.
- **Place search**: Photon (komoot/photon) with the India data.
- **Place lists**: your own Overpass API instance.

No code changes are needed, only the four addresses in the owner panel.

## Important legal notes

- The site shows that it is a citizens' initiative, not approved by any government, and that passenger safety is the passenger's own responsibility.
- Before selling insurance, the tie-up must be with an IRDAI-registered insurer or broker (for example as a corporate agent or through a licensed broker's platform).
- Check your state's aggregator rules for two-, three- and four-wheeler passenger transport before going live.

## For developers

- Node.js 20+, Express 5, Socket.IO 4, SQLite (better-sqlite3), Leaflet 1.9 served locally. No external CDNs.
- `npm run dev` runs with auto-restart; `npm test` runs a full ride flow test (login → driver approval → booking → accept → OTP start → meter fare → UPI QR → paid → admin).
- For local testing, set `SMS_PROVIDER=console` and `SHOW_OTP_ON_SCREEN=true` in `.env`.
- `server/index.js` holds the API and live updates, `server/settings.js` holds every owner-editable setting with its default, `public/js/app.js` is the passenger and driver app, `public/js/places.js` is place search and lists, and `public/js/admin.js` is the owner panel.
