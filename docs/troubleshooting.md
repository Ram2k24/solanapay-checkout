# Troubleshooting

## Environment

**`docker: unknown command: docker compose`**
Ubuntu's `docker.io` package doesn't include Compose. Install it:
`sudo apt install docker-compose-v2`.

**`nvm: command not found` right after installing nvm**
The current shell hasn't loaded it yet: `source ~/.bashrc` (or open a new terminal).

**Secrets in `.env` are empty again**
`cp .env.example .env` overwrites silently. Always use `cp -n` (no clobber).
Regenerate with:
`sed -i -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" -e "s|^CRON_SECRET=.*|CRON_SECRET=$(openssl rand -hex 32)|" .env`

## Next.js

**`⨯ Another next dev server is already running.`**
Only one dev server per project folder. Stop the old one (Ctrl+C in its terminal,
or `kill <PID>` using the PID shown in the message).

**`⚠ Port 3000 is in use ... using available port 3001`**
Something else is on port 3000 (often an old dev server). Find it with
`ss -ltnp | grep ':3000 '`.

**Server exits at startup with `Invalid server environment configuration`**
Working as designed: a variable in `.env` is missing or invalid. The message
names the variable and the rule; compare with `.env.example`.

**Changed a `NEXT_PUBLIC_*` value but nothing changed**
Public variables are inlined at build time. Restart `npm run dev`, or re-run
`npm run build` for production.

**`curl http://localhost:3000/...` prints nothing**
No server is listening (`curl -s` hides connection errors). Start `npm run dev`
in another terminal first; check with `ss -ltn | grep ':3000 '`.
