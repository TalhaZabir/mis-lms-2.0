# Deploy – MIS LMS (DU)

## 1) Dev (SQLite, 2 min)
```
npm install
npm run db:push
npm run db:seed
npm run dev
# web http://localhost:3000 · api http://localhost:4000/health
# logins pw mis123: chairman / faculty / student / alumni @mis.du.ac.bd
```

## 2) Prod (Docker, DU server/VPS)
```
cp .env.example .env   # set JWT_SECRET, POSTGRES_PASSWORD, CORS_ORIGINS, NEXT_PUBLIC_API
docker compose -f docker-compose.prod.yml up -d --build
docker exec $(docker ps -qf "name=api") npx prisma db push --schema=/app/prisma/schema.prisma  # first time
# Behind reverse proxy (nginx/Caddy): route / -> web:3000, /api -> api:4000, force HTTPS, set CORS_ORIGINS to public URL
```

## 3) Role matrix (frontend hides + API enforces)
- SUPER_ADMIN/ADMIN_STAFF: Admin, Teach, Learn, Connect, Resources
- FACULTY/TA: Teach, Learn, Connect, Resources (no Admin)
- STUDENT/MODERATOR: Learn (moderator too), Connect, Resources (no Admin/Teach)
- ALUMNI: Connect, Resources only (+Home)
- Guests: Home + Login only
- Moderate queue: MODERATOR/ADMIN only · Resource queue: FACULTY/ADMIN only
- Posts DELETE: author or mods only (no faculty review, locked)

## 4) Ops checklist
- [ ] JWT_SECRET 64-char random, POSTGRES_PASSWORD strong, backups of pgdata
- [ ] CORS_ORIGINS = public web URL only
- [ ] `GET /health` (liveness) + `GET /ready` (DB) wired to monitor
- [ ] Switch prisma datasource to postgresql + DATABASE_URL for prod
- [ ] Rate limit env RATE_MAX (default 300/min/IP), logs via `docker logs`
- [ ] PWA manifest at /manifest.json, security headers via next.config + API
