// main.js - Ouman Digital System (Enhanced Admin Reply)

require("./setting");
const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const chalk = require('chalk');
const moment = require("moment-timezone");
const axios = require('axios');
const QRCode = require('qrcode');
const figlet = require("figlet");

/**
 * SISTEM LOGGING TERMINAL
 */
const log = {
    info: (m) => console.log(chalk.blue(`[INFO] [${moment().format('HH:mm:ss')}] ${m}`)),
    success: (m) => console.log(chalk.green(`[SUCCESS] [${moment().format('HH:mm:ss')}] ${m}`)),
    error: (m, e) => {
        console.log(chalk.red(`[ERROR] [${moment().format('HH:mm:ss')}] ${m}`));
        if (e && e.response) console.log(chalk.red(`➤ Response API: ${JSON.stringify(e.response.data)}`));
        else if (e) console.log(chalk.red(`➤ Detail: ${e.message || e}`));
    }
};

// === DATABASE CONFIG ===
const db_path = {
    user: "./database/user.json",
    trx: "./database/transactions.json",
    store: "./database/store.json",
    promo: "./database/promo.json",
    flashsale: "./database/flashsale.json",
    settings: "./database/settings.json"
};

const readDB = (p) => {
    if (!fs.existsSync("./database")) fs.mkdirSync("./database");
    if (!fs.existsSync(p)) {
        let init;
        if (p.includes('store')) init = { categories: [], products: [] };
        else if (p.includes('settings')) init = { success_sticker: "", cancel_sticker: "" };
        else init = [];
        fs.writeFileSync(p, JSON.stringify(init));
    }
    try {
        return JSON.parse(fs.readFileSync(p));
    } catch (e) {
        if (p.includes('store')) return { categories: [], products: [] };
        if (p.includes('settings')) return { success_sticker: "", cancel_sticker: "", ratings: [] };
        return [];
    }
};
const writeDB = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2));

// === CONFIG SYNC ===
moment.tz.setDefault("Asia/Jakarta").locale("id");
const tanggal = () => moment.tz('Asia/Jakarta').format('DD MMMM YYYY');

const PAKASIR_KEY = global.PAKASIR_API_KEY;
const PAKASIR_SLUG = global.PAKASIR_PROJECT_SLUG;
const OWNER_ID = String(global.OWNER_ID);
const THUMBNAIL = global.thumbnail || "./options/image/thumbnail.jpg";

const bot = new Telegraf(global.BOT_TOKEN);
const userState = new Map();
const activeChats = new Map();

/**
 * FUNGSI KIRIM STIKER SUKSES
 */
async function sendSuccessSticker(userId) {
    const settings = readDB(db_path.settings);
    if (settings.success_sticker) {
        try {
            await bot.telegram.sendSticker(userId, settings.success_sticker);
        } catch (e) {
            log.error("Gagal mengirim stiker sukses", e);
        }
    }
}

/**
 * FUNGSI KIRIM STIKER BATAL
 */
async function sendCancelSticker(userId) {
    const settings = readDB(db_path.settings);
    if (settings.cancel_sticker) {
        try {
            await bot.telegram.sendSticker(userId, settings.cancel_sticker);
        } catch (e) {
            log.error("Gagal mengirim stiker batal", e);
        }
    }
}

/**
 * PAKASIR API CORE
 */
async function checkStatusPakasir(orderId, amount) {
    try {
        const url = `https://app.pakasir.com/api/transactiondetail?project=${PAKASIR_SLUG}&amount=${amount}&order_id=${orderId}&api_key=${PAKASIR_KEY}`;
        const res = await axios.get(url);

        if (res.data && res.data.transaction) {
            const status = res.data.transaction.status.toLowerCase();
            if (status === "completed" || status === "paid" || status === "sukses") {
                return "PAID";
            }
        }
        return "UNPAID";
    } catch (e) {
        return "ERROR";
    }
}

/**
 * FUNGSI PROSES PEMBAYARAN / PENGIRIMAN (VERSI FIXED)
 */
async function processDelivery(tx, users, store) {
    let handled = false;
    try {
        if (tx.type === "topup") {
            const uIdx = users.findIndex(u => String(u.id) === String(tx.userId));
            if (uIdx !== -1) {
                users[uIdx].balance += parseInt(tx.amount);
                tx.status = "success";
                tx.completed_at = moment().format();
                await bot.telegram.sendMessage(tx.userId, `✅ *TOPUP BERHASIL*\n━━━━━━━━━━━━━━━━━━\n💰 Saldo: *+Rp ${tx.amount.toLocaleString()}*\n💳 Total Saldo Sekarang: *Rp ${users[uIdx].balance.toLocaleString()}*\n\nTerima kasih telah melakukan pengisian saldo.`, { parse_mode: "Markdown" });

                await sendSuccessSticker(tx.userId);
                handled = true;
            }
        } else if (tx.type === "direct") {
            const pIdx = store.products.findIndex(p => p.id === tx.productId);
            if (pIdx !== -1) {
                const product = store.products[pIdx];
                if (product.stocks.length >= tx.qty) {
                    const items = product.stocks.splice(0, tx.qty);
                    tx.status = "success";
                    tx.completed_at = moment().format();

                    const detail = items.map((it, i) => {
                        if (it.isLink || !it.pw) {
                            return `Data ${i + 1}:\n🔗 ${it.email}`;
                        } else {
                            let str = `Akun ${i + 1}:\nEmail: ${it.email}\nPW: ${it.pw}`;
                            if (it.pin) str += `\nPIN: ${it.pin}`;
                            if (it.a2f) str += `\nA2F: ${it.a2f}`;
                            if (it.profile) str += `\nProfile: ${it.profile}`;
                            return str;
                        }
                    }).join("\n\n");

                    // --- LOGIKA PESAN SUKSES DINAMIS & RATING ---
                    let extraText = product.success_msg ? `\n\n ${product.success_msg}` : "";

                    const msg1_summary = `✅ *PEMBAYARAN BERHASIL*
━━━━━━━━━━━━━━━━━━
🛍️ *Produk:* ${tx.productName}
📦 *Jumlah:* ${tx.qty}x
💰 *Total:* Rp ${tx.amount.toLocaleString()}
━━━━━━━━━━━━━━━━━━
📝 _Pesanan Anda sedang diproses oleh sistem._`;

                    const msg2_data = `🔑 *DATA PESANAN ANDA:*
\`\`\`
${detail}
\`\`\`${extraText}`;

                    const msg3_rating = `🌟 *RATING & TESTIMONI*
Bagaimana pengalaman Anda membeli produk ini? Berikan penilaian Anda:`;

                    const kbRating = Markup.inlineKeyboard([
                        [
                            Markup.button.callback("⭐", "rate_1"),
                            Markup.button.callback("⭐⭐", "rate_2"),
                            Markup.button.callback("⭐⭐⭐", "rate_3")
                        ],
                        [
                            Markup.button.callback("⭐⭐⭐⭐", "rate_4"),
                            Markup.button.callback("⭐⭐⭐⭐⭐", "rate_5")
                        ]
                    ]);

                    // KIRIM PESAN 1: Summary
                    await bot.telegram.sendMessage(tx.userId, msg1_summary, { parse_mode: "Markdown" });

                    // KIRIM PESAN 2: Data + Tutorial (Custom Video jika ada)
                    if (product.mediaId) {
                        try {
                            // Coba kirim sebagai video, jika gagal coba photo/dokumen
                            await bot.telegram.sendVideo(tx.userId, product.mediaId, { caption: msg2_data, parse_mode: "Markdown" });
                        } catch (e) {
                            try {
                                await bot.telegram.sendPhoto(tx.userId, product.mediaId, { caption: msg2_data, parse_mode: "Markdown" });
                            } catch (err) {
                                await bot.telegram.sendMessage(tx.userId, msg2_data, { parse_mode: "Markdown" });
                            }
                        }
                    } else {
                        await bot.telegram.sendMessage(tx.userId, msg2_data, { parse_mode: "Markdown" });
                    }

                    // KIRIM PESAN 3: Rating
                    await bot.telegram.sendMessage(tx.userId, msg3_rating, { parse_mode: "Markdown", ...kbRating });
                    handled = true;
                } else {
                    await bot.telegram.sendMessage(tx.userId, `⚠️ *PEMBAYARAN SUKSES* tapi stok *${tx.productName}* baru saja habis. Mohon hubungi Admin untuk klaim manual.`);
                    tx.status = "error_stok";
                    handled = true;
                }
            }
        }
    } catch (e) { console.log("Delivery Error", e); }
    return handled;
}

/**
 * LOGIKA PENGAJUAN TOPUP
 */
async function createTopupRequest(ctx, amount) {
    if (isNaN(amount) || amount < 1000) {
        return ctx.reply("❌ Minimal topup adalah Rp 1.000");
    }

    const orderId = `TOP${Date.now()}`;
    const waitMsg = await ctx.reply("⌛ Menyiapkan QRIS Pakasir...");

    try {
        const payload = { project: PAKASIR_SLUG, order_id: orderId, amount, api_key: PAKASIR_KEY };
        const res = await axios.post('https://app.pakasir.com/api/transactioncreate/qris', payload, { headers: { 'Content-Type': 'application/json' } });

        if (res.data && res.data.payment) {
            const qr = await QRCode.toBuffer(res.data.payment.payment_number);
            let txs = readDB(db_path.trx);
            txs.push({ orderId, userId: ctx.from.id, amount, status: "pending", type: "topup", date: moment().format() });
            writeDB(db_path.trx, txs);

            try { await bot.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch (e) { }

            await ctx.replyWithPhoto({ source: qr }, {
                caption: `💳 *PEMBAYARAN TOPUP*\n━━━━━━━━━━━━━━━━━━\nID: \`${orderId}\`\nTotal: *Rp ${res.data.payment.total_payment.toLocaleString()}*\n\n_Sistem akan mengecek otomatis, atau klik tombol di bawah untuk cek manual._`,
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback("✅ Cek Status Manual", `check_trx_${orderId}`)], [Markup.button.callback("❌ Batal Pembayaran", `cancel_trx_${orderId}`)]])
            });
        } else {
            throw new Error("Invalid response from Pakasir");
        }
    } catch (e) {
        log.error("API Topup Error", e);
        ctx.reply("❌ Gagal membuat QRIS. Pastikan API Key Pakasir benar.");
    }
}

/**
 * LOOP PENGECEKAN TRANSAKSI
 */
async function paymentLoop() {
    let trxs = readDB(db_path.trx);
    let users = readDB(db_path.user);
    let store = readDB(db_path.store);
    let changed = false;

    for (let tx of trxs) {
        if (tx.status === "pending") {
            const status = await checkStatusPakasir(tx.orderId, tx.amount);
            if (status === "PAID") {
                if (await processDelivery(tx, users, store)) changed = true;
            }
        }
    }

    if (changed) {
        writeDB(db_path.trx, trxs);
        writeDB(db_path.user, users);
        writeDB(db_path.store, store);
    }
}

// === KEYBOARDS ===
const kbMain = (id) => Markup.removeKeyboard();

const kbAdmin = {
    reply_markup: {
        keyboard: [
            [{ text: '➕ Kategori' }, { text: '➕ Produk' }],
            [{ text: '➕ Isi Stok' }, { text: '🔑 Ambil Stok' }],
            [{ text: '📂 List Data' }, { text: '📢 Broadcast' }],
            [{ text: '🗑️ Hapus Data' }, { text: '💰 Kelola Saldo' }],
            [{ text: '🎟️ Voucher & Promo' }, { text: '⚡ Set Flash Sale' }],
            [{ text: '⚙️ Set Sticker' }, { text: '🔙 Menu Utama' }]
        ],
        resize_keyboard: true
    }
};

