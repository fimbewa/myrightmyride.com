# qindiaglobal.com

Qindiaglobal is a citizens' initiative for orderly queues and self-discipline at every place in public transport
("Queue up. Board with dignity."). It is **not** approved by or connected with any government body, and every page says so.

## What is here

| File | What it is |
|---|---|
| `index.html`, `site.js`, `site.css` | The website: habits, pledge with live counter, share buttons, posters, volunteer/contact form, disclaimer |
| `i18n.js` | **All the words, in 10 languages** (English, Hindi, Marathi, Gujarati, Bengali, Tamil, Telugu, Spanish, French, Arabic). To change a sentence, change it here. |
| `poster.html` | Printable A4 posters (`?type=habits` or `?type=sign`, `&lang=hi` etc.) with a QR code to the site |
| `admin.html` | Owner page at qindiaglobal.com/admin: pledges, messages, download as CSV. Uses the server's owner password. |
| `og.png`, `icon-512.png`, `favicon.svg`, `qr.svg` | Share preview picture, app icon, browser icon, QR code |
| `blog/` | The Q India Blog at qindiaglobal.com/blog. Each post is one HTML file (English); add it to `blog/index.html` and `sitemap.xml`. Pictures in `blog/img` are our own drawings. |
| `sitemap.xml`, `robots.txt` | For Google |

The pledge counter, the contact form and the owner page are run by `server/qindia.js` in the Node app and saved in the
same SQLite database (tables `q_pledges` and `q_messages`, backed up daily with the rest).

## How it is served

The app answers for any Host listed in `SITE2_DOMAIN` (default `qindiaglobal.com`, plus `www.`). The web server (Caddy)
must **forward** qindiaglobal.com to the app (`reverse_proxy app:3000`), as in `docker-compose.yml`. If Caddy only serves
these files directly, the page still shows, but the pledge counter and forms cannot save.

Updates go live by themselves: the app checks GitHub every 3 minutes (`AUTO_UPDATE_MINUTES`, 0 = off), downloads
new code from `main` and restarts the website in a few seconds. Only changes to `docker-compose.yml` (the web server
settings) still need a Redeploy in hPanel.
