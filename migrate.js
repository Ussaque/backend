const db = require('./database');

async function migrate() {
  // Base tables (must exist before ALTER TABLE statements)
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NULL,
        role ENUM('CLIENT', 'PROFESSIONAL', 'ADMIN') NOT NULL DEFAULT 'CLIENT',
        approval_status ENUM('PENDING', 'APPROVED', 'REJECTED') DEFAULT 'PENDING',
        phone VARCHAR(50) DEFAULT NULL,
        avatar_url VARCHAR(500) DEFAULT NULL,
        bio TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('users table ready');
  } catch(e) { console.log(e.message); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id VARCHAR(36) PRIMARY KEY,
        client_id VARCHAR(36) NOT NULL,
        professional_id VARCHAR(36) DEFAULT NULL,
        category VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        address VARCHAR(500) DEFAULT NULL,
        latitude DECIMAL(10,8) DEFAULT NULL,
        longitude DECIMAL(11,8) DEFAULT NULL,
        price DECIMAL(10,2) DEFAULT NULL,
        status ENUM('PENDING','ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED') DEFAULT 'PENDING',
        scheduled_date DATETIME DEFAULT NULL,
        image_url VARCHAR(500) DEFAULT NULL,
        payment_method VARCHAR(50) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('jobs table ready');
  } catch(e) { console.log(e.message); }

  // Original migrations
  try { await db.query('ALTER TABLE users ADD COLUMN password VARCHAR(255) NULL AFTER email'); } catch(e) { console.log(e.message); }
  try { await db.query('ALTER TABLE users MODIFY COLUMN role ENUM(\'CLIENT\', \'PROFESSIONAL\', \'ADMIN\') NOT NULL'); } catch(e) { console.log(e.message); }

  // Candidate system: rating columns on users
  try { await db.query('ALTER TABLE users ADD COLUMN rating DECIMAL(3,2) DEFAULT 0'); } catch(e) { console.log(e.message); }
  try { await db.query('ALTER TABLE users ADD COLUMN rating_count INT DEFAULT 0'); } catch(e) { console.log(e.message); }

  // Professional profile columns
  try { await db.query("ALTER TABLE users ADD COLUMN specialty VARCHAR(255) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN experience_years INT DEFAULT 0"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN province VARCHAR(100) DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // Candidate system: job_applications table
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS job_applications (
        id VARCHAR(36) PRIMARY KEY,
        job_id VARCHAR(36) NOT NULL,
        professional_id VARCHAR(36) NOT NULL,
        message TEXT,
        status ENUM('PENDING','ACCEPTED','REJECTED') DEFAULT 'PENDING',
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_application (job_id, professional_id)
      )
    `);
    console.log('job_applications table created');
  } catch(e) { console.log(e.message); }

  // reviews table for post-completion ratings
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id VARCHAR(36) PRIMARY KEY,
        job_id VARCHAR(36) NOT NULL UNIQUE,
        reviewer_id VARCHAR(36) NOT NULL,
        professional_id VARCHAR(36) NOT NULL,
        rating INT NOT NULL,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('reviews table created');
  } catch(e) { console.log(e.message); }

  // portfolio_photos table
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS portfolio_photos (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        photo_url VARCHAR(500) NOT NULL,
        caption VARCHAR(255) DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('portfolio_photos table created');
  } catch(e) { console.log(e.message); }

  // Professional real-time location columns
  try { await db.query("ALTER TABLE users ADD COLUMN current_lat DECIMAL(10,8) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN current_lng DECIMAL(11,8) DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // Before/after photos in reviews
  try { await db.query("ALTER TABLE reviews ADD COLUMN before_photo_url VARCHAR(500) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE reviews ADD COLUMN after_photo_url VARCHAR(500) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN location_updated_at TIMESTAMP DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // Proposed price per application (professional proposes, client decides)
  try { await db.query("ALTER TABLE job_applications ADD COLUMN proposed_price DECIMAL(10,2) DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // Admin-verified competencies for professionals (JSON array stored as TEXT)
  try { await db.query("ALTER TABLE users ADD COLUMN verified_skills TEXT DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // Professional academic/training credentials
  try { await db.query("ALTER TABLE users ADD COLUMN institution VARCHAR(255) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN course_name VARCHAR(255) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN graduation_year INT DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN is_student TINYINT(1) DEFAULT 0"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN cert_pdf_url VARCHAR(500) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN bio TEXT DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // Job phase timestamps (cronograma de fases por trabalho)
  try { await db.query("ALTER TABLE jobs ADD COLUMN hired_at TIMESTAMP NULL DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE jobs ADD COLUMN started_at TIMESTAMP NULL DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE jobs ADD COLUMN completed_at TIMESTAMP NULL DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // Recommendations system
  try { await db.query("ALTER TABLE users ADD COLUMN recommendation_count INT DEFAULT 0"); } catch(e) { console.log(e.message); }
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS recommendations (
        id VARCHAR(36) PRIMARY KEY,
        job_id VARCHAR(36) NOT NULL UNIQUE,
        from_client_id VARCHAR(36) NOT NULL,
        to_professional_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('recommendations table created');
  } catch(e) { console.log(e.message); }

  // Professional approval workflow
  try { await db.query("ALTER TABLE users ADD COLUMN approval_status ENUM('PENDING_DOCS','PENDING_REVIEW','APPROVED','REJECTED') DEFAULT 'APPROVED'"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN rejection_reason TEXT DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // Professional identity & contact (required for approval)
  try { await db.query("ALTER TABLE users ADD COLUMN bi VARCHAR(20) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN telefone VARCHAR(20) DEFAULT NULL"); } catch(e) { console.log(e.message); }

  // BI document photos and extracted data
  try { await db.query("ALTER TABLE users ADD COLUMN bi_front_url VARCHAR(500) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN bi_back_url VARCHAR(500) DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN date_of_birth DATE DEFAULT NULL"); } catch(e) { console.log(e.message); }
  try { await db.query("ALTER TABLE users ADD COLUMN gender ENUM('M','F') DEFAULT NULL"); } catch(e) { console.log(e.message); }

  console.log('Done');
  process.exit(0);
}

migrate();