const kbDeleteMenu = {
    reply_markup: {
        keyboard: [
            [{ text: '➖ Hapus Kategori' }, { text: '➖ Hapus Produk' }],
            [{ text: '➖ Kosongkan Stok' }],
            [{ text: '🔙 Menu Admin' }]
        ],
        resize_keyboard: true
    }
};

const kbChat = {
    reply_markup: {
        keyboard: [[{ text: '🛑 AKHIRI CHAT' }]],
        resize_keyboard: true
    }
};

// === COMMANDS ===
const getStartMessage = (ctx, user, uLen, trxs) => {
    const hour = moment.tz('Asia/Jakarta').hour();
    let greeting = "Selamat Malam";
    if (hour >= 4 && hour < 10) greeting = "Selamat Pagi";
    else if (hour >= 10 && hour < 15) greeting = "Selamat Siang";
    else if (hour >= 15 && hour < 18) greeting = "Selamat Sore";

    const timeStr = moment.tz('Asia/Jakarta').format('dddd, D MMMM YYYY [pukul] HH.mm.ss [WIB]');
    const successTrxs = trxs.filter(x => x.status === "success");
    const userTrxCount = trxs.filter(x => String(x.userId) === String(ctx.from.id) && x.status === "success").length;
    const botName = (global.BOT_NAME || "STORE").toUpperCase();

    const settings = readDB(db_path.settings);
    const ratings = settings.ratings || [];
    let avgRating = 5.0;
    if (ratings.length > 0) {
        const sum = ratings.reduce((a, b) => a + b.score, 0);
        avgRating = (sum / ratings.length).toFixed(1);
    }
    const reviewCount = ratings.length > 0 ? ratings.length : 0;

    const text = `${greeting}, *${ctx.from.first_name || "User"}*! ✨\n📆 _${timeStr}_\n\nSelamat Datang di *${botName}*.\n━━━━━━━━━━━━━━━━━━\n👤 *STATISTIK AKUN*\n┣ 💰 Saldo Aktif : *Rp ${user.balance.toLocaleString('id-ID')}*\n┗ 🛍️ Total Order : *${userTrxCount} Transaksi*\n\n📊 *STATISTIK BOT*\n┣ ⭐ Rating : *${avgRating} / 5.0* (${reviewCount} ulasan)\n┣ 👥 Total Pengguna : *${uLen.toLocaleString('id-ID')}*\n┗ 🧾 Total Penjualan : *${successTrxs.length.toLocaleString('id-ID')}x*\n━━━━━━━━━━━━━━━━━━\nSilakan gunakan menu di bawah untuk mulai bertransaksi atau ketik /produk.`;

    const kb = Markup.inlineKeyboard([
        [Markup.button.callback('⚡ FLASH SALE', 'menu_flash_sale')],
        [Markup.button.callback('🛒 DAFTAR PRODUK', 'menu_belanja'), Markup.button.callback('💎 TOPUP SALDO', 'menu_topup')],
        [Markup.button.callback('🔥 PRODUK POPULER', 'menu_populer'), Markup.button.callback('👤 PROFIL SAYA', 'menu_profil')]
    ]);
    if (String(ctx.from.id) === OWNER_ID) kb.reply_markup.inline_keyboard.push([Markup.button.callback('🛠 MENU ADMIN', 'menu_admin')]);

    return { text, kb };
};

bot.command('start', async (ctx) => {
    let u = readDB(db_path.user);
    let user = u.find(x => String(x.id) === String(ctx.from.id));
    if (!user) {
        user = { id: ctx.from.id, name: ctx.from.first_name, balance: 0, joined: tanggal() };
        u.push(user);
        writeDB(db_path.user, u);
    }
    userState.delete(ctx.from.id);
    activeChats.delete(ctx.from.id);

    const { text, kb } = getStartMessage(ctx, user, u.length, readDB(db_path.trx));
    try { await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: text, parse_mode: "Markdown", ...kb }); }
    catch (e) { await ctx.reply(text, { parse_mode: "Markdown", ...kb }); }
});

bot.command('topup', async (ctx) => {
    const amountStr = ctx.message.text.split(" ")[1];
    if (!amountStr) return ctx.reply("❌ Format salah. Contoh: `/topup 10000`", { parse_mode: "Markdown" });
    const amount = parseInt(amountStr);
    await createTopupRequest(ctx, amount);
});

/**
 * COMMAND BALAS UNTUK ADMIN
 * Format: /balas [ID_USER] [PESAN]
 */
bot.command('balas', async (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    const args = ctx.message.text.split(" ");
    if (args.length < 3) return ctx.reply("❌ Format salah!\nContoh: `/balas 1234567 Halo ada yang bisa dibantu?`", { parse_mode: "Markdown" });

    const targetId = args[1];
    const message = args.slice(2).join(" ");

    try {
        await bot.telegram.sendMessage(targetId, `💬 *PESAN DARI ADMIN:*\n\n${message}`, { parse_mode: "Markdown" });
        ctx.reply(`✅ Pesan berhasil terkirim ke user \`${targetId}\`.`, { parse_mode: "Markdown" });
    } catch (e) {
        ctx.reply(`❌ Gagal mengirim pesan ke \`${targetId}\`. User mungkin memblokir bot.`);
    }
});

// === MENU HEARS ===

bot.command(['produk', 'daftarproduk', 'katalog'], async (ctx) => {
    userState.delete(ctx.from.id);
    const s = readDB(db_path.store);
    const cats = [...new Set(s.categories)].sort();
    const { text, kb } = getCatalogPage(1, cats, s.products);
    try { await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: text, parse_mode: "Markdown", ...kb }); }
    catch (e) { await ctx.reply(text, { parse_mode: "Markdown", ...kb }); }
});

bot.hears('🛒 Belanja', async (ctx) => {
    userState.delete(ctx.from.id);
    const s = readDB(db_path.store);
    const cats = [...new Set(s.categories)].sort();
    const { text, kb } = getCatalogPage(1, cats, s.products);
    try { await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: text, parse_mode: "Markdown", ...kb }); }
    catch (e) { await ctx.reply(text, { parse_mode: "Markdown", ...kb }); }
});

bot.action('menu_flash_sale', async (ctx) => {
    userState.delete(ctx.from.id);
    const fsList = readDB(db_path.flashsale);
    const backBtn = [Markup.button.callback("🏠 Kembali ke Home", "back_to_home")];
    const refreshBtn = Markup.button.callback("🔄 Refresh Waktu", "menu_flash_sale");

    if (!fsList || fsList.length === 0) {
        let emptyText = `✨ — ⚡ *FLASH SALE ZONE* ⚡ — ✨\n\n🚀 Buruan! Stok terbatas dan waktu berjalan.\n🕛 _Update Otomatis (WIB)_\n━━━━━━━━━━━━━━━━━━\n\n😔 Belum ada promo aktif...\n\n━━━━━━━━━━━━━━━━━━\n💡 _Gunakan tombol Refresh untuk update waktu. ${moment.tz('Asia/Jakarta').format('HH:mm')}_\n`;
        return ctx.editMessageCaption(emptyText, { parse_mode: "Markdown", ...Markup.inlineKeyboard([[refreshBtn, ...backBtn]]) }).catch(() => ctx.editMessageText(emptyText, { parse_mode: "Markdown", ...Markup.inlineKeyboard([[refreshBtn, ...backBtn]]) }).catch(()=>{}));
    }

    const store = readDB(db_path.store);
    let activeFs = [];
    let now = Date.now();

    fsList.forEach(fs => {
        if (now <= fs.expiresAt && fs.usedCount < fs.maxUses) {
            const p = store.products.find(x => x.id === fs.productId);
            if (p && p.stocks.length > 0) activeFs.push({ fs, p });
        }
    });

    if (activeFs.length === 0) {
        let emptyText = `✨ — ⚡ *FLASH SALE ZONE* ⚡ — ✨\n\n🚀 Buruan! Stok terbatas dan waktu berjalan.\n🕛 _Update Otomatis (WIB)_\n━━━━━━━━━━━━━━━━━━\n\n😔 Promo Flash Sale sedang habis atau stok kosong. Coba lagi nanti! ⚡\n\n━━━━━━━━━━━━━━━━━━\n💡 _Gunakan tombol Refresh untuk update waktu. ${moment.tz('Asia/Jakarta').format('HH:mm')}_\n`;
        return ctx.editMessageCaption(emptyText, { parse_mode: "Markdown", ...Markup.inlineKeyboard([[refreshBtn, ...backBtn]]) }).catch(() => ctx.editMessageText(emptyText, { parse_mode: "Markdown", ...Markup.inlineKeyboard([[refreshBtn, ...backBtn]]) }).catch(()=>{}));
    }

    let text = `✨ — ⚡ *FLASH SALE ZONE* ⚡ — ✨\n\n🚀 Buruan! Stok terbatas dan waktu berjalan.\n🕛 _Update Otomatis (WIB)_\n━━━━━━━━━━━━━━━━━━\n\n`;
    let buttons = [];

    activeFs.forEach((item, idx) => {
        const { fs, p } = item;
        const sisaWaktu = Math.floor((fs.expiresAt - now) / 3600000);
        let sisaMenit = Math.floor(((fs.expiresAt - now) % 3600000) / 60000);
        const sisaKuota = fs.maxUses - fs.usedCount;
        
        let finalPrice = p.price;
        if (fs.discount.includes("%")) {
            finalPrice = p.price - ((p.price * parseInt(fs.discount)) / 100);
        } else {
            finalPrice = p.price - parseInt(fs.discount);
        }
        let displayPrice = `~Rp ${p.price.toLocaleString('id-ID')}~ -> *Rp ${finalPrice.toLocaleString('id-ID')}*`;

        text += `🛒 *${p.name}*\n┣ 💰 ${displayPrice}\n┣ ⚡ Sisa Kuota: ${sisaKuota} Orang\n┣ ⏳ Sisa Waktu: ${sisaWaktu} Jam ${sisaMenit} Menit\n┗ 📦 Stok Gudang: ${p.stocks.length}\n\n`;
        buttons.push([Markup.button.callback(`⚡ Beli ${p.name.substring(0, 15)} (Rp${finalPrice.toLocaleString('id-ID')})`, `v_${p.id}_1`)]);
    });
    
    text += `━━━━━━━━━━━━━━━━━━\n💡 _Gunakan tombol Refresh untuk update waktu. ${moment.tz('Asia/Jakarta').format('HH:mm')}_`;
    
    buttons.push([refreshBtn, ...backBtn]);

    try {
        await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
    } catch (e) {
        await ctx.editMessageText(text, { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) }).catch(()=>{});
    }
});

