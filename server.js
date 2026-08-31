const express = require('express');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const format = require('pg-format');
require('dotenv').config();
const http = require('http'); 
const { Server } = require('socket.io');
const db = require('./db'); 

const app = express();
const port = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST", "DELETE"] } });

app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

const upload = multer({ storage: multer.memoryStorage() });

async function siapkanDatabase() {
    try {
        // 1. MEMBUAT TABEL UTAMA (ITEMS)
        await db.query(`
            CREATE TABLE IF NOT EXISTS items (
                id SERIAL PRIMARY KEY,
                sku_barcode VARCHAR(255) UNIQUE,
                name VARCHAR(255),
                stock_quantity INTEGER DEFAULT 0,
                unit VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // 2. MENAMBAHKAN KOLOM DETAIL
        await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS masa_pakai VARCHAR(255);`);
        await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS periode VARCHAR(255);`);
        await db.query(`ALTER TABLE items ADD COLUMN IF NOT EXISTS keterangan TEXT;`);
        
        // 3. MEMBUAT TABEL HISTORI TRANSAKSI
        await db.query(`DROP TABLE IF EXISTS transactions CASCADE;`);
        await db.query(`
            CREATE TABLE transactions (
                id SERIAL PRIMARY KEY,
                sku_barcode VARCHAR(255),
                item_name VARCHAR(255),
                quantity_taken INTEGER,
                reference_number VARCHAR(255),
                transaction_type VARCHAR(50) DEFAULT 'KELUAR',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        console.log("✅ Struktur Database di Internet sudah siap sepenuhnya!");
    } catch (err) { 
        console.error("Error Database:", err); 
    }
}
siapkanDatabase();

io.on('connection', (socket) => {});

// 1. MENGAMBIL DATA BARANG
app.get('/api/items', async (req, res) => {
    try {
        const query = `SELECT id, sku_barcode, name, stock_quantity, masa_pakai, periode, keterangan FROM items ORDER BY NULLIF(regexp_replace(sku_barcode, '[^0-9]', '', 'g'), '')::integer ASC NULLS LAST`;
        const result = await db.query(query);
        res.status(200).json({ data: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. MENGAMBIL HISTORI TRANSAKSI
app.get('/api/transactions', async (req, res) => {
    try {
        const query = `SELECT sku_barcode, item_name, quantity_taken, reference_number, transaction_type, created_at FROM transactions ORDER BY created_at DESC LIMIT 50`;
        const result = await db.query(query);
        res.status(200).json({ data: result.rows });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. MENAMBAH MANUAL (Barang Masuk)
app.post('/api/items', async (req, res) => {
    try {
        const { miu, uraian, jumlah, masa_pakai, periode, ket } = req.body;
        const sku_barcode = `CHM-${miu}`; 
        const qty = parseInt(jumlah) || 0;
        
        const query = `
            INSERT INTO items (sku_barcode, name, stock_quantity, masa_pakai, periode, keterangan, unit) 
            VALUES ($1, $2, $3, $4, $5, $6, 'Pcs') 
            ON CONFLICT (sku_barcode) DO UPDATE SET 
                name = EXCLUDED.name, stock_quantity = items.stock_quantity + EXCLUDED.stock_quantity,
                masa_pakai = EXCLUDED.masa_pakai, periode = EXCLUDED.periode, keterangan = EXCLUDED.keterangan, updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        await db.query(query, [sku_barcode, uraian, qty, masa_pakai || '', periode || '', ket || '']);
        
        if (qty > 0) {
            await db.query(`INSERT INTO transactions (sku_barcode, item_name, quantity_taken, reference_number, transaction_type) VALUES ($1, $2, $3, $4, 'MASUK')`, 
            [sku_barcode, uraian, qty, 'Input Manual']);
        }
        
        io.emit('stok_berubah'); 
        res.status(201).json({ pesan: 'Sukses!' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. MENGHAPUS BARANG
app.delete('/api/items/:sku', async (req, res) => {
    const client = await db.connect();
    try {
        const { sku } = req.params;
        await client.query('BEGIN');
        const result = await client.query('DELETE FROM items WHERE sku_barcode = $1 RETURNING *', [sku]);
        if (result.rowCount === 0) throw new Error('Data tidak ditemukan!');
        await client.query('COMMIT');
        io.emit('stok_berubah');
        res.status(200).json({ pesan: 'Terhapus!' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: error.message });
    } finally { client.release(); }
});

// 5. UPLOAD EXCEL (Barang Masuk Massal)
app.post('/api/items/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan!' });
    const client = await db.connect(); 
    try {
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = xlsx.utils.sheet_to_json(firstSheet, { header: 1 });
        let cols = { miu: -1, uraian: -1, jumlah: -1, masa: -1, periode: -1, ket: -1 };
        const aggregatedData = {};

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (cols.miu === -1) {
                for (let j = 0; j < row.length; j++) {
                    const val = String(row[j] || '').trim().toUpperCase();
                    if (val === 'MIU') cols.miu = j; if (val === 'URAIAN') cols.uraian = j;
                    if (val === 'JUMLAH') cols.jumlah = j; if (val === 'MASA PAKAI') cols.masa = j;
                    if (val === 'PERIODE') cols.periode = j; if (val === 'KET') cols.ket = j;
                } continue; 
            }
            if (cols.miu !== -1 && row[cols.miu] !== undefined && row[cols.uraian] !== undefined) {
                if (String(row[cols.miu]).trim().toUpperCase() === 'MIU' || String(row[cols.miu]).trim().toUpperCase() === 'HPI') continue; 
                const sku = `CHM-${String(row[cols.miu]).trim()}`;
                const stok = parseInt(row[cols.jumlah]) || 0;
                const masaVal = cols.masa !== -1 && row[cols.masa] !== undefined ? String(row[cols.masa]).trim() : '';
                const periodeVal = cols.periode !== -1 && row[cols.periode] !== undefined ? String(row[cols.periode]).trim() : '';
                const ketVal = cols.ket !== -1 && row[cols.ket] !== undefined ? String(row[cols.ket]).trim() : '';
                
                if (aggregatedData[sku]) {
                    aggregatedData[sku].stok += stok;
                    if (masaVal !== '') aggregatedData[sku].masa = masaVal;
                    if (periodeVal !== '') aggregatedData[sku].periode = periodeVal;
                    if (ketVal !== '') aggregatedData[sku].ket = ketVal;
                } else {
                    aggregatedData[sku] = { name: String(row[cols.uraian]).trim(), stok: stok, masa: masaVal, periode: periodeVal, ket: ketVal };
                }
            }
        }
        
        const valuesToInsert = Object.keys(aggregatedData).map(sku => [sku, aggregatedData[sku].name, aggregatedData[sku].stok, aggregatedData[sku].masa, aggregatedData[sku].periode, aggregatedData[sku].ket, 'Pcs']);
        if (valuesToInsert.length === 0) return res.status(400).json({ error: 'Data tidak terbaca.' });
        
        await client.query('BEGIN');
        const sqlQuery = format(`INSERT INTO items (sku_barcode, name, stock_quantity, masa_pakai, periode, keterangan, unit) VALUES %L ON CONFLICT (sku_barcode) DO UPDATE SET name = EXCLUDED.name, stock_quantity = items.stock_quantity + EXCLUDED.stock_quantity, masa_pakai = EXCLUDED.masa_pakai, periode = EXCLUDED.periode, keterangan = EXCLUDED.keterangan, updated_at = CURRENT_TIMESTAMP`, valuesToInsert);
        await client.query(sqlQuery);
        
        const historyValues = Object.keys(aggregatedData).filter(sku => aggregatedData[sku].stok > 0).map(sku => [sku, aggregatedData[sku].name, aggregatedData[sku].stok, 'Upload Excel', 'MASUK']);
        if (historyValues.length > 0) {
            const historyQuery = format(`INSERT INTO transactions (sku_barcode, item_name, quantity_taken, reference_number, transaction_type) VALUES %L`, historyValues);
            await client.query(historyQuery);
        }

        await client.query('COMMIT');
        io.emit('stok_berubah');
        res.status(200).json({ pesan: 'Upload sukses!' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: `Gagal Server: ${error.message}` });
    } finally { client.release(); }
});

// 6. TRANSAKSI OUTBOUND (Barang Keluar via Scanner)
app.post('/api/transactions/outbound', async (req, res) => {
    const client = await db.connect();
    try {
        const { sku_barcode, quantity_taken, reference_number } = req.body;
        await client.query('BEGIN');
        
        const itemResult = await client.query('SELECT id, name, stock_quantity FROM items WHERE sku_barcode = $1', [sku_barcode]);
        if (itemResult.rowCount === 0) throw new Error('Barang tidak ditemukan!');
        
        const item = itemResult.rows[0];
        if (item.stock_quantity < quantity_taken) throw new Error('Stok tidak cukup!');
        
        await client.query('UPDATE items SET stock_quantity = stock_quantity - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [quantity_taken, item.id]);
        
        await client.query(`INSERT INTO transactions (sku_barcode, item_name, quantity_taken, reference_number, transaction_type) VALUES ($1, $2, $3, $4, 'KELUAR')`, 
        [sku_barcode, item.name, quantity_taken, reference_number || '-']);

        await client.query('COMMIT');
        io.emit('stok_berubah');
        res.status(200).json({ pesan: 'Sukses' });
    } catch (error) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: error.message });
    } finally { client.release(); }
});

server.listen(port, () => { console.log(`Server nyala di port ${port}`); });