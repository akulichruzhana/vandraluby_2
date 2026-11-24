const { Pool } = require('pg');

// Проверяем переменную окружения
if (!process.env.POSTGRES_URL_NON_POOLING) {
  throw new Error('POSTGRES_URL_NON_POOLING не задана');
}

// Исправляем sslmode для Neon
const originalUrl = process.env.POSTGRES_URL_NON_POOLING;
const url = new URL(originalUrl);
url.searchParams.set('sslmode', 'no-verify');
const connectionString = url.toString();

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

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

// Извлекаем числовую стоимость из строки вида "от 350 BYN"
function parsePrice(price) {
  if (!price) return null;
  const match = String(price).replace(/\s/g, '').match(/(\d+(?:[.,]\d+)?)/);
  return match ? parseFloat(match[1].replace(',', '.')) : null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Метод не поддерживается' });
  }

  try {
    await ensureSchema();

    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID бронирования обязателен' });
    }

    // Проверяем, существует ли бронирование
    const checkResult = await pool.query(
      `SELECT id, price, status, prepayment_at, expires_at
       FROM bookings WHERE id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Бронирование не найдено' });
    }

    const booking = checkResult.rows[0];

    if (booking.prepayment_at) {
      return res.status(400).json({ success: false, error: 'Предоплата по этой брони уже внесена' });
    }

    // Если 30 минут истекли — бронь считается просроченной и удаляется
    if (booking.expires_at && new Date(booking.expires_at) < new Date()) {
      await pool.query('DELETE FROM bookings WHERE id = $1', [id]);
      return res.status(410).json({
        success: false,
        error: 'Срок бронирования истёк (30 минут без предоплаты). Бронь удалена.'
      });
    }

    // Сумма предоплаты — 30% от стоимости тура
    const totalPrice = parsePrice(booking.price);
    const prepaymentAmount = totalPrice !== null ? Math.round(totalPrice * 0.3 * 100) / 100 : null;

    const updateResult = await pool.query(
      `UPDATE bookings
       SET prepayment_at = NOW(),
           prepayment_amount = $2,
           status = 'prepaid',
           expires_at = NULL
       WHERE id = $1
       RETURNING id, price, prepayment_amount, prepayment_at, status`,
      [id, prepaymentAmount]
    );

    return res.status(200).json({
      success: true,
      message: 'Предоплата успешно внесена! Бронь подтверждена.',
      booking: updateResult.rows[0]
    });
  } catch (err) {
    console.error('Ошибка внесения предоплаты:', err);
    return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
  }
};