bot.hears('👤 Profil', (ctx) => {
    userState.delete(ctx.from.id);
    const u = readDB(db_path.user).find(x => String(x.id) === String(ctx.from.id));
    if (!u) return ctx.reply("Gunakan /start terlebih dahulu.");

    // Menggunakan HTML agar karakter khusus pada nama tidak merusak bot
    const text = `👤 <b>PROFIL PENGGUNA</b>\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `🆔 ID: <code>${u.id}</code>\n` +
        `👤 Nama: ${u.name}\n` +
        `💳 Saldo: <b>Rp ${u.balance.toLocaleString()}</b>\n` +
        `📅 Join: ${u.joined}\n` +
        `━━━━━━━━━━━━━━━━━━`;

    ctx.reply(text, { parse_mode: "HTML" });
});
bot.hears('📊 Stok Produk', (ctx) => {
    userState.delete(ctx.from.id);
    const s = readDB(db_path.store);
    if (s.categories.length === 0) return ctx.reply("Gudang kosong.");
    let t = "📊 *STOK PRODUK TERSEDIA*\n━━━━━━━━━━━━━━━━━━\n\n";
    s.categories.sort().forEach(c => {
        const prodInCategory = s.products.filter(p => p.category === c);
        if (prodInCategory.length > 0) {
            t += `📁 *${c.toUpperCase()}*\n`;
            prodInCategory.forEach(p => t += `  - ${p.name}: *${p.stocks.length}*\n`);
            t += "\n";
        }
    });
    ctx.reply(t, { parse_mode: "Markdown" });
});

bot.hears('📈 Statistik', (ctx) => {
    userState.delete(ctx.from.id);
    const trxs = readDB(db_path.trx);
    const successTrxs = trxs.filter(x => x.status === "success");
    const users = readDB(db_path.user);

    let totalRevenue = 0;
    successTrxs.forEach(t => totalRevenue += (t.amount || 0));

    let res = "📈 *STATISTIK TOKO*\n━━━━━━━━━━━━━━━━━━\n\n";
    res += `👥 Total User: *${users.length}*\n`;
    res += `🧾 Total Transaksi: *${trxs.length}*\n`;
    res += `✅ Transaksi Sukses: *${successTrxs.length}*\n`;
    res += `💰 Total Omset: *Rp ${totalRevenue.toLocaleString()}*\n`;
    res += `━━━━━━━━━━━━━━━━━━`;

    ctx.reply(res, { parse_mode: "Markdown" });
});
bot.hears('🎟️ Voucher & Promo', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    userState.delete(ctx.from.id);
    ctx.reply("🎟 *Pusat Voucher & Promosi*\nSilahkan pilih menu manajemen voucher di bawah ini:", { 
        parse_mode: "Markdown", 
        ...Markup.inlineKeyboard([
            [Markup.button.callback("➕ Buat Voucher Baru", "adm_vouch_add")],
            [Markup.button.callback("📋 Kelola Voucher Aktif", "adm_vouch_list")]
        ]) 
    });
});

bot.hears('⚡ Set Flash Sale', async (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    userState.delete(ctx.from.id);
    const store = readDB(db_path.store);
    const cats = [...new Set(store.categories)].sort();
    if (cats.length === 0) return ctx.reply("Belum ada kategori.", kbAdmin);

    let buttons = [];
    cats.forEach(c => {
        buttons.push([Markup.button.callback(`📁 ${c.toUpperCase()}`, `fs_get_c_${Buffer.from(c).toString('base64')}`)]);
    });
    buttons.push([Markup.button.callback("📋 Kelola Flash Sale Aktif", "adm_fs_list")]);

    await ctx.reply("⚡ *Pusat Flash Sale*\nPilih kategori produk yang ingin didiskon kilat:", {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(buttons)
    });
});

bot.hears('📜 Riwayat', async (ctx) => {
    try {
        userState.delete(ctx.from.id);
        const allTrx = readDB(db_path.trx);
        if (!Array.isArray(allTrx)) return ctx.reply("❌ Database riwayat bermasalah.");
        const tx = allTrx.filter(x => String(x.userId) === String(ctx.from.id)).slice(-10).reverse();
        if (tx.length === 0) return ctx.reply("📜 *RIWAYAT TRANSAKSI*\n━━━━━━━━━━━━━━━━━━\n\nBelum ada riwayat transaksi.", { parse_mode: "Markdown" });
        let res = "📜 *10 RIWAYAT TERAKHIR*\n━━━━━━━━━━━━━━━━━━\n\n";
        tx.forEach(t => {
            const orderId = t.orderId || "N/A";
            const status = (t.status || "UNKNOWN").toUpperCase();
            const amount = (typeof t.amount === 'number') ? t.amount.toLocaleString() : "0";
            const type = (t.type || "N/A").toUpperCase();
            res += `▫️ \`${orderId}\` | ${status}\n   💰 Rp ${amount} | 💳 ${type}\n\n`;
        });
        await ctx.reply(res, { parse_mode: "Markdown" });
    } catch (e) { log.error("Gagal memuat Riwayat", e); ctx.reply("❌ Terjadi kesalahan saat mengambil data riwayat."); }
});

bot.hears('💳 Isi Saldo', (ctx) => {
    userState.delete(ctx.from.id);
    ctx.reply("Silahkan pilih nominal di bawah atau ketik perintah:\n`/topup [nominal]`\nContoh: `/topup 50000`", {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
            [Markup.button.callback("Rp 5.000", "tu_5000"), Markup.button.callback("Rp 10.000", "tu_10000")],
            [Markup.button.callback("Rp 20.000", "tu_20000"), Markup.button.callback("Rp 50.000", "tu_50000")]
        ])
    });
});

bot.hears('📞 Hubungi Admin', (ctx) => {
    userState.set(ctx.from.id, { step: 'ask_support' });
    ctx.reply("☎️ *LAYANAN BANTUAN LIVE*\n\nSilahkan ketik pesan/kendala Anda di bawah ini.\nAdmin akan segera merespon secara langsung.", {
        parse_mode: "Markdown",
        ...Markup.keyboard([['🔙 Menu Utama']]).resize()
    });
});

bot.hears('🛠 Menu Admin', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    userState.delete(ctx.from.id);
    ctx.reply("🛠 *ADMIN PANEL*", kbAdmin);
});

bot.hears('🔙 Menu Admin', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    userState.delete(ctx.from.id);
    ctx.reply("Kembali ke Panel Admin:", kbAdmin);
});

bot.hears('➕ Kategori', (ctx) => { if (String(ctx.from.id) === OWNER_ID) { userState.set(ctx.from.id, { step: 'adm_cat' }); ctx.reply("Ketik Nama Kategori Baru:"); } });
bot.hears('➕ Produk', (ctx) => { if (String(ctx.from.id) === OWNER_ID) { userState.set(ctx.from.id, { step: 'adm_prod' }); ctx.reply("Format: `Kategori|Nama|Harga|Deskripsi|Pesan_sukses` "); } });
bot.hears('➕ Isi Stok', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    const store = readDB(db_path.store);
    if (!store.categories || store.categories.length === 0) {
        return ctx.reply("❌ Belum ada kategori tersimpan. Tambahkan kategori dulu.");
    }

    let buttons = [];
    store.categories.forEach(c => {
        const encodedCat = Buffer.from(c).toString('base64');
        buttons.push([Markup.button.callback(`📁 ${c}`, `admstck_c_${encodedCat}`)]);
    });

    ctx.reply("📦 *Pilih Kategori Produk untuk Isi Stok:*", {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard(buttons)
    });
});
bot.hears('🔑 Ambil Stok', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    const store = readDB(db_path.store);
    if (!store.categories || store.categories.length === 0) return ctx.reply("❌ Belum ada kategori tersimpan.");
    let buttons = [];
    store.categories.forEach(c => {
        const encodedCat = Buffer.from(c).toString('base64');
        buttons.push([Markup.button.callback(`📁 ${c}`, `d_get_c_${encodedCat}`)]);
    });
    ctx.reply("🔑 *Pilih Kategori Produk untuk Ambil Stok:*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

// --- FITUR HAPUS BARU ---
bot.hears('🗑️ Hapus Data', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    ctx.reply("🗑️ *MENU PENGHAPUSAN DATA*\nSilahkan pilih data yang ingin dihapus:", { parse_mode: "Markdown", ...kbDeleteMenu });
});

bot.hears('➖ Hapus Kategori', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    const s = readDB(db_path.store);
    if (s.categories.length === 0) return ctx.reply("Belum ada kategori.");
    userState.set(ctx.from.id, { step: 'adm_del_cat' });
    let text = "🗑️ *PILIH KATEGORI UNTUK DIHAPUS*\nKetik nama kategori yang ingin dihapus:\n\n";
    s.categories.forEach((c, i) => text += `${i + 1}. \`${c}\`\n`);
    ctx.reply(text, { parse_mode: "Markdown" });
});

bot.hears('➖ Hapus Produk', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    const store = readDB(db_path.store);
    if (!store.categories || store.categories.length === 0) return ctx.reply("❌ Belum ada kategori tersimpan.");
    let buttons = [];
    store.categories.forEach(c => {
        const encodedCat = Buffer.from(c).toString('base64');
        buttons.push([Markup.button.callback(`📁 ${c}`, `d_delp_c_${encodedCat}`)]);
    });
    ctx.reply("🗑️ *Pilih Kategori dari Produk yang ingin dihapus:*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

bot.hears('➖ Kosongkan Stok', (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    const store = readDB(db_path.store);
    if (!store.categories || store.categories.length === 0) return ctx.reply("❌ Belum ada kategori tersimpan.");
    let buttons = [];
    store.categories.forEach(c => {
        const encodedCat = Buffer.from(c).toString('base64');
        buttons.push([Markup.button.callback(`📁 ${c}`, `d_dels_c_${encodedCat}`)]);
    });
    ctx.reply("🧹 *Pilih Kategori dari Produk yang stoknya ingin dikosongkan:*", { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) });
});

bot.hears('⚙️ Set Sticker', (ctx) => {
    if (String(ctx.from.id) === OWNER_ID) {
        ctx.reply("⚙️ *PENGATURAN STIKER*", {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("✅ Stiker Sukses", "set_stk_success")],
                [Markup.button.callback("❌ Stiker Batal", "set_stk_cancel")]
            ])
        });
    }
});

bot.hears('💰 Kelola Saldo', (ctx) => {
    if (String(ctx.from.id) === OWNER_ID) {
        userState.set(ctx.from.id, { step: 'adm_saldo' });
        ctx.reply("Kelola saldo user.\n\nFormat: `add/sub [ID_USER] [NOMINAL]`\nContoh: `add 1234567 10000` ");
    }
});

bot.hears('📢 Broadcast', (ctx) => {
    if (String(ctx.from.id) === OWNER_ID) {
        userState.set(ctx.from.id, { step: 'adm_bc' });
        ctx.reply("Kirim pesan yang ingin di-broadcast ke seluruh user:");
    }
});

bot.hears('📂 List Data', (ctx) => {
    if (String(ctx.from.id) === OWNER_ID) {
        const s = readDB(db_path.store);
        let res = "📂 *LIST DATA GUDANG*\n━━━━━━━━━━━━━━━━━━\n\n";
        if (s.products.length === 0) res += "_Belum ada produk._";
        s.products.forEach(p => res += `🔹 ID: \`${p.id}\` | ${p.name} (${p.stocks.length})\n`);
        ctx.reply(res, { parse_mode: "Markdown" });
    }
});

bot.hears('🔙 Menu Utama', async (ctx) => {
    const id = ctx.from.id;
    if (activeChats.has(id)) {
        const target = activeChats.get(id);
        activeChats.delete(id);
        activeChats.delete(target);
        bot.telegram.sendMessage(target, "🛑 Sesi bantuan telah diakhiri oleh lawan bicara.\nKetik /start untuk membuka menu utama.", String(target) === OWNER_ID ? kbAdmin : Markup.removeKeyboard());
    }
    userState.delete(id);
    await ctx.reply("Memuat Menu Utama...", Markup.removeKeyboard());
    const u = readDB(db_path.user);
    const user = u.find(x => String(x.id) === String(id));
    if (user) {
        const { text, kb } = getStartMessage(ctx, user, u.length, readDB(db_path.trx));
        try { await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: text, parse_mode: "Markdown", ...kb }); }
        catch (e) { await ctx.reply(text, { parse_mode: "Markdown", ...kb }); }
    }
});

// === ACTION CALLBACKS ===

