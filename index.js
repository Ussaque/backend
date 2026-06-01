

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const multer = require('multer');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { createWorker } = require('tesseract.js');
const { parseMzBI } = require('./bi_parser');

// Supabase Storage client
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Multer: guarda em memória para depois enviar ao Supabase Storage
const upload = multer({ storage: multer.memoryStorage() });

// Helper: faz upload para Supabase Storage e devolve URL pública
async function uploadToStorage(file) {
  const ext = path.extname(file.originalname);
  const filename = `${Date.now()}-${uuidv4()}${ext}`;
  const { error } = await supabase.storage
    .from('uploads')
    .upload(filename, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
  return data.publicUrl;
}

const app = express();

// Run lightweight migrations on startup (PostgreSQL-safe)
(async () => {
  try {
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT TRUE');
    console.log('Migration: is_available column ready');
  } catch (e) {
    console.log('Migration note:', e.message);
  }
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        body TEXT,
        job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC)');
    console.log('Migration: notifications table ready');
  } catch (e) {
    console.log('Migration note:', e.message);
  }
})();

// Helper: cria uma notificação (fire-and-forget, não bloqueia a resposta)
async function notify(userId, type, title, body, jobId = null) {
  try {
    await db.query(
      'INSERT INTO notifications (user_id, type, title, body, job_id) VALUES (?, ?, ?, ?, ?)',
      [userId, type, title, body, jobId]
    );
  } catch (e) {
    console.error('notify error:', e.message);
  }
}

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Middlewares
app.use(cors());
app.use(express.json());

// ==========================================
// ROTAS DE SERVIÇOS (JOBS)
// ==========================================

// 1. Obter todos os trabalhos pendentes (Para o Mapa do Profissional)
app.get('/api/jobs/nearby', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    const radiusKm = parseFloat(radius) || 2; // raio por defeito: 2km

    if (lat && lng) {
      const profLat = parseFloat(lat);
      const profLng = parseFloat(lng);

      // Fórmula de Haversine em SQL — calcula distância entre as coords do profissional e cada job
      const [rows] = await db.query(`
        SELECT * FROM (
          SELECT *,
            (6371 * ACOS(
              COS(RADIANS(?)) * COS(RADIANS(latitude)) * COS(RADIANS(longitude) - RADIANS(?)) +
              SIN(RADIANS(?)) * SIN(RADIANS(latitude))
            )) AS distance_km
          FROM jobs
          WHERE status = 'PENDING'
            AND latitude IS NOT NULL
            AND longitude IS NOT NULL
        ) AS sub
        WHERE distance_km <= ?
        ORDER BY distance_km ASC
      `, [profLat, profLng, profLat, radiusKm]);

      const result = rows.map(job => ({
        ...job,
        latitude: parseFloat(job.latitude),
        longitude: parseFloat(job.longitude),
        distance: Number(job.distance_km).toFixed(1) + 'km',
      }));

      return res.json(result);
    }

    // Fallback sem localização: devolve todos os PENDING com distância simulada
    const [rows] = await db.query("SELECT * FROM jobs WHERE status = 'PENDING'");
    const jobsWithVirtualDistance = rows.map(job => ({
      ...job,
      latitude: parseFloat(job.latitude),
      longitude: parseFloat(job.longitude),
      distance: (Math.random() * 5 + 0.5).toFixed(1) + 'km',
    }));
    res.json(jobsWithVirtualDistance);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar trabalhos' });
  }
});
  // --- AUTH ROUTES ---
  const bcrypt = require('bcryptjs');
  app.post('/api/auth/register', async (req, res) => {
    try {
      const { name, email, password, role } = req.body;
      const [existing] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
      if (existing.length > 0) return res.status(400).json({ error: 'Email ja registado' });
      const hashedPassword = await bcrypt.hash(password, 10);
      const userId = uuidv4();
      const approvalStatus = role === 'PROFESSIONAL' ? 'PENDING_DOCS' : 'APPROVED';
      await db.query('INSERT INTO users (id, name, email, password, role, approval_status) VALUES (?, ?, ?, ?, ?, ?)', [userId, name, email, hashedPassword, role, approvalStatus]);
      const [newUser] = await db.query('SELECT id, name, email, role, avatar_url, approval_status FROM users WHERE id = ?', [userId]);
      res.status(201).json(newUser[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro ao registar utilizador' });
    }
  });
  
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
      if (users.length === 0) return res.status(400).json({ error: 'Credenciais invalidas' });
      const user = users[0];
      if (!user.password) return res.status(400).json({ error: 'Conta sem password' });
      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(400).json({ error: 'Credenciais invalidas' });
      delete user.password;
      res.json(user);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Erro no login' });
    }
  });
