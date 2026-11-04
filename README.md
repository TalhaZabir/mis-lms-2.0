# LMS – Dept. of MIS, University of Dhaka

Stack: Next.js 14 (web) + Express/Nest-compatible API + Prisma + SQLite(dev)/Postgres(prod) + Redis + Socket.io ready.

## 5-Part Build – ALL DONE ✅ (verified)

**Part 1 – Foundation ✅**
Monorepo, full DB schema, Auth+RBAC, Program > Batch > Term > Course > Offering > Enrollment, Admin CRUD UI + API, DU MIS seed.

**Part 2 – Faculty Tools ✅**
`GET /teach/offerings`, modules/lessons, assignments + grading, banks/questions + quizzes, attendance sessions + QR + bulk mark, gradebook + bulk + lock, live + auto-announcement.

**Part 3 – Student Portal ✅**
`GET /me/courses`, `/offerings/:oid/learn` (enrollment gate), submissions (NO_LATE), quiz attempts (window gate), attendance/me + %, routine, results (DU letters, IN-PROGRESS until locked).

**Part 4 – MIS Connect ✅**
Feed (auto-filter, BATCH hidden from alumni – verified), like/comment/save/report, alumni directory + verify + mentorship opt-in gate, DM/GROUP/MENTORSHIP conversations + persisted socket chat, moderation by MODERATOR/ADMIN only (NO faculty).

**Part 5 – Resource Corner + Polish ✅**
Suggest (dup+URL check) → queue → faculty verify (+notify), browse verified-only, vote/bookmark toggles, broken-flag + POST /resources/check-links, unified notifications, PWA manifest, Dockerfiles.

Decisions locked:
- Alumni: included (mentorship_opt_in gate, batch-only hidden from alumni)
- Moderation: NO faculty review (student mods + admin staff)
- Resources: faculty-curated (suggest -> triage -> faculty verify)
- Live classes: Zoom/Meet integration (link + recording)

Run (all parts):
```
npm install
npm run db:push
npm run db:seed
npm run dev
# web: http://localhost:3000 , api: http://localhost:4000
# logins (mis123): chairman@mis.du.ac.bd / faculty@mis.du.ac.bd / student@mis.du.ac.bd / alumni@mis.du.ac.bd
```

## Role-based access (UI hides + API enforces)
- Admin: SUPER_ADMIN/ADMIN_STAFF only · Teach: +FACULTY/TA · Learn: +STUDENT/MODERATOR (no ALUMNI)
- Connect/Resources: all logged in · Moderate queue: MODERATOR/ADMIN only · Resource queue: FACULTY/ADMIN only
- Students never see Admin/Teach nav or cards; alumni see Connect/Resources only. Direct URL hits → /denied.

## Deploy (prod-ready)
- **Render:** push to GitHub and apply `render.yaml` — see `docs/RENDER.md`.
- **Docker/VPS:** `docs/DEPLOY.md` + `docker-compose.prod.yml`. Quick: `cp .env.example .env` → set secrets → `docker compose -f docker-compose.prod.yml up -d --build`. Health: `/health` + `/ready`.