const getFlashSaleText = () => {
    const timeStr = moment.tz('Asia/Jakarta').format('HH:mm');
    return `✨ — ⚡ *FLASH SALE ZONE* ⚡ — ✨\n\n🚀 *Buruan! Stok terbatas dan waktu berjalan.*\n🕛 _Update Otomatis (WIB)_\n━━━━━━━━━━━━━━━━━━\n\n😴 Belum ada promo aktif...\n\n━━━━━━━━━━━━━━━━━━\n💡 _Gunakan tombol Refresh untuk update waktu._  ${timeStr}`;
};

bot.action('menu_flash_sale', async (ctx) => {
    const text = getFlashSaleText();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Refresh Waktu", "refresh_flash_sale"), Markup.button.callback("🏠 Menu Utama", "back_to_home")]
    ]);
    try { await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb })); } catch (e) { }
});

bot.action('refresh_flash_sale', async (ctx) => {
    const text = getFlashSaleText();
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Refresh Waktu", "refresh_flash_sale"), Markup.button.callback("🏠 Menu Utama", "back_to_home")]
    ]);
    try {
        await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb }));
        await ctx.answerCbQuery("Diperbarui!", false);
    } catch (e) {
        // If content is the same, Telegram throws an error, we just answer the callback
        await ctx.answerCbQuery("Sudah versi terbaru!", false).catch(() => { });
    }
});

const getCatalogPage = (pageStr, cats, products) => {
    const page = parseInt(pageStr) || 1;
    const limit = 10;
    const totalItems = cats.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const currentPage = Math.min(Math.max(1, page), totalPages);

    const startIndex = (currentPage - 1) * limit;
    const endIndex = Math.min(startIndex + limit, totalItems);
    const pageCats = cats.slice(startIndex, endIndex);

    let text = `✨ *KATALOG PRODUK UTAMA* ✨\n\n📖 Hal: ${currentPage} dari ${totalPages} | 📦 Item: ${totalItems}\n━━━━━━━━━━━━━━━━━━\n\n`;

    if (pageCats.length === 0) {
        text += "_Belum ada produk._\n\n";
    } else {
        let buttonsRow1 = [];
        let buttonsRow2 = [];

        pageCats.forEach((cName, idx) => {
            const globalNumber = startIndex + idx + 1;
            const localNumber = idx + 1;

            const prodsInCat = products.filter(p => p.category === cName);
            let totalStock = 0;
            prodsInCat.forEach(p => totalStock += p.stocks.length);

            text += `${globalNumber}. ${cName.toUpperCase()}\n   ↳ Tersedia: ${totalStock > 0 ? totalStock : 'HABIS ❌'}\n`;

            const encodedName = Buffer.from(cName).toString('base64');
            const btn = Markup.button.callback(String(globalNumber), `c_${encodedName}`);
            if (localNumber <= 5) buttonsRow1.push(btn);
            else buttonsRow2.push(btn);
        });

        text += "\n💡 _Pilih nomor di bawah untuk lihat detail._";

        let kbArray = [];
        if (buttonsRow1.length > 0) kbArray.push(buttonsRow1);
        if (buttonsRow2.length > 0) kbArray.push(buttonsRow2);

        let navRow = [];
        if (currentPage > 1) navRow.push(Markup.button.callback("⬅️ Prev", `katalog_page_${currentPage - 1}`));
        if (currentPage < totalPages) navRow.push(Markup.button.callback("Next ➡️", `katalog_page_${currentPage + 1}`));
        if (navRow.length > 0) kbArray.push(navRow);

        kbArray.push([Markup.button.callback("⚡ FLASH SALE", "menu_flash_sale"), Markup.button.callback("🔥 POPULER", "menu_populer")]);
        kbArray.push([Markup.button.callback("🏠 KEMBALI KE MENU UTAMA", "back_to_home")]);

        return { text, kb: Markup.inlineKeyboard(kbArray) };
    }

    const fallbackKb = Markup.inlineKeyboard([
        [Markup.button.callback("⚡ FLASH SALE", "menu_flash_sale"), Markup.button.callback("🔥 POPULER", "menu_populer")],
        [Markup.button.callback("🏠 KEMBALI KE MENU UTAMA", "back_to_home")]
    ]);
    return { text, kb: fallbackKb };
};

bot.action('menu_belanja', async (ctx) => {
    userState.delete(ctx.from.id);
    const s = readDB(db_path.store);
    const cats = [...new Set(s.categories)].sort();
    const { text, kb } = getCatalogPage(1, cats, s.products);
    try { await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb })); } catch (e) { }
});

bot.action(/^katalog_page_(.*)$/, async (ctx) => {
    const page = ctx.match[1];
    const s = readDB(db_path.store);
    const cats = [...new Set(s.categories)].sort();
    const { text, kb } = getCatalogPage(page, cats, s.products);
    try {
        await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb }));
        await ctx.answerCbQuery();
    } catch (e) {
        await ctx.answerCbQuery("Sudah di halaman ini.", false).catch(() => { });
    }
});

bot.action(/^c_(.*)$/, async (ctx) => {
    try {
        const catName = Buffer.from(ctx.match[1], 'base64').toString('ascii');
        const s = readDB(db_path.store);
        const trxs = readDB(db_path.trx);

        const prods = s.products.filter(p => p.category === catName);
        if (prods.length === 0) return ctx.answerCbQuery("⚠️ Kategori ini kosong.", true);

        const successTrxs = trxs.filter(x => x.status === "success");
        let totalSoldCat = 0;
        prods.forEach(p => {
            const soldForProduct = successTrxs.filter(tx => tx.productId === p.id).reduce((sum, tx) => sum + (tx.qty || 1), 0);
            totalSoldCat += soldForProduct;
        });

        const firstProdDesc = prods[0].desc && prods[0].desc !== "-" ? prods[0].desc : "Promo eksklusif! Cek varian di bawah ini.";
        const timeStr = moment.tz('Asia/Jakarta').format('HH.mm.ss [WIB]');

        let text = `┌─────────────────────────┐\n• Produk: *${catName.toUpperCase()}*\n• Terjual: ${totalSoldCat}\n└─────────────────────────┘\n📝 Deskripsi:\n_${firstProdDesc}_\n\n┌─────────────────────────┐\n*VARIANT PRODUCT:*\n`;

        let variantButtons = [];
        prods.forEach((p, i) => {
            const stock = p.stocks.length;
            text += `• ${i + 1}. ${p.name.toUpperCase()}\n  ↳ Rp${p.price.toLocaleString('id-ID')} — Stok: ${stock > 0 ? stock : 'HABIS ❌'}\n`;

            if (stock > 0) {
                variantButtons.push([Markup.button.callback(`${p.name.toUpperCase()} - Rp ${p.price.toLocaleString('id-ID')}`, `v_${p.id}_1`)]);
            }
        });

        text += `└─────────────────────────┘\n🕛 _Refreshed at ${timeStr}_\n`;

        let b = [...variantButtons];
        b.push([
            Markup.button.callback("🔄 Refresh", `c_${ctx.match[1]}`),
            Markup.button.callback("⬅️ Back", "back_to_shop")
        ]);
        b.push([Markup.button.callback("📦 Back To Product", "back_to_shop")]);

        try {
            await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...Markup.inlineKeyboard(b) });
        } catch (e) {
            await ctx.editMessageText(text, { parse_mode: "Markdown", ...Markup.inlineKeyboard(b) });
        }
        await ctx.answerCbQuery().catch(() => { });
    } catch (err) {
        ctx.answerCbQuery("⚠️ Gagal memuat detail produk.", true).catch(() => { });
    }
});

const getPopularPage = (pageStr, products, trxs) => {
    const page = parseInt(pageStr) || 1;
    const limit = 10;

    const successTrxs = trxs.filter(x => x.status === "success" && x.type === "direct");

    let stats = products.map(p => {
        let soldQty = 0;
        successTrxs.filter(tx => tx.productId === p.id).forEach(tx => {
            soldQty += (tx.qty || 1);
        });
        return { ...p, soldQty };
    }).filter(p => p.soldQty > 0);

    stats.sort((a, b) => b.soldQty - a.soldQty);

    const totalItems = stats.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const currentPage = Math.min(Math.max(1, page), totalPages);

    const startIndex = (currentPage - 1) * limit;
    const endIndex = Math.min(startIndex + limit, totalItems);
    const pageStats = stats.slice(startIndex, endIndex);

    let text = `🔥 *BEST SELLER - TOP RANKING* 🔥\n━━━━━━━━━━━━━━━━━━\n📊 _Data Berdasarkan Penjualan Terbanyak_\n📁 Hal: ${currentPage} / ${totalPages}\n━━━━━━━━━━━━━━━━━━\n\n`;

    if (pageStats.length === 0) {
        text += "_Belum ada data penjualan._\n\n";
    } else {
        pageStats.forEach((p, idx) => {
            const globalNumber = startIndex + idx + 1;
            let rankIcon = "🔹";
            if (globalNumber === 1) rankIcon = "🥇";
            else if (globalNumber === 2) rankIcon = "🥈";
            else if (globalNumber === 3) rankIcon = "🥉";

            text += `${rankIcon} *RANK #${globalNumber} - ${p.name.toUpperCase()}*\n 📦 Terjual: ${p.soldQty.toLocaleString('id-ID')} unit\n`;
        });
        text += "\n✨ _Produk di atas adalah yang paling sering dicari._";
    }

    let kbArray = [];
    let navRow = [];
    if (currentPage > 1) navRow.push(Markup.button.callback("⏪ Sebelumnya", `populer_page_${currentPage - 1}`));
    if (currentPage < totalPages) navRow.push(Markup.button.callback("Berikutnya ⏩", `populer_page_${currentPage + 1}`));
    if (navRow.length > 0) kbArray.push(navRow);

    kbArray.push([Markup.button.callback("📦 Katalog Produk", "menu_belanja"), Markup.button.callback("⚡ Flash Sale", "menu_flash_sale")]);
    kbArray.push([Markup.button.callback("🏠 Kembali ke Home", "back_to_home")]);

    return { text, kb: Markup.inlineKeyboard(kbArray) };
};

bot.action('menu_populer', async (ctx) => {
    userState.delete(ctx.from.id);
    const s = readDB(db_path.store);
    const trxs = readDB(db_path.trx);
    const { text, kb } = getPopularPage(1, s.products, trxs);
    try { await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb })); } catch (e) { }
});

bot.action(/^populer_page_(.*)$/, async (ctx) => {
    const page = ctx.match[1];
    const s = readDB(db_path.store);
    const trxs = readDB(db_path.trx);
    const { text, kb } = getPopularPage(page, s.products, trxs);
    try {
        await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb }));
        await ctx.answerCbQuery();
    } catch (e) {
        await ctx.answerCbQuery("Sudah di halaman ini.", false).catch(() => { });
    }
});

bot.action('menu_topup', async (ctx) => {
    userState.delete(ctx.from.id);
    const text = "Silahkan pilih nominal di bawah atau ketik perintah:\n`/topup [nominal]`\nContoh: `/topup 50000`";
    const kb = Markup.inlineKeyboard([
        [Markup.button.callback("Rp 5.000", "tu_5000"), Markup.button.callback("Rp 10.000", "tu_10000")],
        [Markup.button.callback("Rp 20.000", "tu_20000"), Markup.button.callback("Rp 50.000", "tu_50000")],
        [Markup.button.callback("🔙 Menu Utama", "back_to_home")]
    ]);
    try { await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb })); } catch (e) { }
});