// 2. Cliente cria um novo pedido
app.post('/api/jobs', upload.single('photo'), async (req, res) => {
  try {
    const { client_id, category, description, address, latitude, longitude, price, scheduled_date, payment_method } = req.body || {};
    const jobId = uuidv4();
    let image_url = null;

    if (req.file) {
      try {
        image_url = await uploadToStorage(req.file);
      } catch (uploadErr) {
        console.error('Upload para Supabase falhou:', uploadErr?.message || uploadErr);
        // Continua sem imagem em vez de retornar 500
      }
    }

    const query = `
      INSERT INTO jobs
      (id, client_id, category, description, address, latitude, longitude, price, status, scheduled_date, image_url, payment_method)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)    `;

    await db.query(query, [jobId, client_id, category, description, address, latitude, longitude, price, scheduled_date, image_url, payment_method]);
        // Retornar o job recém criado
    const [newJob] = await db.query('SELECT * FROM jobs WHERE id = ?', [jobId]);
    res.status(201).json(newJob[0]);
  } catch (error) {
    console.error('POST /jobs error:', error);
    res.status(500).json({ error: 'Erro ao criar o pedido', detail: error?.message || String(error) });
  }
});

// 3. Profissional aceita um pedido (Muda o Status)
app.put('/api/jobs/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;
    const { professional_id } = req.body;

    // Verifica se já não foi aceite por outro
    const [jobCheck] = await db.query('SELECT status FROM jobs WHERE id = ?', [id]);
    if (jobCheck.length === 0) return res.status(404).json({ error: 'Trabalho não encontrado' });
    if (jobCheck[0].status !== 'PENDING') return res.status(400).json({ error: 'Este trabalho já não está disponível' });

    // Verifica aprovação do profissional
    const [profCheck] = await db.query('SELECT approval_status FROM users WHERE id = ?', [professional_id]);
    if (!profCheck.length || profCheck[0].approval_status !== 'APPROVED') {
      return res.status(403).json({ error: 'A tua conta ainda não foi aprovada pelo administrador.' });
    }

    await db.query(
      "UPDATE jobs SET status = 'ACCEPTED', professional_id = ? WHERE id = ?",
      [professional_id, id]
    );

    res.json({ message: 'Trabalho aceite com sucesso!', jobId: id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao aceitar trabalho' });
  }
});

// 3.5 Marcar como concluído
app.put('/api/jobs/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query("UPDATE jobs SET status = 'COMPLETED', completed_at = NOW() WHERE id = ?", [id]);

    // Notificar cliente
    const [jInfo] = await db.query('SELECT client_id, category FROM jobs WHERE id = ?', [id]);
    if (jInfo.length > 0) {
      notify(
        jInfo[0].client_id,
        'JOB_COMPLETED',
        'Trabalho concluído! ✅',
        `O profissional marcou "${jInfo[0].category || 'o pedido'}" como concluído. Avalia o serviço!`,
        id
      );
    }

    res.json({ message: 'Trabalho concluído com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao concluir o trabalho' });
  }
});

// 3.6 Profissional inicia o trabalho (ACCEPTED → IN_PROGRESS)
app.put('/api/jobs/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const [jobCheck] = await db.query('SELECT status FROM jobs WHERE id = ?', [id]);
    if (jobCheck.length === 0) return res.status(404).json({ error: 'Trabalho não encontrado' });
    if (jobCheck[0].status !== 'ACCEPTED') return res.status(400).json({ error: 'O trabalho já foi iniciado ou não está aceite' });
    await db.query("UPDATE jobs SET status = 'IN_PROGRESS', started_at = NOW() WHERE id = ?", [id]);
    res.json({ message: 'Trabalho iniciado!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao iniciar o trabalho' });
  }
});

