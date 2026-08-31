const API_URL = '/api';

// 1. MUAT DATA TABEL STOK
async function loadItems() {
    try {
        const response = await fetch(`${API_URL}/items`);
        const result = await response.json();
        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = ''; 

        if (result.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">Belum ada data barang. Silakan upload Excel atau input manual.</td></tr>';
            return;
        }

        result.data.forEach(item => {
            const miuAsli = item.sku_barcode.replace('CHM-', '');
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="ps-4"><span class="badge-sku">${miuAsli}</span></td>
                <td class="fw-bold text-dark">${item.name}</td>
                <td class="text-center"><span class="stock-highlight">${item.stock_quantity}</span></td>
                <td>${item.masa_pakai || '-'}</td>
                <td>${item.periode || '-'}</td>
                <td><small class="text-muted">${item.keterangan || '-'}</small></td>
                <td class="text-center text-nowrap">
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="cetakQR('${item.sku_barcode}', '${item.name}')" title="Cetak QR Code">
                        <i class="bi bi-qr-code"></i> QR
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="hapusBarang('${item.sku_barcode}')" title="Hapus Data">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        document.getElementById('tableBody').innerHTML = 
            '<tr><td colspan="7" class="text-center text-danger">Gagal terhubung ke server backend!</td></tr>';
    }
}

// 2. MUAT DATA HISTORI
async function loadHistory() {
    try {
        const response = await fetch(`${API_URL}/transactions`);
        const result = await response.json();
        const tbody = document.getElementById('historyTableBody');
        tbody.innerHTML = ''; 

        if (result.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Belum ada histori transaksi barang.</td></tr>';
            return;
        }

        result.data.forEach(trx => {
            const miuAsli = trx.sku_barcode.replace('CHM-', '');
            const waktu = new Date(trx.created_at).toLocaleString('id-ID', {
                day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute:'2-digit'
            });
            
            const isMasuk = trx.transaction_type === 'MASUK';
            const badgeJenis = isMasuk ? `<span class="badge bg-success">MASUK</span>` : `<span class="badge bg-danger">KELUAR</span>`;
            const teksJumlah = isMasuk ? `<span class="text-success fw-bold">+${trx.quantity_taken}</span>` : `<span class="text-danger fw-bold">-${trx.quantity_taken}</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="ps-4"><small class="text-muted fw-bold">${waktu}</small></td>
                <td><span class="badge bg-secondary">${miuAsli}</span></td>
                <td class="fw-bold">${trx.item_name}</td>
                <td class="text-center">${badgeJenis}</td>
                <td class="text-center fs-6">${teksJumlah}</td>
                <td><small class="text-muted">${trx.reference_number || '-'}</small></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        document.getElementById('historyTableBody').innerHTML = '<tr><td colspan="6" class="text-center text-danger">Gagal terhubung ke server histori!</td></tr>';
    }
}

// 3. SUBMIT FORM EXCEL
document.getElementById('uploadForm').addEventListener('submit', async (event) => {
    event.preventDefault(); 
    const fileInput = document.getElementById('excelFile');
    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    const submitBtn = document.querySelector('#uploadForm button[type="submit"]');
    submitBtn.innerHTML = 'Memproses...';
    submitBtn.disabled = true;

    try {
        const response = await fetch(`${API_URL}/items/upload`, { method: 'POST', body: formData });
        const result = await response.json();
        
        if (response.ok) {
            alert(`✅ Sukses Upload Excel!`);
            fileInput.value = ''; 
        } else { alert(`❌ Gagal: ${result.error}`); }
    } catch (error) { alert('Terjadi kesalahan jaringan.'); } 
    finally {
        submitBtn.innerHTML = '<i class="bi bi-cloud-arrow-up me-2"></i>Upload & Proses';
        submitBtn.disabled = false;
    }
});

// 4. SUBMIT FORM MANUAL
document.getElementById('manualForm').addEventListener('submit', async (event) => {
    event.preventDefault(); 
    
    const payload = {
        miu: document.getElementById('miu').value,
        uraian: document.getElementById('uraian').value,
        jumlah: parseInt(document.getElementById('jumlah').value),
        masa_pakai: document.getElementById('masa_pakai').value,
        periode: document.getElementById('periode').value,
        ket: document.getElementById('ket').value
    };

    const btn = document.querySelector('#manualForm button[type="submit"]');
    btn.innerHTML = 'Menyimpan...';
    btn.disabled = true;

    try {
        const response = await fetch(`${API_URL}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (response.ok) { document.getElementById('manualForm').reset(); } 
        else {
            const result = await response.json();
            alert(`❌ Gagal: ${result.error}`);
        }
    } catch (error) { alert('Terjadi kesalahan jaringan.'); } 
    finally {
        btn.innerHTML = '<i class="bi bi-save me-2"></i>Simpan Barang';
        btn.disabled = false;
    }
});

// 5. FUNGSI HAPUS BARANG
async function hapusBarang(sku) {
    const miuAsli = sku.replace('CHM-', '');
    const konfirmasi = confirm(`⚠️ Yakin ingin menghapus barang dengan MIU: ${miuAsli}?`);
    
    if (konfirmasi) {
        try {
            const response = await fetch(`${API_URL}/items/${sku}`, { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok) alert(`❌ Gagal: ${result.error}`);
        } catch (error) { alert('Terjadi kesalahan jaringan atau server mati.'); }
    }
}

// 6. FUNGSI CETAK QR CODE
function cetakQR(sku, namaBarang) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${sku}`;
    const printWindow = window.open('', '_blank', 'width=400,height=500');
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Cetak QR - ${sku}</title>
            <style>
                body { font-family: 'Arial', sans-serif; text-align: center; padding: 20px; margin: 0; }
                .label-box { 
                    border: 2px solid #000; 
                    padding: 15px; 
                    display: inline-block; 
                    border-radius: 8px;
                    width: 250px;
                }
                .logo { width: 80px; margin-bottom: 10px; }
                h3 { margin: 0 0 10px 0; font-size: 16px; text-transform: uppercase; }
                img.qr-image { width: 150px; height: 150px; }
                p.sku-text { margin: 10px 0 0 0; font-size: 18px; font-weight: bold; letter-spacing: 1px; }
                @media print { .btn-print { display: none !important; } }
                .btn-print {
                    margin-top: 20px; padding: 10px 20px; background-color: #00A2E9; 
                    color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="label-box">
                <img src="logo-pln.png" class="logo" alt="PLN">
                <h3>${namaBarang}</h3>
                <img src="${qrUrl}" class="qr-image" alt="QR Code" onload="window.print()">
                <p class="sku-text">${sku}</p>
            </div>
            <br>
            <button class="btn-print" onclick="window.print()">🖨️ Cetak Sekarang</button>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Inisialisasi awal
loadItems();
loadHistory();

// Update Real-time
const socket = io();
socket.on('stok_berubah', () => { 
    loadItems(); 
    loadHistory(); 
});