bot.action('menu_populer', async (ctx) => {
    userState.delete(ctx.from.id);
    const s = readDB(db_path.store);
    if (s.categories.length === 0) return ctx.answerCbQuery("Gudang kosong.", true);
    let t = "📊 *PRODUK POPULER & STOK*\n━━━━━━━━━━━━━━━━━━\n\n";
    s.categories.sort().forEach(c => {
        const prodInCategory = s.products.filter(p => p.category === c);
        if (prodInCategory.length > 0) {
            t += `📁 *${c.toUpperCase()}*\n`;
            prodInCategory.forEach(p => t += `  - ${p.name}: *${p.stocks.length}*\n`);
            t += "\n";
        }
    });
    const kb = Markup.inlineKeyboard([[Markup.button.callback("🔙 Menu Utama", "back_to_home")]]);
    try { await ctx.editMessageCaption(t, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(t, { parse_mode: "Markdown", ...kb })); } catch (e) { }
});

bot.action('menu_profil', async (ctx) => {
    userState.delete(ctx.from.id);
    const u = readDB(db_path.user).find(x => String(x.id) === String(ctx.from.id));
    if (!u) return ctx.answerCbQuery("User tidak ditemukan.", true);

    const text = `👤 <b>PROFIL PENGGUNA</b>\n━━━━━━━━━━━━━━━━━━\n🆔 ID: <code>${u.id}</code>\n👤 Nama: ${u.name}\n💳 Saldo: <b>Rp ${u.balance.toLocaleString()}</b>\n📅 Join: ${u.joined}\n━━━━━━━━━━━━━━━━━━`;
    const kb = Markup.inlineKeyboard([[Markup.button.callback("🔙 Menu Utama", "back_to_home")]]);
    try { await ctx.editMessageCaption(text, { parse_mode: "HTML", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "HTML", ...kb })); } catch (e) { }
});

bot.action('menu_admin', async (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return ctx.answerCbQuery("Akses ditolak.", true);
    userState.delete(ctx.from.id);
    await ctx.reply("🛠 *ADMIN PANEL*", kbAdmin);
});

bot.action('back_to_home', async (ctx) => {
    const u = readDB(db_path.user);
    const user = u.find(x => String(x.id) === String(ctx.from.id));
    if (!user) return ctx.answerCbQuery("User tidak ditemukan.", true);

    const { text, kb } = getStartMessage(ctx, user, u.length, readDB(db_path.trx));
    try { await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb })); } catch (e) { }
});

bot.action("back_to_shop", async (ctx) => {
    const s = readDB(db_path.store);
    const cats = [...new Set(s.categories)].sort();
    const { text, kb } = getCatalogPage(1, cats, s.products);
    try { await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...kb }).catch(() => ctx.editMessageText(text, { parse_mode: "Markdown", ...kb })); } catch (e) { }
});

bot.action(/^accept_chat_(.*)$/, async (ctx) => {
    const userId = ctx.match[1];
    if (String(ctx.from.id) !== OWNER_ID) return;

    activeChats.set(OWNER_ID, userId);
    activeChats.set(userId, OWNER_ID);
    userState.delete(userId);

    await ctx.answerCbQuery("✅ Chat terhubung!");
    await ctx.editMessageText(`✅ Terhubung dengan user \`${userId}\`.\nKetik apa saja untuk membalas, atau kirim media.`, { parse_mode: "Markdown" });
    await bot.telegram.sendMessage(userId, "✅ Admin telah memasuki room chat. Sampaikan kendala Anda secara live sekarang.", kbChat);
});

bot.action("set_stk_success", (ctx) => {
    userState.set(ctx.from.id, { step: 'adm_set_sticker_success' });
    ctx.answerCbQuery();
    ctx.reply("Silahkan kirim stiker untuk notifikasi *SUKSES*.");
});

bot.action("set_stk_cancel", (ctx) => {
    userState.set(ctx.from.id, { step: 'adm_set_sticker_cancel' });
    ctx.answerCbQuery();
    ctx.reply("Silahkan kirim stiker untuk notifikasi *BATAL*.");
});

bot.action(/^check_trx_(.*)$/, async (ctx) => {
    const orderId = ctx.match[1];
    let trxs = readDB(db_path.trx); let users = readDB(db_path.user); let store = readDB(db_path.store);
    const tx = trxs.find(x => x.orderId === orderId);
    if (!tx) return ctx.answerCbQuery("❌ Transaksi tidak ditemukan.", true);
    if (tx.status !== "pending") return ctx.answerCbQuery("✅ Transaksi ini sudah selesai.", true);

    const status = await checkStatusPakasir(orderId, tx.amount);
    if (status === "PAID") {
        await ctx.answerCbQuery("✅ Pembayaran terdeteksi!", true);
        if (await processDelivery(tx, users, store)) {
            writeDB(db_path.trx, trxs); writeDB(db_path.user, users); writeDB(db_path.store, store);
            try { await ctx.deleteMessage(); } catch (e) { }
        }
    } else {
        ctx.answerCbQuery("⏳ Pembayaran belum terdeteksi.", true);
    }
});

bot.action(/^tu_(.*)$/, async (ctx) => {
    const nominal = parseInt(ctx.match[1]);
    await ctx.answerCbQuery();
    await createTopupRequest(ctx, nominal);
});

// 1. Menu Detail Produk / Konfirmasi Pesanan
bot.action(/^v_(.*)$/, async (ctx) => {
    try {
        const [_, payload] = ctx.match;
        const [pid, qtyStr] = payload.split('_');
        let qty = parseInt(qtyStr) || 1;

        const s = readDB(db_path.store);
        const p = s.products.find(x => x.id === pid);

        if (!p) return ctx.answerCbQuery("❌ Produk tidak ditemukan.", true);

        const stockCount = p.stocks.length;
        if (stockCount === 0) return ctx.answerCbQuery("⚠️ Stok produk ini sedang kosong.", true);

        if (qty > stockCount) qty = stockCount; // Cap quantity to max stock

        let totalPrice = p.price * qty;
        let originalPrice = totalPrice;
        
        let isFlashSale = false;
        let discountInfo = "";
        const fsList = readDB(db_path.flashsale) || [];
        const fs = fsList.find(x => x.productId === pid && Date.now() <= x.expiresAt && x.usedCount < x.maxUses);
        
        if (fs) {
            isFlashSale = true;
            let finalPrice = p.price;
            if (fs.discount.includes("%")) {
                finalPrice = p.price - ((p.price * parseInt(fs.discount)) / 100);
            } else {
                finalPrice = p.price - parseInt(fs.discount);
            }
            if (finalPrice < 0) finalPrice = 0;
            totalPrice = finalPrice * qty;
            discountInfo = `┣ Diskon (⚡ Flash Sale): -Rp ${((p.price - finalPrice) * qty).toLocaleString('id-ID')}\n┣ Harga Asli: ~Rp ${originalPrice.toLocaleString('id-ID')}~\n`;
        } else {
            const uState = userState.get(ctx.from.id);
            const activeVoucher = uState?.activeVoucher;
            
            if (activeVoucher && activeVoucher.discount) {
                let discVal = 0;
                if (activeVoucher.discount.includes("%")) {
                    const pct = parseFloat(activeVoucher.discount);
                    discVal = Math.floor(originalPrice * (pct / 100));
                } else {
                    discVal = parseInt(activeVoucher.discount) || 0;
                }
                totalPrice -= discVal;
                if (totalPrice < 0) totalPrice = 0;
                discountInfo = `┣ Diskon (${activeVoucher.code}): -Rp ${discVal.toLocaleString('id-ID')}\n┣ Harga Asli: ~Rp ${originalPrice.toLocaleString('id-ID')}~\n`;
            }
        }

        const timeStr = moment.tz('Asia/Jakarta').format('HH.mm.ss [WIB]');

        const text = `✨ *KONFIRMASI PESANAN* ✨\n━━━━━━━━━━━━━━━━━━\n\n📦 *PRODUK:* ${p.category.toUpperCase()}\n🏷 *VARIAN:* ${p.name.toUpperCase()}\nℹ️ *Deskripsi:* ${p.desc || "-"}\n\n━━━━━━━━━━━━━━━━━━\n💰 *DAFTAR HARGA :*\n1+ = Rp ${p.price.toLocaleString('id-ID')}/item ✅\n\n📊 *INFORMASI STOK:*\n┣ Tersedia: ${stockCount} unit\n┗ Min. Beli: 1 unit\n\n🛒 *RINCIAN BELANJA:*\n┣ Jumlah: ${qty}x\n┣ Harga Satuan: Rp ${p.price.toLocaleString('id-ID')}\n${discountInfo}┗ *TOTAL BAYAR: Rp ${totalPrice.toLocaleString('id-ID')}*\n━━━━━━━━━━━━━━━━━━\n🕛 _Diperbarui pada: ${timeStr}_`;

        let qtyButtons = [];

        // Dynamically build quantity adjustment buttons based on stock
        let row1 = [];
        if (stockCount > qty && (qty + 1) <= stockCount) row1.push(Markup.button.callback("+1", `v_${pid}_${qty + 1}`));
        if (stockCount >= (qty + 5)) row1.push(Markup.button.callback("+5", `v_${pid}_${qty + 5}`));
        if (stockCount >= (qty + 10)) row1.push(Markup.button.callback("+10", `v_${pid}_${qty + 10}`));
        if (stockCount >= (qty + 20) && row1.length < 3) row1.push(Markup.button.callback("+20", `v_${pid}_${qty + 20}`));

        if (row1.length > 0) qtyButtons.push(row1);

        const b = [...qtyButtons];
        if (!isFlashSale) b.push([Markup.button.callback("🎟 Gunakan Voucher", `vouch_${pid}_${qty}`)]);
        b.push([Markup.button.callback(`✅ Confirm (Rp${totalPrice.toLocaleString('id-ID')}) - SALDO`, `pay_bal_${pid}_${qty}_${totalPrice}`)]);
        b.push([Markup.button.callback(`💳 Bayar via QRIS (Rp${totalPrice.toLocaleString('id-ID')})`, `pay_qris_${pid}_${qty}_${totalPrice}`)]);
        b.push([Markup.button.callback("🔄 Refresh", `v_${pid}_${qty}`), Markup.button.callback("⬅️ Kembali", `c_${Buffer.from(p.category).toString('base64')}`)]);

        try {
            await ctx.editMessageCaption(text, { parse_mode: "Markdown", ...Markup.inlineKeyboard(b) });
        } catch (e) {
            await ctx.editMessageText(text, { parse_mode: "Markdown", ...Markup.inlineKeyboard(b) }).catch(() => { });
        }
        await ctx.answerCbQuery().catch(() => { });
    } catch (err) {
        ctx.answerCbQuery("⚠️ Gagal memuat produk.", true).catch(() => { });
    }
});

bot.action(/^vouch_(.*)$/, async (ctx) => {
    userState.set(ctx.from.id, { step: 'input_voucher' });
    await ctx.reply("🎟 Silakan ketik *KODE VOUCHER* Anda:", { parse_mode: "Markdown" });
    await ctx.answerCbQuery();
});

// 2. Checkout handlers (dipanggil langsung dari Confirm Menu)