// 4. Obter histórico de trabalhos de um Cliente específico
app.get('/api/users/:userId/jobs', async (req, res) => {
  try {
    const { userId } = req.params;
    const role = req.query.role || 'client';

    if (role === 'professional') {
      // Jobs onde já é o profissional contratado OU onde se candidatou
      const [rows] = await db.query(
        `SELECT j.*, ja.status as application_status
         FROM jobs j
         LEFT JOIN job_applications ja ON ja.job_id = j.id AND ja.professional_id = ?
         WHERE j.professional_id = ? OR ja.professional_id = ?
         ORDER BY j.created_at DESC`,
        [userId, userId, userId]
      );
      return res.json(rows);
    }

    const [rows] = await db.query(
      `SELECT j.*,
              u.name as proName,
              (SELECT COUNT(*)::int FROM recommendations r WHERE r.job_id = j.id) as has_recommendation
       FROM jobs j
       LEFT JOIN users u ON j.professional_id = u.id
       WHERE j.client_id = ?
       ORDER BY j.created_at DESC`,
      [userId]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar histórico' });
  }
});

// Rota especial para o desenvolvedor: Se nao existir um cliente mock, cria um
app.post('/api/dev/init', async (req, res) => {
  try {
    const defaultClientId = 'cli-1234';
    const [existing] = await db.query('SELECT * FROM users WHERE id = ?', [defaultClientId]);
    
    if (existing.length === 0) {
      await db.query(
        'INSERT INTO users (id, name, email, role) VALUES (?, ?, ?, ?, ?)',
        [defaultClientId, 'Cliente Teste', 'cliente@teste.com', 'CLIENT']
      );
      return res.json({ message: 'Cliente mockado criado com sucesso!' });
    }
    
    res.json({ message: 'Cliente mockado já existe.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro no dev init', details: error.message });
  }
});

// ==========================================
// ROTAS DO CHAT (MENSAGENS)
// ==========================================

// 5. Obter as mensagens de um Trabalho
app.get('/api/jobs/:jobId/messages', async (req, res) => {
  try {
    const { jobId } = req.params;
    const [messages] = await db.query(
      'SELECT * FROM messages WHERE job_id = ? ORDER BY created_at ASC', 
      [jobId]
    );
    res.json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

// 6. Enviar uma nova mensagem
app.post('/api/jobs/:jobId/messages', async (req, res) => {
  try {
    const { jobId } = req.params;
    const { sender_id, text } = req.body;

    await db.query(
      'INSERT INTO messages (job_id, sender_id, text) VALUES (?, ?, ?)',
      [jobId, sender_id, text]
    );

    res.status(201).json({ success: true, text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao gravar mensagem' });
  }
});

// Health check
app.get('/api', (req, res) => res.send('API Funcionando :D '));
  app.get('/', (req, res) => res.send('API Yango Services Online 🚗'));

// ==========================================
// SISTEMA DE CANDIDATURAS
// ==========================================

// Profissional candidata-se a um pedido
app.post('/api/jobs/:id/apply', async (req, res) => {
  try {
    const { id } = req.params;
    const { professional_id, message, proposed_price } = req.body;
    if (!professional_id) return res.status(400).json({ error: 'professional_id obrigatório' });
    if (!proposed_price || isNaN(parseFloat(proposed_price)) || parseFloat(proposed_price) <= 0) return res.status(400).json({ error: 'proposed_price obrigatório e deve ser maior que 0' });

    const [jobCheck] = await db.query('SELECT status FROM jobs WHERE id = ?', [id]);
    if (jobCheck.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (jobCheck[0].status !== 'PENDING') return res.status(400).json({ error: 'Este pedido já não aceita candidaturas' });

    // Verificar se o profissional está disponível
    const [profCheck] = await db.query('SELECT is_available FROM users WHERE id = ?', [professional_id]);
    if (profCheck.length === 0) return res.status(404).json({ error: 'Profissional não encontrado' });
    if (!profCheck[0].is_available) return res.status(400).json({ error: 'Não estás disponível para aceitar novos pedidos' });

    const appId = uuidv4();
    await db.query(
      'INSERT INTO job_applications (id, job_id, professional_id, message, proposed_price) VALUES (?, ?, ?, ?, ?)',
      [appId, id, professional_id, message || null, proposed_price ? parseFloat(proposed_price) : null]
    );

    // Notificar cliente
    const [jobInfo] = await db.query('SELECT client_id, category FROM jobs WHERE id = ?', [id]);
    const [proInfo] = await db.query('SELECT name FROM users WHERE id = ?', [professional_id]);
    if (jobInfo.length > 0 && proInfo.length > 0) {
      notify(
        jobInfo[0].client_id,
        'NEW_APPLICANT',
        'Novo candidato! 👤',
        `${proInfo[0].name} candidatou-se ao teu pedido “${jobInfo[0].title || 'sem título'}”.`,
        id
      );
    }

    res.status(201).json({ message: 'Candidatura enviada com sucesso!', id: appId });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Já te candidataste a este pedido' });
    console.error(error);
    res.status(500).json({ error: 'Erro ao enviar candidatura' });
  }
});

// Cliente vê os candidatos de um pedido (ordenados por score)
app.get('/api/jobs/:id/applications', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(`
      SELECT ja.id, ja.job_id, ja.professional_id, ja.message, ja.applied_at, ja.proposed_price,
             u.name, u.rating, u.rating_count, u.avatar_url,
             u.specialty, u.experience_years, u.province, u.verified_skills,
             u.recommendation_count
      FROM job_applications ja
      JOIN users u ON ja.professional_id = u.id
      WHERE ja.job_id = ? AND ja.status = 'PENDING'
    `, [id]);

    if (rows.length === 0) return res.json([]);

    // Calcular score composto para ordenação
    // Normalizar cada dimensão entre 0 e 1 dentro do grupo
    const maxRating = Math.max(...rows.map(r => Number(r.rating) || 0));
    const maxCount  = Math.max(...rows.map(r => Number(r.rating_count) || 0));
    const maxExp    = Math.max(...rows.map(r => Number(r.experience_years) || 0));
    const minPrice  = Math.min(...rows.map(r => Number(r.proposed_price) || Infinity));
    const maxPrice  = Math.max(...rows.map(r => Number(r.proposed_price) || 0));

    const scored = rows.map(r => {
      const ratingNorm = maxRating > 0 ? (Number(r.rating) || 0) / maxRating : 0;
      const countNorm  = maxCount  > 0 ? (Number(r.rating_count) || 0) / maxCount : 0;
      const expNorm    = maxExp    > 0 ? (Number(r.experience_years) || 0) / maxExp : 0;
      const priceRange = maxPrice - minPrice;
      const priceNorm  = priceRange > 0
        ? 1 - ((Number(r.proposed_price) || maxPrice) - minPrice) / priceRange
        : 1;

      // Pesos: avaliação 40%, contagem 20%, experiência 20%, preço 20%
      const score = ratingNorm * 0.4 + countNorm * 0.2 + expNorm * 0.2 + priceNorm * 0.2;
      return { ...r, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Atribuir badges
    const bestRated = scored.reduce((a, b) => Number(b.rating) > Number(a.rating) ? b : a, scored[0]);
    const bestPrice = scored.reduce((a, b) => Number(b.proposed_price) < Number(a.proposed_price) ? b : a, scored[0]);
    const mostExp   = scored.reduce((a, b) => Number(b.experience_years) > Number(a.experience_years) ? b : a, scored[0]);

    const result = scored.map(({ score, ...r }) => ({
      ...r,
      verified_skills: r.verified_skills ? JSON.parse(r.verified_skills) : [],
      badges: [
        r.professional_id === bestRated.professional_id && Number(r.rating) > 0 ? '🏆 Melhor avaliado' : null,
        r.professional_id === bestPrice.professional_id && scored.length > 1 ? '💰 Melhor preço' : null,
        r.professional_id === mostExp.professional_id && Number(r.experience_years) > 0 ? '⭐ Mais experiente' : null,
        Number(r.recommendation_count) > 0 ? `👍 ${r.recommendation_count} recomendação${r.recommendation_count > 1 ? 'ões' : ''}` : null,
      ].filter(Boolean),
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar candidatos' });
  }
});

// Cliente contrata um profissional (escolhe um candidato)
app.put('/api/jobs/:id/hire/:professionalId', async (req, res) => {
  try {
    const { id, professionalId } = req.params;

    const [jobCheck] = await db.query('SELECT status FROM jobs WHERE id = ?', [id]);
    if (jobCheck.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (jobCheck[0].status !== 'PENDING') return res.status(400).json({ error: 'Este pedido já foi aceite' });

    // Get the proposed price from the accepted application
    const [appRows] = await db.query(
      'SELECT proposed_price FROM job_applications WHERE job_id = ? AND professional_id = ?',
      [id, professionalId]
    );
    const acceptedPrice = appRows.length > 0 ? appRows[0].proposed_price : null;

    await db.query(
      "UPDATE jobs SET status = 'ACCEPTED', professional_id = ?, price = COALESCE(?, price), hired_at = NOW() WHERE id = ?",
      [professionalId, acceptedPrice, id]
    );
    await db.query(
      "UPDATE job_applications SET status = 'ACCEPTED' WHERE job_id = ? AND professional_id = ?",
      [id, professionalId]
    );
    await db.query(
      "UPDATE job_applications SET status = 'REJECTED' WHERE job_id = ? AND professional_id != ?",
      [id, professionalId]
    );

    // Notificar profissional contratado
    const [jInfo] = await db.query('SELECT category, client_id FROM jobs WHERE id = ?', [id]);
    notify(
      professionalId,
      'HIRED',
      'Foste contratado! 🎉',
      `O cliente aceitou a tua candidatura para “${jInfo[0]?.category || 'pedido'}”.`,
      id
    );

    // Notificar profissionais rejeitados
    const [rejected] = await db.query(
      "SELECT professional_id FROM job_applications WHERE job_id = ? AND status = 'REJECTED'",
      [id]
    );
    for (const r of rejected) {
      notify(
        r.professional_id,
        'REJECTED',
        'Candidatura não selecionada',
        `O cliente escolheu outro profissional para “${jInfo[0]?.category || 'o pedido'}”.`,
        id
      );
    }

    res.json({ message: 'Profissional contratado com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao contratar profissional' });
  }
});

// Cliente recomenda um profissional após conclusão do trabalho
app.post('/api/jobs/:id/recommend', async (req, res) => {
  try {
    const { id } = req.params;
    const { client_id } = req.body;
    if (!client_id) return res.status(400).json({ error: 'client_id obrigatório' });

    const [jobCheck] = await db.query(
      'SELECT status, professional_id, client_id FROM jobs WHERE id = ?', [id]
    );
    if (jobCheck.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (jobCheck[0].status !== 'COMPLETED') return res.status(400).json({ error: 'Só podes recomendar após conclusão do trabalho' });
    if (jobCheck[0].client_id !== client_id) return res.status(403).json({ error: 'Não tens permissão para recomendar neste pedido' });

    const professionalId = jobCheck[0].professional_id;
    const recId = uuidv4();

    await db.query(
      'INSERT INTO recommendations (id, job_id, from_client_id, to_professional_id) VALUES (?, ?, ?, ?)',
      [recId, id, client_id, professionalId]
    );
    await db.query(
      'UPDATE users SET recommendation_count = recommendation_count + 1 WHERE id = ?',
      [professionalId]
    );

    res.status(201).json({ message: 'Profissional recomendado com sucesso!' });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Já recomendaste este profissional neste pedido' });
    console.error(error);
    res.status(500).json({ error: 'Erro ao recomendar profissional' });
  }
});

// Cliente avalia o profissional após conclusão
app.post('/api/jobs/:id/review', upload.fields([{ name: 'before_photo', maxCount: 1 }, { name: 'after_photo', maxCount: 1 }]), async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewer_id, rating, comment } = req.body;
    if (!reviewer_id || !rating) return res.status(400).json({ error: 'reviewer_id e rating são obrigatórios' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating deve ser entre 1 e 5' });

    const [jobCheck] = await db.query(
      'SELECT status, professional_id FROM jobs WHERE id = ?', [id]
    );
    if (jobCheck.length === 0) return res.status(404).json({ error: 'Pedido não encontrado' });
    if (jobCheck[0].status !== 'COMPLETED') return res.status(400).json({ error: 'O pedido ainda não foi concluído' });

    const professionalId = jobCheck[0].professional_id;
    const reviewId = uuidv4();

    const beforeFile = req.files?.before_photo?.[0];
    const afterFile = req.files?.after_photo?.[0];
    const beforeUrl = beforeFile ? await uploadToStorage(beforeFile) : null;
    const afterUrl = afterFile ? await uploadToStorage(afterFile) : null;

    await db.query(
      'INSERT INTO reviews (id, job_id, reviewer_id, professional_id, rating, comment, before_photo_url, after_photo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [reviewId, id, reviewer_id, professionalId, rating, comment || null, beforeUrl, afterUrl]
    );

    // Recalcular média do profissional
    const [[avgRow]] = await db.query(
      'SELECT AVG(rating) as avg_rating, COUNT(*) as total FROM reviews WHERE professional_id = ?',
      [professionalId]
    );
    await db.query(
      'UPDATE users SET rating = ?, rating_count = ? WHERE id = ?',
      [parseFloat(avgRow.avg_rating).toFixed(2), avgRow.total, professionalId]
    );

    res.status(201).json({ message: 'Avaliação submetida com sucesso!' });
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: 'Já avaliaste este pedido' });
    console.error(error);
    res.status(500).json({ error: 'Erro ao submeter avaliação' });
  }
});

// Pesquisa de profissionais aprovados com filtros
app.get('/api/professionals', async (req, res) => {
  try {
    const { specialty, province, min_rating, q } = req.query;
    const conditions = ["role = 'PROFESSIONAL'", "approval_status = 'APPROVED'", "is_available = true"];
    const params = [];

    if (q && q.trim()) {
      conditions.push('(name LIKE ? OR specialty LIKE ?)');
      params.push(`%${q.trim()}%`, `%${q.trim()}%`);
    }
    if (specialty && specialty.trim()) {
      conditions.push('specialty LIKE ?');
      params.push(`%${specialty.trim()}%`);
    }
    if (province && province.trim()) {
      conditions.push('province = ?');
      params.push(province.trim());
    }
    if (min_rating) {
      conditions.push('rating >= ?');
      params.push(parseFloat(min_rating));
    }

    const sql = `SELECT id, name, avatar_url, specialty, experience_years, province, rating, rating_count, bio, recommendation_count, verified_skills FROM users WHERE ${conditions.join(' AND ')} ORDER BY rating DESC, rating_count DESC LIMIT 50`;
    const [rows] = await db.query(sql, params);
    res.json(rows.map(r => ({ ...r, verified_skills: r.verified_skills ? JSON.parse(r.verified_skills) : [] })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao pesquisar profissionais' });
  }
});

// Toggle disponibilidade do profissional
app.put('/api/users/:id/availability', async (req, res) => {
  try {
    const { is_available } = req.body;
    await db.query('UPDATE users SET is_available = ? WHERE id = ?', [is_available ? 1 : 0, req.params.id]);
    res.json({ is_available: !!is_available });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao actualizar disponibilidade' });
  }
});

// Ganhos do profissional (sumário + histórico)
app.get('/api/users/:id/earnings', async (req, res) => {
  try {
    const { period } = req.query; // 'today' | 'week' | 'month' | 'all'
    const id = req.params.id;

    let dateFilter = '';
    if (period === 'today')  dateFilter = "AND DATE(j.completed_at) = CURRENT_DATE";
    else if (period === 'week')  dateFilter = "AND j.completed_at >= CURRENT_DATE - INTERVAL '7 days'";
    else if (period === 'month') dateFilter = "AND j.completed_at >= CURRENT_DATE - INTERVAL '30 days'";

    const [jobs] = await db.query(
      `SELECT j.id, j.category, j.price, j.completed_at, j.address,
              u.name as client_name
       FROM jobs j
       LEFT JOIN users u ON j.client_id = u.id
       WHERE j.professional_id = ? AND j.status = 'COMPLETED' ${dateFilter}
       ORDER BY j.completed_at DESC`,
      [id]
    );

    const [stats] = await db.query(
      `SELECT
         COUNT(*) as total_jobs,
         COALESCE(SUM(price), 0) as total_earned,
         COALESCE(SUM(CASE WHEN DATE(completed_at) = CURRENT_DATE THEN price ELSE 0 END), 0) as today_earned,
         COALESCE(SUM(CASE WHEN completed_at >= CURRENT_DATE - INTERVAL '7 days' THEN price ELSE 0 END), 0) as week_earned,
         COALESCE(SUM(CASE WHEN completed_at >= CURRENT_DATE - INTERVAL '30 days' THEN price ELSE 0 END), 0) as month_earned
       FROM jobs
       WHERE professional_id = ? AND status = 'COMPLETED'`,
      [id]
    );

    // Pedidos pendentes (candidaturas HIRED ou IN_PROGRESS)
    const [pending] = await db.query(
      `SELECT j.id, j.category, j.address, j.price, j.status, j.scheduled_date, j.created_at,
              u.name as client_name
       FROM jobs j
       LEFT JOIN users u ON j.client_id = u.id
       WHERE j.professional_id = ? AND j.status IN ('ACCEPTED','IN_PROGRESS')
       ORDER BY j.scheduled_date ASC, j.created_at DESC`,
      [id]
    );

    res.json({ stats: stats[0], jobs, pending });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar ganhos' });
  }
});

// Agenda semanal (serviços confirmados por data)
app.get('/api/users/:id/schedule', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT j.id, j.category, j.address, j.price, j.status, j.scheduled_date,
              u.name as client_name, u.telefone as client_phone
       FROM jobs j
       LEFT JOIN users u ON j.client_id = u.id
       WHERE j.professional_id = ?
         AND j.status IN ('ACCEPTED', 'IN_PROGRESS', 'COMPLETED')
         AND j.scheduled_date >= CURRENT_DATE - INTERVAL '7 days'
       ORDER BY j.scheduled_date ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar agenda' });
  }
});

// Avaliações recebidas por um profissional
app.get('/api/users/:id/reviews', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.rating, r.comment, r.before_photo_url, r.after_photo_url, r.created_at,
              u.name as reviewer_name, u.avatar_url as reviewer_avatar
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.professional_id = ?
       ORDER BY r.created_at DESC
       LIMIT 30`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar avaliações' });
  }
});

require('./admin_routes')(app, db);

// ==========================================
// NOTIFICAÇÕES
// ==========================================

app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, type, title, body, job_id, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.params.userId]
    );
    const unread = rows.filter(n => !n.is_read).length;
    res.json({ notifications: rows, unread });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar notificações' });
  }
});

app.put('/api/notifications/:id/read', async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro' });
  }
});

app.put('/api/notifications/read-all/:userId', async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [req.params.userId]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor a correr na porta http://localhost:${PORT}`);
});
// 4. Salvar/Atualizar Perfil Profissional
app.post('/api/professionals/profile', async (req, res) => {
  try {
    const { user_id, nome, specialty, experience_years, province, bairro, institution, course_name, graduation_year, is_student, bio, telefone, bi, date_of_birth, gender } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obrigatório' });
    await db.query(
      'UPDATE users SET specialty = ?, experience_years = ?, province = ?, bairro = ?, name = COALESCE(?, name), institution = ?, course_name = ?, graduation_year = ?, is_student = ?, bio = ?, telefone = ?, bi = ?, date_of_birth = COALESCE(?, date_of_birth), gender = COALESCE(?, gender) WHERE id = ?',
      [specialty || null, experience_years || 0, province || null, bairro || null, nome || null, institution || null, course_name || null, graduation_year || null, is_student ? 1 : 0, bio || null, telefone || null, bi || null, date_of_birth || null, gender || null, user_id]
    );

    // Verificar se cumpre todos os requisitos antes de passar para PENDING_REVIEW
    const [rows] = await db.query(
      'SELECT approval_status, specialty, province, bio, experience_years, avatar_url, cert_pdf_url, bi, telefone, name FROM users WHERE id = ?',
      [user_id]
    );
    const u = rows[0];
    const missing = [];
    if (!u.name)                       missing.push('Nome');
    if (!u.bi)                         missing.push('Bilhete de Identidade (BI)');
    if (!u.telefone)                   missing.push('Telefone');
    if (!u.specialty)                  missing.push('Especialidade');
    if (!u.province)                   missing.push('Província');
    if (!u.bio || u.bio.length < 20)   missing.push('Descrição/Bio (mínimo 20 caracteres)');
    if (!u.experience_years || u.experience_years < 1) missing.push('Anos de experiência');
    if (!u.avatar_url)                 missing.push('Foto de perfil');
    if (!u.cert_pdf_url)               missing.push('Certificado / documento PDF');

    if (missing.length > 0) {
      return res.status(422).json({
        error: 'Perfil incompleto. Preenche todos os requisitos para submeter.',
        missing,
      });
    }

    // Todos os requisitos cumpridos — transicionar para PENDING_REVIEW
    await db.query(
      "UPDATE users SET approval_status = 'PENDING_REVIEW' WHERE id = ? AND approval_status IN ('PENDING_DOCS', 'REJECTED')",
      [user_id]
    );
    const [updatedUser] = await db.query('SELECT approval_status FROM users WHERE id = ?', [user_id]);
    res.status(200).json({ message: 'Perfil guardado e submetido para revisão!', approval_status: updatedUser[0]?.approval_status });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao salvar perfil' });
  }
});

// Obter perfil de um utilizador
app.get('/api/users/:id/profile', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, name, email, role, avatar_url, rating, rating_count, specialty, experience_years, province, verified_skills, institution, course_name, graduation_year, is_student, cert_pdf_url, bio, recommendation_count, approval_status, rejection_reason, bi, telefone, date_of_birth, gender, bi_front_url, bi_back_url, is_available FROM users WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Utilizador não encontrado' });
    const user = rows[0];
    user.verified_skills = user.verified_skills ? JSON.parse(user.verified_skills) : [];
    user.is_student = !!user.is_student;
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar perfil' });
  }
});

// Upload de certificado PDF
const uploadPdf = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Apenas ficheiros PDF são aceites'), false);
  }
});

app.post('/api/users/:id/cert-pdf', uploadPdf.single('cert_pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    const certUrl = await uploadToStorage(req.file);
    await db.query('UPDATE users SET cert_pdf_url = ? WHERE id = ?', [certUrl, req.params.id]);
    res.json({ cert_pdf_url: certUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Erro ao fazer upload do certificado' });
  }
});

// Digitalização de BI (frente + verso) com OCR
const uploadBiFields = multer({ storage: multer.memoryStorage() }).fields([
  { name: 'bi_front', maxCount: 1 },
  { name: 'bi_back',  maxCount: 1 },
]);

app.post('/api/users/:id/bi-scan', uploadBiFields, async (req, res) => {
  const frontFile = req.files?.bi_front?.[0];
  const backFile  = req.files?.bi_back?.[0];
  if (!frontFile) return res.status(400).json({ error: 'Foto da frente do BI é obrigatória' });

  const frontUrl = await uploadToStorage(frontFile);
  const backUrl  = backFile ? await uploadToStorage(backFile) : null;

  // Guardar URLs das fotos imediatamente
  await db.query(
    'UPDATE users SET bi_front_url = ?, bi_back_url = COALESCE(?, bi_back_url) WHERE id = ?',
    [frontUrl, backUrl, req.params.id]
  );

  try {
    // OCR na frente (onde estão os dados pessoais)
    const worker = await createWorker(['por', 'eng']);
    const { data: { text: frontText } } = await worker.recognize(frontFile.buffer);
    let allText = frontText;
    if (backFile) {
      const { data: { text: backText } } = await worker.recognize(backFile.buffer);
      allText += '\n' + backText;
    }
    await worker.terminate();

    const extracted = parseMzBI(allText);

    // Persistir campos extraídos que existam
    const updates = [];
    const values  = [];
    if (extracted.bi)            { updates.push('bi = ?');            values.push(extracted.bi); }
    if (extracted.name)          { updates.push('name = ?');          values.push(extracted.name); }
    if (extracted.date_of_birth) { updates.push('date_of_birth = ?'); values.push(extracted.date_of_birth); }
    if (extracted.gender)        { updates.push('gender = ?');        values.push(extracted.gender); }
    if (extracted.province)      { updates.push('province = ?');      values.push(extracted.province); }
    if (extracted.residence)     { updates.push('bairro = ?');        values.push(extracted.residence); }

    if (updates.length > 0) {
      values.push(req.params.id);
      await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    res.json({
      success: true,
      bi_front_url: frontUrl,
      bi_back_url:  backUrl,
      extracted,
    });
  } catch (ocrErr) {
    console.error('OCR error:', ocrErr);
    // Falhou o OCR mas as fotos foram guardadas — retorna sem dados extraídos
    res.json({
      success: false,
      bi_front_url: frontUrl,
      bi_back_url: backUrl,
      extracted: {},
      warning: 'Não foi possível ler os dados automaticamente. Por favor preenche manualmente.',
    });
  }
});

// Actualizar dados básicos do perfil (cliente ou profissional)
app.put('/api/users/:id/profile', async (req, res) => {
  try {
    const { name, telefone, province } = req.body;
    await db.query(
      'UPDATE users SET name = COALESCE(NULLIF(?, \'\'), name), telefone = ?, province = ? WHERE id = ?',
      [name || null, telefone || null, province || null, req.params.id]
    );
    const [rows] = await db.query(
      'SELECT id, name, email, role, avatar_url, telefone, province, approval_status FROM users WHERE id = ?',
      [req.params.id]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao actualizar perfil' });
  }
});

// Upload de foto de perfil (avatar)
app.post('/api/users/:id/avatar', upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    const avatarUrl = await uploadToStorage(req.file);
    await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.params.id]);
    res.json({ avatar_url: avatarUrl });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao fazer upload do avatar' });
  }
});

// Upload de fotos de portfólio (máx 6)
app.post('/api/users/:id/portfolio', upload.array('photos', 6), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'Nenhum ficheiro enviado' });
    const userId = req.params.id;

    // Verificar quantas fotos já tem
    const [existing] = await db.query('SELECT COUNT(*) as count FROM portfolio_photos WHERE user_id = ?', [userId]);
    const currentCount = existing[0].count;
    if (currentCount + req.files.length > 6) {
      return res.status(400).json({ error: `Só podes ter no máximo 6 fotos. Tens ${currentCount} e estás a tentar adicionar ${req.files.length}.` });
    }

    const inserted = [];
    for (const file of req.files) {
      const photoId = uuidv4();
      const photoUrl = await uploadToStorage(file);
      await db.query(
        'INSERT INTO portfolio_photos (id, user_id, photo_url) VALUES (?, ?, ?)',
        [photoId, userId, photoUrl]
      );
      inserted.push({ id: photoId, photo_url: photoUrl });
    }
    res.json(inserted);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao fazer upload das fotos' });
  }
});

