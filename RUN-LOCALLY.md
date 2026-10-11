# Run Agentify ERP on your computer

Needs Node 22 or newer (https://nodejs.org).

1. Unzip `agentify-erp-full.zip` into a folder, open a terminal there.
2. `npm run install:all` then `npm run build`
3. Start it (Windows PowerShell):
   ```
   $env:ERP_BASE_DOMAIN="localhost"; $env:PLATFORM_ADMIN_EMAIL="you@example.com"; $env:PLATFORM_ADMIN_PASSWORD="choose-10-plus-chars"; npm start
   ```
   (macOS/Linux: `ERP_BASE_DOMAIN=localhost PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD=choose-10-plus-chars npm start`)
4. Open in Chrome or Edge:
   - Landing page: http://localhost:4000
   - Create a workspace: http://localhost:4000/signup (then it lives at http://<name>.localhost:4000)
   - Platform console (Stripe keys, payment accounts, backups): http://localhost:4000/platform

Emails are not sent without a mail key; the confirm/invite links are printed in the terminal.