bot.action(/^pay_bal_(.*)_(.*)_(.*)$/, async (ctx) => {
    const [_, pid, qty, amount] = ctx.match;
    let users = readDB(db_path.user); let store = readDB(db_path.store); let trxs = readDB(db_path.trx);
    const uIdx = users.findIndex(u => String(u.id) === String(ctx.from.id));
    const pIdx = store.products.findIndex(p => p.id === pid);
    if (uIdx === -1 || users[uIdx].balance < parseInt(amount)) return ctx.answerCbQuery("❌ Saldo tidak cukup!", true);
    if (pIdx === -1 || store.products[pIdx].stocks.length < parseInt(qty)) return ctx.answerCbQuery("❌ Stok habis!", true);
    users[uIdx].balance -= parseInt(amount);

    const uState = userState.get(ctx.from.id);
    const activeVoucher = uState?.activeVoucher;

    const tx = { orderId: `BAL${Date.now()}`, userId: ctx.from.id, amount: parseInt(amount), type: "direct", productId: pid, productName: store.products[pIdx].name, qty: parseInt(qty), status: "pending", date: moment().format() };
    if (await processDelivery(tx, users, store)) {
        trxs.push(tx);
        writeDB(db_path.user, users); writeDB(db_path.store, store); writeDB(db_path.trx, trxs);

        let fsList = readDB(db_path.flashsale) || [];
        const fsIdx = fsList.findIndex(x => x.productId === pid && Date.now() <= x.expiresAt && x.usedCount < x.maxUses);
        if (fsIdx !== -1) {
            fsList[fsIdx].usedCount += parseInt(qty);
            writeDB(db_path.flashsale, fsList);
        }

        if (activeVoucher) {
            let promos = readDB(db_path.promo);
            const vIdx = promos.findIndex(p => p.code === activeVoucher.code);
            if (vIdx !== -1) {
                if (!promos[vIdx].usedBy) promos[vIdx].usedBy = [];
                promos[vIdx].usedBy.push(ctx.from.id);
                writeDB(db_path.promo, promos);
            }
            userState.set(ctx.from.id, { ...uState, activeVoucher: null });
        }

        await ctx.deleteMessage(); ctx.answerCbQuery("✅ Transaksi Berhasil!", true);
    } else ctx.answerCbQuery("❌ Terjadi kesalahan.", true);
});

bot.action(/^pay_qris_(.*)_(.*)_(.*)$/, async (ctx) => {
    const [_, pid, qty, amount] = ctx.match;
    const orderId = `INV${Date.now()}`;
    const p = readDB(db_path.store).products.find(x => x.id === pid);
    if (!p || p.stocks.length < parseInt(qty)) return ctx.answerCbQuery("Stok habis.", true);
    await ctx.deleteMessage(); ctx.reply("⌛ Menyiapkan QRIS Pakasir...");
    
    const uState = userState.get(ctx.from.id);
    const activeVoucher = uState?.activeVoucher;

    try {
        const payload = { project: PAKASIR_SLUG, order_id: orderId, amount: parseInt(amount), api_key: PAKASIR_KEY };
        const res = await axios.post('https://app.pakasir.com/api/transactioncreate/qris', payload, { headers: { 'Content-Type': 'application/json' } });
            if (res.data && res.data.payment) {
            const qr = await QRCode.toBuffer(res.data.payment.payment_number);
            let txs = readDB(db_path.trx);
            txs.push({ orderId, userId: ctx.from.id, amount: parseInt(amount), type: "direct", productId: pid, productName: p.name, qty: parseInt(qty), status: "pending", date: moment().format() });
            writeDB(db_path.trx, txs);

            let fsList = readDB(db_path.flashsale) || [];
            const fsIdx = fsList.findIndex(x => x.productId === pid && Date.now() <= x.expiresAt && x.usedCount < x.maxUses);
            if (fsIdx !== -1) {
                fsList[fsIdx].usedCount += parseInt(qty);
                writeDB(db_path.flashsale, fsList);
            }

            if (activeVoucher) {
                let promos = readDB(db_path.promo);
                const vIdx = promos.findIndex(p => p.code === activeVoucher.code);
                if (vIdx !== -1) {
                    if (!promos[vIdx].usedBy) promos[vIdx].usedBy = [];
                    promos[vIdx].usedBy.push(ctx.from.id);
                    writeDB(db_path.promo, promos);
                }
                userState.set(ctx.from.id, { ...uState, activeVoucher: null });
            }
            await ctx.replyWithPhoto({ source: qr }, {
                caption: `💳 *PAYMENT QRIS*\n━━━━━━━━━━━━━━━━━━\nTotal: *Rp ${res.data.payment.total_payment.toLocaleString()}*\n\n_Data terkirim otomatis setelah bayar._`,
                parse_mode: "Markdown",
                ...Markup.inlineKeyboard([[Markup.button.callback("✅ Cek Manual", `check_trx_${orderId}`)], [Markup.button.callback("❌ Batal", `cancel_trx_${orderId}`)]])
            });
        }
    } catch (e) { ctx.reply("❌ Gagal membuat QRIS."); }
});

bot.action(/^cancel_trx_(.*)$/, async (ctx) => {
    const orderId = ctx.match[1]; let txs = readDB(db_path.trx); const i = txs.findIndex(x => x.orderId === orderId);
    if (i !== -1) { txs[i].status = "cancelled"; writeDB(db_path.trx, txs); await ctx.deleteMessage(); await ctx.reply("❌ Pembayaran dibatalkan."); await sendCancelSticker(ctx.from.id); }
});

bot.action(/^del_vouch_(.*)$/, async (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    const vCode = ctx.match[1];
    let promos = readDB(db_path.promo);
    const initialLen = promos.length;
    promos = promos.filter(p => String(p.code) !== String(vCode));
    
    if (promos.length < initialLen) {
        writeDB(db_path.promo, promos);
        await ctx.answerCbQuery(`✅ Voucher ${vCode} dihapus!`, true).catch(()=> {});
        await ctx.deleteMessage().catch(()=>{});
        ctx.reply(`✅ Berhasil menghapus voucher *${vCode}*.`, { parse_mode: "Markdown" });
    } else {
        await ctx.answerCbQuery(`❌ Voucher ${vCode} tidak ditemukan!`, true).catch(()=> {});
    }
});

bot.action("adm_vouch_add", async (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    userState.set(ctx.from.id, { step: 'adm_promo' });
    await ctx.deleteMessage().catch(()=>{});
    ctx.reply("🎟 Masukkan pengaturan *Voucher Baru*:\nFormat: `KODE|DISKON|JAM_AKTIF` (Jam)\nContoh: `DISKON20|20%|24` (aktif 24 jam) atau `POTONG10K|10000|72` (aktif 3 hari)", { parse_mode: "Markdown", ...Markup.keyboard([['🔙 Menu Admin']]).resize() });
});

bot.action("adm_vouch_list", async (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    await ctx.answerCbQuery().catch(()=>{});
    const promos = readDB(db_path.promo);
    if (!promos || promos.length === 0) return ctx.reply("Belum ada voucher yang aktif saat ini.");

    let t = "📋 *DAFTAR VOUCHER AKTIF*\n━━━━━━━━━━━━━━━━━━\n\n";
    let buttons = [];

    promos.forEach((p, idx) => {
        let status = "Selamanya";
        if (p.expiresAt) {
            if (Date.now() > p.expiresAt) status = "🔴 KEDALUWARSA";
            else {
                const sisa = Math.floor((p.expiresAt - Date.now()) / 3600000);
                status = `🟢 Aktif (${sisa} Jam lagi)`;
            }
        }
        t += `${idx + 1}. *${p.code}*\n   📉 Diskon: ${p.discount}\n   ⏳ Status: ${status}\n   👥 Total Dipakai: ${p.usedBy ? p.usedBy.length : 0} kali\n\n`;
        buttons.push([Markup.button.callback(`🗑 Hapus ${p.code}`, `del_vouch_${p.code}`)]);
    });

    await ctx.editMessageText(t, { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) }).catch(()=>{});
});

bot.action("adm_fs_list", async (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    await ctx.answerCbQuery().catch(()=>{});
    const fsList = readDB(db_path.flashsale);
    if (!fsList || fsList.length === 0) return ctx.reply("Belum ada Flash Sale yang aktif saat ini.");

    const store = readDB(db_path.store);
    let t = "⚡ *DAFTAR FLASH SALE AKTIF*\n━━━━━━━━━━━━━━━━━━\n\n";
    let buttons = [];

    fsList.forEach((fs, idx) => {
        const p = store.products.find(x => x.id === fs.productId);
        const pName = p ? p.name : "Produk Dihapus";
        let status = "Aktif";
        if (Date.now() > fs.expiresAt) status = "🔴 WAKTU HABIS";
        else {
            const sisa = Math.floor((fs.expiresAt - Date.now()) / 3600000);
            status = `🟢 Sisa ${sisa} Jam`;
        }
        if (fs.usedCount >= fs.maxUses) status = "🔴 KUOTA HABIS";

        t += `${idx + 1}. *${pName}*\n   📉 Diskon: ${fs.discount}\n   👥 Kuota: ${fs.usedCount}/${fs.maxUses}\n   ⏳ Status: ${status}\n\n`;
        buttons.push([Markup.button.callback(`🗑 Hapus FS ${pName.substring(0,10)}`, `del_fs_${fs.productId}`)]);
    });

    await ctx.editMessageText(t, { parse_mode: "Markdown", ...Markup.inlineKeyboard(buttons) }).catch(()=>{});
});

bot.action(/^del_fs_(.*)$/, async (ctx) => {
    if (String(ctx.from.id) !== OWNER_ID) return;
    const pId = ctx.match[1];
    let fsList = readDB(db_path.flashsale);
    const initialLen = fsList.length;
    fsList = fsList.filter(f => String(f.productId) !== String(pId));
    
    if (fsList.length < initialLen) {
        writeDB(db_path.flashsale, fsList);
        await ctx.answerCbQuery(`✅ Flash Sale dihapus!`, true).catch(()=> {});
        ctx.reply(`✅ Berhasil menghentikan Flash Sale untuk Produk ID *${pId}*.`, { parse_mode: "Markdown" });
        await ctx.deleteMessage().catch(()=>{});
    } else {
        await ctx.answerCbQuery(`❌ Flash Sale tidak ditemukan!`, true).catch(()=> {});
    }
});

bot.action(/^admstck_c_(.*)$/, async (ctx) => {
    try {
        const catStrBase64 = ctx.match[1];
        const categoryExtracted = Buffer.from(catStrBase64, 'base64').toString('utf-8');
        const store = readDB(db_path.store);
        const prods = store.products.filter(p => p.category === categoryExtracted);

        if (prods.length === 0) return ctx.answerCbQuery("Kategori ini kosong.", true).catch(() => { });

        let buttons = [];
        prods.forEach(p => {
            buttons.push([Markup.button.callback(`🏷 ${p.name}`, `admstck_p_${p.id}`)]);
        });

        await ctx.editMessageText(`📦 *Produk dalam kategori ${categoryExtracted}:*\nPilih produk yang ingin diisi stoknya:`, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(buttons)
        });
    } catch (e) {
        await ctx.answerCbQuery("Terjadi kesalahan.", true).catch(() => { });
    }
});

bot.action(/^admstck_p_(.*)$/, async (ctx) => {
    try {
        const pId = ctx.match[1];
        const store = readDB(db_path.store);
        const p = store.products.find(x => x.id === pId);

        if (p) {
            userState.set(ctx.from.id, { step: 'adm_stok_bulk', pId: p.id });
            await ctx.deleteMessage();
            await bot.telegram.sendMessage(ctx.from.id, `Isi stok *${p.name}*:\n\n- Format Akun: \`email|password|pin\`\n- Format Link: Langsung tempel link per baris\n\nKirimkan Data Stok Sekarang:`, {
                parse_mode: "Markdown",
                ...Markup.keyboard([['🔙 Menu Admin']]).resize()
            });
        } else {
            await ctx.answerCbQuery("Produk tidak ditemukan.", true).catch(() => { });
        }
    } catch (e) {
        await ctx.answerCbQuery("Terjadi kesalahan.", true).catch(() => { });
    }
});

