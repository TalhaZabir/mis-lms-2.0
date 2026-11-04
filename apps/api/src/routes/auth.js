const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { sign, auth } = require('../auth');
const router = express.Router();

// POST /auth/register (admin creates users normally; open register for dev)
router.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name,email,password required' });
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(400).json({ error: 'Email exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { name, email, passwordHash, role: role || 'STUDENT' } });
  res.json({ token: sign(user), user: { id: user.id, name, email, role: user.role } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

router.get('/me', auth(), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { id: true, name: true, email: true, role: true } });
  res.json(user);
});

module.exports = router;
