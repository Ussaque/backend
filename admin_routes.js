module.exports = function(app, db) {
  // admin dashboard stats
  app.get('/api/admin/stats', async (req, res) => {
    try {
      const [[userRows]] = await db.query('SELECT COUNT(*) as count FROM users');
      const [[jobRows]] = await db.query('SELECT COUNT(*) as count FROM jobs');
      const [[pendingJobs]] = await db.query('SELECT COUNT(*) as count FROM jobs WHERE status = "PENDING"');
      const [[revenueRows]] = await db.query('SELECT SUM(price) as total FROM jobs WHERE status = "COMPLETED"');
      res.json({
        totalUsers: userRows.count,
        totalJobs: jobRows.count,
        pendingJobs: pendingJobs.count,
        totalRevenue: revenueRows.total || 0,
      });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar métricas' });
    }
  });

  // admin users
  app.get('/api/admin/users', async (req, res) => {
    try {
      const [users] = await db.query('SELECT id, name, email, role, avatar_url, created_at, approval_status, rejection_reason FROM users ORDER BY created_at DESC');
      res.json(users);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar users' });
    }
  });

  // admin update user role
  app.put('/api/admin/users/:id/role', async (req, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;
      await db.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
      res.json({ message: 'User updated' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar user' });
    }
  });

  // admin: get professional verified skills
  app.get('/api/admin/users/:id/skills', async (req, res) => {
    try {
      const [rows] = await db.query('SELECT verified_skills FROM users WHERE id = ?', [req.params.id]);
      if (rows.length === 0) return res.status(404).json({ error: 'Utilizador não encontrado' });
      res.json({ verified_skills: rows[0].verified_skills ? JSON.parse(rows[0].verified_skills) : [] });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao buscar competências' });
    }
  });

  // admin: set professional verified skills
  app.put('/api/admin/users/:id/skills', async (req, res) => {
    try {
      const { id } = req.params;
      const { skills } = req.body; // array of strings
      if (!Array.isArray(skills)) return res.status(400).json({ error: 'skills deve ser um array' });
      await db.query('UPDATE users SET verified_skills = ? WHERE id = ?', [JSON.stringify(skills), id]);
      res.json({ message: 'Competências atualizadas', verified_skills: skills });
    } catch (error) {
      res.status(500).json({ error: 'Erro ao atualizar competências' });
    }
  });

  // admin jobs
  app.get('/api/admin/jobs', async (req, res) => {
    try {
      const [jobs] = await db.query(`
        SELECT j.*, u.name as client_name, p.name as professional_name 
        FROM jobs j
        LEFT JOIN users u ON j.client_id = u.id
        LEFT JOIN users p ON j.professional_id = p.id
        ORDER BY j.created_at DESC
      `);
      res.json(jobs);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar jobs' });
    }
  });

  // admin update job status
  const VALID_STATUSES = ['PENDING', 'ACCEPTED', 'COMPLETED', 'CANCELLED'];
  app.put('/api/admin/jobs/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: 'Status inválido' });
      }
      const [result] = await db.query('UPDATE jobs SET status = ? WHERE id = ?', [status, id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
      res.json({ message: 'Status atualizado', status });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao atualizar status' });
    }
  });

  // admin: listar profissionais aguardando aprovação
  app.get('/api/admin/professionals/pending', async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT id, name, email, avatar_url, specialty, province, experience_years, bio, cert_pdf_url, created_at
         FROM users
         WHERE role = 'PROFESSIONAL' AND approval_status = 'PENDING_REVIEW'
         ORDER BY created_at ASC`
      );
      res.json(rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao buscar profissionais pendentes' });
    }
  });

  // admin: aprovar profissional
  app.put('/api/admin/professionals/:id/approve', async (req, res) => {
    try {
      const { id } = req.params;
      await db.query("UPDATE users SET approval_status = 'APPROVED', rejection_reason = NULL WHERE id = ? AND role = 'PROFESSIONAL'", [id]);
      res.json({ message: 'Profissional aprovado' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao aprovar profissional' });
    }
  });

  // admin: rejeitar profissional
  app.put('/api/admin/professionals/:id/reject', async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: 'Motivo de rejeição obrigatório' });
      await db.query("UPDATE users SET approval_status = 'REJECTED', rejection_reason = ? WHERE id = ? AND role = 'PROFESSIONAL'", [reason, id]);
      res.json({ message: 'Profissional rejeitado' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao rejeitar profissional' });
    }
  });

  // admin delete job
  app.delete('/api/admin/jobs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await db.query('DELETE FROM messages WHERE job_id = ?', [id]);
      const [result] = await db.query('DELETE FROM jobs WHERE id = ?', [id]);
      if (result.affectedRows === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
      res.json({ message: 'Pedido eliminado' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao eliminar pedido' });
    }
  });
};