bot.action(/^rate_(.*)$/, async (ctx) => {
    try {
        const score = parseInt(ctx.match[1]);
        const userId = ctx.from.id;

        let settings = readDB(db_path.settings);
        if (!settings.ratings) settings.ratings = [];

        // Tambahkan skor baru tanpa menghapus skor sebelumnya (bebas berkali-kali)
        settings.ratings.push({ userId, score });

        writeDB(db_path.settings, settings);

        await ctx.editMessageText("✅ Penilaian Berhasil, terimaksih telah meluangkan waktunya untuk memberikan penilaian 🥰.");
        await sendSuccessSticker(userId);
    } catch (e) {
        await ctx.answerCbQuery("Sudah dinilai.", true).catch(() => { });
    }
});

// === TAHAP 1: HANDLER KATEGORI (Ambil Stok, Hapus Produk, Kosongkan Stok) ===
const handleAdminCatSelect = async (ctx, prefixAction, titleLabel) => {
    try {
        const catStrBase64 = ctx.match[1];
        const categoryExtracted = Buffer.from(catStrBase64, 'base64').toString('utf-8');
        const store = readDB(db_path.store);
        const prods = store.products.filter(p => p.category === categoryExtracted);

        if (prods.length === 0) return ctx.answerCbQuery("Kategori ini kosong.", true).catch(() => { });

        let buttons = [];
        prods.forEach(p => {
            buttons.push([Markup.button.callback(`🏷 ${p.name}`, `${prefixAction}${p.id}`)]);
        });

        await ctx.editMessageText(`${titleLabel} dalam kategori *${categoryExtracted}*:`, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(buttons)
        });
    } catch (e) {
        await ctx.answerCbQuery("Terjadi kesalahan.", true).catch(() => { });
    }
};

bot.action(/^d_get_c_(.*)$/, async (ctx) => handleAdminCatSelect(ctx, 'd_get_p_', '🔑 *Pilih Produk untuk Diambil Stoknya*'));
bot.action(/^d_delp_c_(.*)$/, async (ctx) => handleAdminCatSelect(ctx, 'd_delp_p_', '🗑️ *Pilih Produk yang Ingin Dihapus*'));
bot.action(/^d_dels_c_(.*)$/, async (ctx) => handleAdminCatSelect(ctx, 'd_dels_p_', '🧹 *Pilih Produk yang Stoknya Ingin Dikosongkan*'));

// === TAHAP 2: HANDLER PRODUK (Eksekusi Aksi) ===

bot.action(/^d_get_p_(.*)$/, async (ctx) => {
    try {
        const pId = ctx.match[1];
        const store = readDB(db_path.store);
        const p = store.products.find(x => x.id === pId);
        if (!p) return ctx.answerCbQuery("❌ Produk tidak ditemukan.", true).catch(() => { });

        if (p.stocks.length === 0) {
            await ctx.answerCbQuery("Stok produk ini kosong.", true);
            return ctx.deleteMessage();
        }
        let txtInfo = `📦 *STOK PRODUK: ${p.name}*\nJumlah: ${p.stocks.length}\n━━━━━━━━━━━━━━━━━━\n\n`;
        p.stocks.forEach((s, i) => {
            const row = `${s.email || ""}|${s.pw || ""}|${s.pin || ""}|${s.link || ""}|${s.a2f || ""}|${s.profile || ""}`.replace(/\|+$/, '');
            txtInfo += `${i + 1}. \`${row}\`\n`;
        });
        await ctx.reply(txtInfo, { parse_mode: "Markdown" });
        await ctx.deleteMessage();
    } catch (e) { ctx.answerCbQuery("Error", true).catch(() => { }); }
});

bot.action(/^d_delp_p_(.*)$/, async (ctx) => {
    try {
        const pId = ctx.match[1];
        let store = readDB(db_path.store);
        const pIdx = store.products.findIndex(x => x.id === pId);
        if (pIdx === -1) return ctx.answerCbQuery("❌ Produk tidak ditemukan.", true).catch(() => { });
        const pName = store.products[pIdx].name;

        store.products.splice(pIdx, 1);
        writeDB(db_path.store, store);
        await ctx.reply(`✅ *Produk ${pName}* (ID: ${pId}) berhasil dihapus beserta stoknya.`, { parse_mode: "Markdown" });
        await ctx.deleteMessage();
    } catch (e) { ctx.answerCbQuery("Error", true).catch(() => { }); }
});

bot.action(/^d_dels_p_(.*)$/, async (ctx) => {
    try {
        const pId = ctx.match[1];
        let store = readDB(db_path.store);
        const pIdx = store.products.findIndex(x => x.id === pId);
        if (pIdx === -1) return ctx.answerCbQuery("❌ Produk tidak ditemukan.", true).catch(() => { });
        const pName = store.products[pIdx].name;

        store.products[pIdx].stocks = [];
        writeDB(db_path.store, store);
        await ctx.reply(`🧹 *Stok Produk ${pName}* berhasil dikosongkan.`, { parse_mode: "Markdown" });
        await ctx.deleteMessage();
    } catch (e) { ctx.answerCbQuery("Error", true).catch(() => { }); }
});

bot.action(/^fs_get_c_(.*)$/, async (ctx) => {
    try {
        const catStrBase64 = ctx.match[1];
        const catName = Buffer.from(catStrBase64, 'base64').toString('utf-8');
        const store = readDB(db_path.store);
        const prods = store.products.filter(p => p.category === catName);

        if (prods.length === 0) return ctx.answerCbQuery("Kategori ini kosong.", true).catch(() => {});

        let buttons = [];
        prods.forEach(p => buttons.push([Markup.button.callback(`🏷 ${p.name}`, `fs_get_p_${p.id}`)]));

        await ctx.editMessageText(`📦 *Produk Kategori ${catName}:*\nPilih produk untuk di-Flash Sale:`, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard(buttons)
        });
    } catch (e) {
        await ctx.answerCbQuery("Terjadi kesalahan.", true).catch(() => {});
    }
});

bot.action(/^fs_get_p_(.*)$/, async (ctx) => {
    const pId = ctx.match[1];
    userState.set(ctx.from.id, { step: 'adm_fs_config', pId: pId });
    await ctx.deleteMessage().catch(()=>{});
    ctx.reply("⚡ Masukkan konfigurasi Flash Sale:\nFormat: `DISKON|KUOTA_PEMBELI|JAM_AKTIF`\nContoh: `50%|10|2` (Diskon 50% untuk 10 pengguna pertama, aktif 2 jam)", { parse_mode: "Markdown", ...Markup.keyboard([['🔙 Menu Admin']]).resize() });
});

bot.action("batal_belanja", async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) { }
    const u = readDB(db_path.user);
    const user = u.find(x => String(x.id) === String(ctx.from.id));
    if (user) {
        const { text, kb } = getStartMessage(ctx, user, u.length, readDB(db_path.trx));
        try { await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: text, parse_mode: "Markdown", ...kb }); }
        catch (e) { await ctx.reply(text, { parse_mode: "Markdown", ...kb }); }
    }
    await sendCancelSticker(ctx.from.id);
});