// Obter fotos de portfólio de um profissional
app.get('/api/users/:id/portfolio', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, photo_url, caption, created_at FROM portfolio_photos WHERE user_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar portfólio' });
  }
});

// Apagar foto de portfólio
app.delete('/api/portfolio/:photoId', async (req, res) => {
  try {
    await db.query('DELETE FROM portfolio_photos WHERE id = ?', [req.params.photoId]);
    res.json({ message: 'Foto removida' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao remover foto' });
  }
});

// ==========================================
// RASTREIO EM TEMPO REAL
// ==========================================

// Profissional actualiza a sua localização actual
app.put('/api/users/:id/location', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) return res.status(400).json({ error: 'lat e lng obrigatórios' });
    await db.query(
      'UPDATE users SET current_lat = ?, current_lng = ?, location_updated_at = NOW() WHERE id = ?',
      [lat, lng, req.params.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao actualizar localização' });
  }
});

// Cliente obtém localização actual do profissional para um job aceite
app.get('/api/jobs/:id/tracking', async (req, res) => {
  try {
    const { id } = req.params;
    const [jobs] = await db.query(
      'SELECT j.latitude as job_lat, j.longitude as job_lng, j.status, j.professional_id, u.current_lat, u.current_lng, u.location_updated_at, u.name as pro_name ' +
      'FROM jobs j LEFT JOIN users u ON j.professional_id = u.id WHERE j.id = ?',
      [id]
    );
    if (jobs.length === 0) return res.status(404).json({ error: 'Job não encontrado' });
    const job = jobs[0];
    if (job.status !== 'ACCEPTED' && job.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: 'O profissional ainda não foi contratado' });
    }
    res.json({
      job_lat: parseFloat(job.job_lat),
      job_lng: parseFloat(job.job_lng),
      pro_lat: job.current_lat != null ? parseFloat(job.current_lat) : null,
      pro_lng: job.current_lng != null ? parseFloat(job.current_lng) : null,
      pro_name: job.pro_name,
      location_updated_at: job.location_updated_at,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar localização' });
  }
});
