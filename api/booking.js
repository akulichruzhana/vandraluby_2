const { Pool } = require('pg');

// Берём оригинальную строку подключения из переменной Vercel
const originalUrl = process.env.POSTGRES_URL_NON_POOLING;

// Разбираем строку подключения и меняем sslmode на 'no-verify'
const url = new URL(originalUrl);
url.searchParams.set('sslmode', 'no-verify');
const connectionString = url.toString();

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false }
});

// Бронь без предоплаты живёт 30 минут с момента создания
const HOLD_MINUTES = 30;

// Добавляем недостающие колонки (идемпотентно, один раз на холодный старт)
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price TEXT`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS prepayment_amount NUMERIC`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS prepayment_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
  schemaReady = true;
}

module.exports = async (req, res) => {
  // Настройка CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Обработка preflight запроса
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ 
          success: false, 
          error: 'Email обязателен' 
        });
      }

      await ensureSchema();

      // Автоматически удаляем бронирования, по которым прошло 30 минут без предоплаты
      await pool.query(
        `DELETE FROM bookings
         WHERE prepayment_at IS NULL
           AND expires_at IS NOT NULL
           AND expires_at < NOW()`
      );

      // Получаем бронирования по email
      const result = await pool.query(
        `SELECT id, name, phone, email, tour_date, comment, status, created_at,
                price, prepayment_amount, prepayment_at, expires_at
         FROM bookings 
         WHERE email = $1 
         ORDER BY id DESC`,
        [email.toLowerCase().trim()]
      );

      return res.status(200).json({
        success: true,
        bookings: result.rows
      });

    } catch (err) {
      console.error('Ошибка получения бронирований:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Ошибка сервера при получении бронирований' 
      });
    }
  }

  if (req.method === 'POST') {
    const { name, phone, email, tourDate, comment, price } = req.body;

    if (!name || !phone || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Пожалуйста, заполните имя, телефон и email' 
      });
    }

    try {
      await ensureSchema();

      const result = await pool.query(
        `INSERT INTO bookings (name, phone, email, tour_date, comment, price, created_at, status, expires_at) 
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'new', NOW() + ($7 || ' minutes')::interval) 
         RETURNING id, expires_at`,
        [name, phone, email, tourDate || null, comment || null, price || null, String(HOLD_MINUTES)]
      );
      
      return res.status(200).json({ 
        success: true,
        bookingId: result.rows[0].id,
        expiresAt: result.rows[0].expires_at,
        message: 'Заявка успешно отправлена! Внесите предоплату в течение 30 минут, иначе бронь будет отменена.' 
      });
    } catch (err) {
      console.error('Database error:', err);
      return res.status(500).json({ 
        success: false, 
        error: 'Ошибка: ' + err.message 
      });
    }
  }

  // Если метод не поддерживается
  return res.status(405).json({ error: 'Method not allowed' });
};
