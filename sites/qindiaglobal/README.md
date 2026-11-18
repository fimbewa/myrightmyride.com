# qindiaglobal.com

A separate one-page website (a citizens' initiative for orderly queues in public transport). It is plain HTML with no server code.

With Docker (`docker-compose.yml`), the Caddy container serves this folder for qindiaglobal.com and www.qindiaglobal.com, set by `SITE2_DOMAIN`. myrightmyride.com is not affected. To change the text, edit `index.html` (English, Hindi and Marathi are in the `T` table at the bottom) and press **Redeploy**.
