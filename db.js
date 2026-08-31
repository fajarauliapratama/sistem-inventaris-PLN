const { Pool } = require('pg');
require('dotenv').config(); 

// Konfigurasi koneksi menggunakan satu tautan utuh dari Neon
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Wajib ditambahkan untuk server cloud internet
});

// Mengetes koneksi saat server pertama kali menyala
pool.connect((err, client, release) => {
    if (err) {
        console.error('Gagal menyambung ke database!', err.stack);
    } else {
        console.log('Berhasil menyambung ke database PostgreSQL di internet!');
    }
    if (client) release();
});

module.exports = pool;