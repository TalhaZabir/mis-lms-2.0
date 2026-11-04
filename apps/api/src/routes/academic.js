const express = require('express');
const prisma = require('../db');
const { auth, requireRoles } = require('../auth');
const router = express.Router();
router.use(auth());

const ADMIN = ['SUPER_ADMIN', 'ADMIN_STAFF'];

// helper: generic CRUD factory
function crud(model, include) {
  const r = express.Router();
  r.get('/', async (req, res) => {
    const rows = await prisma[model].findMany({ include, take: 200, orderBy: { id: 'desc' } }).catch(() => prisma[model].findMany({ take: 200 }));
    res.json(rows);
  });
  r.post('/', requireRoles(...ADMIN), async (req, res) => {
    try { const row = await prisma[model].create({ data: req.body }); res.json(row); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.put('/:id', requireRoles(...ADMIN), async (req, res) => {
    try { const row = await prisma[model].update({ where: { id: req.params.id }, data: req.body }); res.json(row); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  r.delete('/:id', requireRoles(...ADMIN), async (req, res) => {
    try { await prisma[model].delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });
  return r;
}

router.use('/programs', crud('program'));
router.use('/batches', crud('batch'));
router.use('/terms', crud('term'));
router.use('/courses', crud('course'));

// offerings with nested includes
router.get('/offerings', async (req, res) => {
  const rows = await prisma.offering.findMany({ include: { course: true, term: true, faculty: { include: { user: { select: { id: true, name: true, email: true } } } } }, take: 200 });
  res.json(rows);
});
router.post('/offerings', requireRoles(...ADMIN), async (req, res) => {
  try {
    const { facultyIds, ...data } = req.body;
    const off = await prisma.offering.create({ data });
    if (facultyIds && facultyIds.length) {
      await prisma.offeringFaculty.createMany({ data: facultyIds.map(userId => ({ offeringId: off.id, userId })) });
    }
    res.json(off);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/offerings/:id', requireRoles(...ADMIN), async (req, res) => {
  try { const row = await prisma.offering.update({ where: { id: req.params.id }, data: req.body }); res.json(row); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/offerings/:id', requireRoles(...ADMIN), async (req, res) => {
  try { await prisma.offering.delete({ where: { id: req.params.id } }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// enrollments
router.get('/enrollments', async (req, res) => {
  const where = req.query.offeringId ? { offeringId: req.query.offeringId } : req.query.userId ? { userId: req.query.userId } : {};
  res.json(await prisma.enrollment.findMany({ where, include: { user: { select: { id: true, name: true, email: true } }, offering: { include: { course: true, term: true } } }, take: 500 }));
});
router.post('/enrollments', requireRoles(...ADMIN, 'FACULTY'), async (req, res) => {
  try { res.json(await prisma.enrollment.create({ data: req.body })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
router.delete('/enrollments/:id', requireRoles(...ADMIN, 'FACULTY'), async (req, res) => {
  await prisma.enrollment.delete({ where: { id: req.params.id } }); res.json({ ok: true });
});

// users list (admin)
router.get('/users', requireRoles(...ADMIN), async (req, res) => {
  const q = req.query.role ? { role: req.query.role } : {};
  res.json(await prisma.user.findMany({ where: q, select: { id: true, name: true, email: true, role: true, isActive: true }, take: 500 }));
});
router.put('/users/:id', requireRoles(...ADMIN), async (req, res) => {
  const { role, isActive, name } = req.body;
  const allowed = ['SUPER_ADMIN', 'ADMIN_STAFF', 'FACULTY', 'TA', 'STUDENT', 'ALUMNI', 'MODERATOR'];
  if (role && !allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  // Prevent last SUPER_ADMIN deactivation: best-effort guard
  if (req.params.id === req.user.id && isActive === false) return res.status(400).json({ error: 'Cannot deactivate yourself' });
  try { res.json(await prisma.user.update({ where: { id: req.params.id }, data: { ...(role ? { role } : {}), ...(typeof isActive === 'boolean' ? { isActive } : {}), ...(name ? { name } : {}) }, select: { id: true, name: true, email: true, role: true, isActive: true } })); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