// === MESSAGE LISTENER ===
bot.on('message', async (ctx) => {
    if (!ctx.message || !ctx.from) return;
    const id = ctx.from.id;
    const txt = ctx.message.text || "";
    const st = userState.get(id);

    // 1. --- PRIORITAS: CEK AKHIRI CHAT ---
    if (txt.includes("🛑 AKHIRI CHAT")) {
        if (activeChats.has(id)) {
            const target = activeChats.get(id);
            activeChats.delete(id);
            activeChats.delete(target);

            await bot.telegram.sendMessage(id, "Sesi bantuan telah diakhiri.\nKetik /start untuk membuka menu utama.", Markup.removeKeyboard());
            await bot.telegram.sendMessage(target, "🛑 Sesi bantuan telah diakhiri oleh lawan bicara.\nKetik /start untuk membuka menu utama.", String(target) === OWNER_ID ? kbAdmin : Markup.removeKeyboard());
            return;
        } else if (st && st.step === 'ask_support') {
            userState.delete(id);
            await ctx.reply("Permintaan bantuan dibatalkan.", Markup.removeKeyboard());
            const u = readDB(db_path.user);
            const user = u.find(x => String(x.id) === String(id));
            if (user) {
                const { text, kb } = getStartMessage(ctx, user, u.length, readDB(db_path.trx));
                try { await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: text, parse_mode: "Markdown", ...kb }); }
                catch (e) { await ctx.reply(text, { parse_mode: "Markdown", ...kb }); }
            }
            return;
        }
    }

    // 2. --- PRIORITAS: ADMIN QUICK REPLY (BALAS PESAN TERTENTU) ---
    if (String(id) === OWNER_ID && ctx.message.reply_to_message) {
        const replyMsg = ctx.message.reply_to_message;
        const targetMatch = (replyMsg.text || replyMsg.caption || "").match(/🆔 ID: `(\d+)`/);
        if (targetMatch) {
            const targetUserId = targetMatch[1];
            try {
                if (txt) {
                    await bot.telegram.sendMessage(targetUserId, `💬 *BALASAN ADMIN:*\n\n${txt}`, { parse_mode: "Markdown" });
                } else {
                    await bot.telegram.copyMessage(targetUserId, id, ctx.message.message_id);
                    await bot.telegram.sendMessage(targetUserId, `💬 *BALASAN ADMIN (MEDIA)*`, { parse_mode: "Markdown" });
                }
                return ctx.reply(`✅ Balasan terkirim ke user \`${targetUserId}\`.`, { parse_mode: "Markdown" });
            } catch (e) {
                return ctx.reply("❌ Gagal mengirim balasan. User mungkin memblokir bot.");
            }
        }
    }

    // 3. --- LIVE CHAT MIRRORING ---
    if (activeChats.has(id)) {
        const target = activeChats.get(id);
        return bot.telegram.copyMessage(target, id, ctx.message.message_id);
    }

    // 4. --- PENGAJUAN LIVE CHAT (User Side) ---
    if (st && st.step === 'ask_support') {
        if (txt === '🔙 Menu Utama') {
            userState.delete(id);
            await ctx.reply("Memuat Menu Utama...", Markup.removeKeyboard());
            const u = readDB(db_path.user);
            const user = u.find(x => String(x.id) === String(id));
            if (user) {
                const { text, kb } = getStartMessage(ctx, user, u.length, readDB(db_path.trx));
                try { await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: text, parse_mode: "Markdown", ...kb }); }
                catch (e) { await ctx.reply(text, { parse_mode: "Markdown", ...kb }); }
            }
            return;
        }
        await bot.telegram.sendMessage(OWNER_ID, `💬 *PESAN BANTUAN BARU*\n━━━━━━━━━━━━━━━━━━\n👤 User: ${ctx.from.first_name}\n🆔 ID: \`${id}\`\n💬 Pesan: ${txt || "[Media]"}\n━━━━━━━━━━━━━━━━━━\n\n_Tips: Balas (reply) pesan ini untuk membalas user secara instan._`, {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([[Markup.button.callback("✅ Balas Chat (Live)", `accept_chat_${id}`)]])
        });
        if (!txt) await bot.telegram.copyMessage(OWNER_ID, id, ctx.message.message_id);
        return ctx.reply("✅ Pesan diteruskan. Admin akan segera membalas di sini. Anda bisa mengirim pesan tambahan jika perlu.");
    }

    // 5. --- ADMIN STICKER SETTINGS ---
    if (st && st.step === 'adm_set_sticker_success' && ctx.message.sticker) {
        let settings = readDB(db_path.settings); settings.success_sticker = ctx.message.sticker.file_id; writeDB(db_path.settings, settings); userState.delete(id); return ctx.reply("✅ Stiker sukses diperbarui!", kbAdmin);
    }
    if (st && st.step === 'adm_set_sticker_cancel' && ctx.message.sticker) {
        let settings = readDB(db_path.settings); settings.cancel_sticker = ctx.message.sticker.file_id; writeDB(db_path.settings, settings); userState.delete(id); return ctx.reply("✅ Stiker batal diperbarui!", kbAdmin);
    }

    if (!st) return;

    // --- LOGIKA MENU LAINNYA ---
    if (st.step === 'input_voucher' && txt) {
        const code = txt.trim().toUpperCase();
        let promos = readDB(db_path.promo);
        const voucher = promos.find(p => p.code === code);

        if (!voucher) {
            userState.set(id, { ...st, step: '' });
            return ctx.reply("❌ Kode voucher tidak ditemukan. Silakan klik 'Refresh' pada menu sebelumnya.");
        }

        if (voucher.expiresAt && Date.now() > voucher.expiresAt) {
            userState.set(id, { ...st, step: '' });
            return ctx.reply("❌ Voucher ini sudah kedaluwarsa (Expired).");
        }

        if (voucher.usedBy && voucher.usedBy.includes(id)) {
            userState.set(id, { ...st, step: '' });
            return ctx.reply("❌ Voucher ini sudah Anda gunakan sebelumnya.");
        }

        // Simpan voucher ke dalam statenya sementara, belum dipakai sungguhan
        const newState = { ...st, step: '', activeVoucher: voucher };
        userState.set(id, newState);
        
        return ctx.reply(`🎉 *Voucher ${voucher.code} Berhasil Diterapkan!*\nSilakan klik tombol 🔄 *Refresh* pada pesan detail produk di atas untuk melihat harga baru.`, { parse_mode: "Markdown" });
    }

    if (st.step === 'cat' && /^\d+$/.test(txt)) {
        const s = readDB(db_path.store);
        const cats = [...new Set(s.categories)].sort();
        const catName = cats[parseInt(txt) - 1];

        if (catName) {
            const prods = s.products.filter(p => p.category === catName);
            if (prods.length === 0) return ctx.reply("Kategori kosong.");

            userState.set(id, { step: 'prod_select', prods: prods });
            let listText = `📁 KATEGORI: *${catName.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━\n\n`;
            let row = []; let rows = [];

            prods.forEach((p, i) => {
                listText += `${i + 1}. *${p.name}*\n💰 Harga: Rp ${p.price.toLocaleString()}\n📦 Stok: *${p.stocks.length}*\n\n`;
                row.push(`${i + 1}`);
                if (row.length === 5) { rows.push(row); row = []; }
            });

            if (row.length > 0) rows.push(row);
            rows.push(["🔙 Menu Utama"]);

            try {
                await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: listText, parse_mode: "Markdown", ...Markup.keyboard(rows).resize() });
            } catch (e) {
                await ctx.reply(listText, { parse_mode: "Markdown", ...Markup.keyboard(rows).resize() });
            }
        }
        return;
    }

    if (st.step === 'prod_select' && /^\d+$/.test(txt)) {
        const idx = parseInt(txt) - 1;
        if (st.prods && st.prods[idx]) {
            const p = st.prods[idx];
            userState.delete(id);
            const detail = `📦 *${p.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━\n💰 Harga: *Rp ${p.price.toLocaleString()}*\n📦 Stok: *${p.stocks.length}*\n\n📝 Deskripsi:\n${p.desc || "-"}\n━━━━━━━━━━━━━━━━━━`;
            const b = [[Markup.button.callback("1x", `qset_${p.id}_1`), Markup.button.callback("5x", `qset_${p.id}_5`)], [Markup.button.callback("10x", `qset_${p.id}_10`)], [Markup.button.callback("🔙 Kembali", "batal_belanja")]];

            try {
                await ctx.replyWithPhoto({ source: THUMBNAIL }, { caption: detail, parse_mode: "Markdown", ...Markup.inlineKeyboard(b) });
            } catch (e) {
                await ctx.reply(detail, { parse_mode: "Markdown", ...Markup.inlineKeyboard(b) });
            }
        }
        return;
    }

    // --- LOGIKA KHUSUS OWNER/ADMIN ---
    if (String(id) === OWNER_ID) {
        let s = readDB(db_path.store);

        // Pengelolaan Saldo
        if (st.step === 'adm_saldo') {
            const parts = txt.split(" ");
            const action = parts[0]?.toLowerCase();
            const targetId = parts[1];
            const amount = parseInt(parts[2]);

            if (parts.length < 3 || isNaN(amount)) return ctx.reply("❌ Format: `add/sub [ID] [NOMINAL]`");

            let users = readDB(db_path.user);
            const uIdx = users.findIndex(u => String(u.id) === String(targetId));

            if (uIdx === -1) return ctx.reply("❌ User tidak ada!");

            if (action === 'add') {
                users[uIdx].balance += amount;
                ctx.reply(`✅ +Rp ${amount.toLocaleString()} ke ${targetId}`, kbAdmin);
                bot.telegram.sendMessage(targetId, `💰 *SALDO DITAMBAHKAN*\nTotal: *Rp ${users[uIdx].balance.toLocaleString()}*`, { parse_mode: "Markdown" });
            } else if (action === 'sub') {
                users[uIdx].balance -= amount;
                ctx.reply(`✅ -Rp ${amount.toLocaleString()} dari ${targetId}`, kbAdmin);
                bot.telegram.sendMessage(targetId, `💰 *SALDO DIKURANGI*\nTotal: *Rp ${users[uIdx].balance.toLocaleString()}*`, { parse_mode: "Markdown" });
            }
            writeDB(db_path.user, users);
            return userState.delete(id);
        }

        // Tambah Kategori
        if (st.step === 'adm_cat') {
            s.categories.push(txt.trim());
            writeDB(db_path.store, s);
            ctx.reply("✅ Kategori Ditambah.", kbAdmin);
            return userState.delete(id);
        }

        // Tambah Promo Voucher (Dengan Waktu)
        if (st.step === 'adm_promo') {
            const parts = txt.trim().split("|");
            if (parts.length < 3) return ctx.reply("❌ Format salah! Harap gunakan format: KODE|DISKON|JAM_AKTIF\nContoh: DISKON50|50%|24 atau HEMAT10|10000|72");
            
            const code = parts[0].trim().toUpperCase();
            const discount = parts[1].trim().replace(/[^\d%]/g, '');
            const hours = parseInt(parts[2].trim());

            if (isNaN(hours)) return ctx.reply("❌ Jumlah Jam harus berupa angka.");

            const expiresAt = Date.now() + (hours * 3600000); // 1 jam = 3600000 ms

            let promos = readDB(db_path.promo);
            if (!promos || !Array.isArray(promos)) promos = [];
            promos.push({ code: code, discount: discount, expiresAt: expiresAt, usedBy: [] });
            writeDB(db_path.promo, promos);
            ctx.reply(`✅ Promo Voucher \`${code}\` berhasil ditambahkan!\nDiskon: ${discount}\nAktif selama: ${hours} Jam`, { parse_mode: "Markdown", ...kbAdmin });
            return userState.delete(id);
        }

        // Tambah Konfigurasi Flash Sale
        if (st.step === 'adm_fs_config') {
            const parts = txt.trim().split("|");
            if (parts.length < 3) return ctx.reply("❌ Format salah! Harap gunakan format: DISKON|KUOTA_PEMBELI|JAM_AKTIF\nContoh: 50%|10|2 atau 10000|5|24");
            
            const discount = parts[0].trim().replace(/[^\d%]/g, '');
            const maxUses = parseInt(parts[1].trim());
            const hours = parseInt(parts[2].trim());

            if (isNaN(maxUses) || isNaN(hours)) return ctx.reply("❌ Kuota dan Jam Aktif harus berupa angka.");

            const expiresAt = Date.now() + (hours * 3600000);
            
            let fsList = readDB(db_path.flashsale);
            if (!fsList || !Array.isArray(fsList)) fsList = [];
            fsList.push({ productId: st.pId, discount: discount, maxUses: maxUses, usedCount: 0, expiresAt: expiresAt });
            writeDB(db_path.flashsale, fsList);
            
            ctx.reply(`⚡ *Flash Sale Berhasil Diaktifkan!*\nProduk ID: \`${st.pId}\`\nDiskon: ${discount}\nKuota: ${maxUses} Pembeli\nAktif: ${hours} Jam`, { parse_mode: "Markdown", ...kbAdmin });
            return userState.delete(id);
        }

        // Tambah Produk
        if (st.step === 'adm_prod') {
            // Format input: Kategori|Nama|Harga|Deskripsi|Pesan_Sukses
            const [c, n, pr, d, sm] = txt.split("|");
            if (!c || !n || !pr) return ctx.reply("❌ Format: Kategori|Nama|Harga|Deskripsi|Pesan_Sukses");

            s.products.push({
                id: `P${Date.now()}`,
                category: c.trim(),
                name: n.trim(),
                price: parseInt(pr),
                desc: d || "",
                success_msg: sm || "",
                stocks: []
            });
            writeDB(db_path.store, s);
            ctx.reply(`✅ Produk ${n} berhasil ditambah!`, kbAdmin);
            return userState.delete(id);
        }

        // --- FIX: INPUT STOK (KONSOLIDASI) ---
        if (st.step === 'adm_stok_bulk') {
            const pIdx = s.products.findIndex(x => x.id === st.pId);
            if (pIdx === -1) return ctx.reply("❌ Produk hilang dari database!");

            const lines = txt.split("\n").filter(l => l.trim().length > 0);

            lines.forEach(l => {
                const pData = l.split("|");
                s.products[pIdx].stocks.push({
                    email: pData[0] || l,
                    pw: pData[1] || "",
                    pin: pData[2] || "",
                    a2f: pData[3] || "",
                    profile: pData[4] || "",
                    isLink: !pData[1] // Jika tidak ada password, dianggap link/teks biasa
                });
            });

            writeDB(db_path.store, s);
            ctx.reply(`✅ Berhasil menambahkan ${lines.length} stok.`, kbAdmin);
            return userState.delete(id);
        }

        if (st.step === 'adm_bc') {
            const users = readDB(db_path.user); let successCount = 0;
            ctx.reply(`🚀 Broadcasting...`);
            for (let u of users) { try { await bot.telegram.copyMessage(u.id, id, ctx.message.message_id); successCount++; } catch (e) { } }
            ctx.reply(`✅ Selesai: *${successCount}* user.`, { parse_mode: "Markdown", ...kbAdmin }); return userState.delete(id);
        }

        // --- PROSES HAPUS DATA ---
        if (st.step === 'adm_del_cat') {
            const catName = txt.trim();
            const idx = s.categories.indexOf(catName);
            if (idx !== -1) {
                s.categories.splice(idx, 1);
                writeDB(db_path.store, s);
                ctx.reply(`✅ Kategori \`${catName}\` berhasil dihapus.`, { parse_mode: "Markdown", ...kbDeleteMenu });
            } else ctx.reply("❌ Kategori tidak ditemukan. Pastikan nama sama persis.");
            return userState.delete(id);
        }
    }
});

// Start loop
async function start() {
    console.clear();
    console.log(chalk.blue(figlet.textSync('BOT LAGI GAWE', { font: 'Standard' })));
    setInterval(paymentLoop, 30000);
    bot.launch()
        .then(() => log.success(`Bot Running as ${bot.botInfo?.username}`))
        .catch(e => log.error("Bot launch failed", e));
}

start();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));