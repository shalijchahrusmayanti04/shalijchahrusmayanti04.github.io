(function () {
  "use strict";

  const G = window.RentalGuard;
  let CONFIG = null;
  let CARS = [];
  let SETTINGS = {
    nama_rental: "Restu Bumi",
    alamat_garasi: "-",
    no_wa_admin: "",
    persen_denda_per_jam: 10,
    toleransi_menit: 30,
    biaya_antar_default: 50000,
    biaya_sopir_per_hari: 150000
  };
  let SELECTED_CAR = null;

  const el = id => document.getElementById(id);

  function init() {
    G.initTheme();

    const unlocked = G.unlockConfig();
    if (!unlocked.ok) {
      el("lockScreen").classList.remove("hidden");
      el("lockMessage").textContent = unlocked.message;
      return;
    }

    CONFIG = unlocked.config;
    el("mainContent").classList.remove("hidden");

    bindEvents();
    loadCatalog();
  }

  function bindEvents() {
    el("searchInput").addEventListener("input", renderCars);
    el("filterTransmisi").addEventListener("change", renderCars);
    el("filterStatus").addEventListener("change", renderCars);

    el("closeBookingModal").addEventListener("click", closeModal);
    el("cancelBookingBtn").addEventListener("click", closeModal);

    ["bookStart", "bookEnd", "bookDelivery", "bookDriver"].forEach(id => {
      el(id).addEventListener("change", updateBookingSummary);
    });

    el("bookDelivery").addEventListener("change", () => {
      const isDiantar = el("bookDelivery").value === "Diantar";
      el("bookDeliveryAddrWrap").classList.toggle("hidden", !isDiantar);
      el("bookDeliveryAddr").required = isDiantar;
      updateBookingSummary();
    });

    el("bookingForm").addEventListener("submit", handleBookingSubmit);
  }

  async function loadCatalog() {
    if (!CONFIG.gasUrl || CONFIG.gasUrl.indexOf("PASTE_URL") !== -1) {
      el("publicAlert").classList.remove("hidden");
      el("publicAlert").innerHTML =
        "<strong>Mode Belum Terhubung:</strong> URL Google Apps Script belum dipasang di <code>assets/js/config.enc.js</code>.";
      el("carGrid").innerHTML = '<div class="panel-card">Belum ada data mobil (Google Sheets belum dihubungkan).</div>';
      return;
    }

    try {
      const res = await G.apiCall(CONFIG, "public_catalog", {});
      if (!res.ok) throw new Error(res.error || "Gagal memuat katalog.");
      CARS = res.cars || [];
      SETTINGS = Object.assign(SETTINGS, res.settings || {});
      applySettingsUI();
      renderCars();
    } catch (err) {
      el("publicAlert").classList.remove("hidden");
      el("publicAlert").textContent = "Error: " + err.message;
      el("carGrid").innerHTML = '<div class="panel-card text-danger">Gagal memuat data dari Google Sheets.</div>';
    }
  }

  function applySettingsUI() {
    document.title = SETTINGS.nama_rental + " - Katalog Sewa Mobil";
    el("navRentalName").textContent = SETTINGS.nama_rental;
    el("heroTitle").textContent = SETTINGS.nama_rental + " • Rental Mobil Siap Jalan";
    el("pillGarage").textContent = "Garasi: " + (SETTINGS.alamat_garasi || "-");
    el("pillDelivery").textContent =
      "Antar ke Lokasi: +" + G.formatRupiah(SETTINGS.biaya_antar_default);
    el("pillPenalty").textContent =
      "Denda Overtime: " + SETTINGS.persen_denda_per_jam + "%/jam (Toleransi " + SETTINGS.toleransi_menit + " mnt)";

    if (SETTINGS.no_wa_admin) {
      const waUrl = G.buildWhatsAppUrl(SETTINGS.no_wa_admin, "Halo Admin " + SETTINGS.nama_rental + ", saya ingin bertanya tentang sewa mobil.");
      const waBtn = el("navWaBtn");
      waBtn.href = waUrl;
      waBtn.classList.remove("hidden");
    }

    const delivSel = el("bookDelivery");
    delivSel.options[0].textContent = "Ambil Sendiri di Garasi (" + (SETTINGS.alamat_garasi || "Gratis") + ")";
    delivSel.options[1].textContent = "Diantar ke Lokasi Saya (+" + G.formatRupiah(SETTINGS.biaya_antar_default) + ")";

    const drvSel = el("bookDriver");
    drvSel.options[1].textContent = "Dengan Sopir (+" + G.formatRupiah(SETTINGS.biaya_sopir_per_hari) + "/hari)";
  }

  function renderCars() {
    const q = el("searchInput").value.trim().toLowerCase();
    const trans = el("filterTransmisi").value;
    const status = el("filterStatus").value;

    const filtered = CARS.filter(c => {
      const textMatch = !q || (c.nama_mobil + " " + c.merk + " " + c.tahun + " " + c.deskripsi).toLowerCase().includes(q);
      const transMatch = trans === "ALL" || c.transmisi === trans;
      const statusMatch = status === "ALL" || c.status === status;
      return textMatch && transMatch && statusMatch;
    });

    if (filtered.length === 0) {
      el("carGrid").innerHTML = '<div class="panel-card">Tidak ada unit mobil yang cocok dengan filter Anda.</div>';
      return;
    }

    el("carGrid").innerHTML = filtered.map(c => {
      const badgeCls = c.status === "Tersedia" ? "badge-success" : (c.status === "Disewa" ? "badge-warning" : "badge-danger");
      const disabled = c.status !== "Tersedia";
      return `
        <article class="car-card">
          <div class="car-media">
            ${G.renderCarImage(c.foto_url, c.nama_mobil, "car-img")}
            <span class="badge ${badgeCls} car-badge-float">${G.escapeHtml(c.status)}</span>
          </div>
          <div class="car-body">
            <div>
              <div class="car-title">${G.escapeHtml(c.nama_mobil)}</div>
              <div class="small text-muted">${G.escapeHtml(c.merk || "")} ${c.tahun ? "• " + G.escapeHtml(c.tahun) : ""}</div>
            </div>
            <div class="car-specs">
              <span class="car-spec-item">${G.escapeHtml(c.transmisi || "Matic")}</span>
              <span class="car-spec-item">${G.escapeHtml(c.kapasitas || 5)} Kursi</span>
              <span class="car-spec-item">${G.escapeHtml(c.plat_nomor || "-")}</span>
            </div>
            ${c.deskripsi ? `<p class="small text-muted">${G.escapeHtml(c.deskripsi)}</p>` : ""}
            <div class="car-price-row">
              <div>
                <div class="price-main">${G.formatRupiah(c.harga_24jam)}<span class="small text-muted"> /hari</span></div>
                ${Number(c.harga_12jam) > 0 ? `<div class="price-sub">12 Jam: ${G.formatRupiah(c.harga_12jam)}</div>` : ""}
              </div>
              <button type="button" class="btn ${disabled ? "btn-ghost" : "btn-primary"} btn-sm"
                ${disabled ? "disabled" : ""} onclick="window.__openBookModal('${G.escapeHtml(c.id_mobil)}')">
                ${disabled ? G.escapeHtml(c.status) : "Pesan Sekarang"}
              </button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  window.__openBookModal = function (idMobil) {
    SELECTED_CAR = CARS.find(c => c.id_mobil === idMobil);
    if (!SELECTED_CAR) return;

    el("bookCarId").value = SELECTED_CAR.id_mobil;
    el("modalCarTitle").textContent = "Pesan " + SELECTED_CAR.nama_mobil;
    el("modalCarMeta").textContent =
      SELECTED_CAR.transmisi + " • " + SELECTED_CAR.kapasitas + " Kursi • " + G.formatRupiah(SELECTED_CAR.harga_24jam) + "/hari";

    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    el("bookStart").value = G.toLocalInputValue(now);
    el("bookEnd").value = G.toLocalInputValue(tomorrow);
    el("bookDelivery").value = "Ambil Sendiri";
    el("bookDeliveryAddrWrap").classList.add("hidden");
    el("bookDeliveryAddr").required = false;
    el("bookDriver").value = "Lepas Kunci";

    updateBookingSummary();
    el("bookingModal").classList.add("open");
  };

  function closeModal() {
    el("bookingModal").classList.remove("open");
  }

  function updateBookingSummary() {
    if (!SELECTED_CAR) return;
    const start = new Date(el("bookStart").value);
    const end = new Date(el("bookEnd").value);
    let days = 1;
    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
      const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      days = Math.max(1, Math.ceil(diffHours / 24));
    }

    const base = days * (Number(SELECTED_CAR.harga_24jam) || 0);
    const driver = el("bookDriver").value === "Dengan Sopir" ? days * (Number(SETTINGS.biaya_sopir_per_hari) || 0) : 0;
    const delivery = el("bookDelivery").value === "Diantar" ? (Number(SETTINGS.biaya_antar_default) || 0) : 0;
    const total = base + driver + delivery;

    el("sumDays").textContent = days + " Hari";
    el("sumBase").textContent = G.formatRupiah(base);
    el("sumDriver").textContent = G.formatRupiah(driver);
    el("sumDelivery").textContent = G.formatRupiah(delivery);
    el("sumTotal").textContent = G.formatRupiah(total);

    const dendaPerJam = Math.round(((Number(SETTINGS.persen_denda_per_jam) || 10) / 100) * (Number(SELECTED_CAR.harga_24jam) || 0));
    el("sumOvertimeNote").textContent =
      "Catatan: Keterlambatan pengembalian melebihi toleransi " + SETTINGS.toleransi_menit +
      " menit dikenakan denda " + SETTINGS.persen_denda_per_jam + "%/jam (" + G.formatRupiah(dendaPerJam) + "/jam).";
  }

  async function handleBookingSubmit(e) {
    e.preventDefault();
    if (!SELECTED_CAR) return;

    const btn = el("submitBookingBtn");
    btn.disabled = true;
    G.uiLoading("Menyimpan data pemesanan Anda ke sistem...", "Mengirim Booking");

    const payload = {
      id_mobil: SELECTED_CAR.id_mobil,
      nama_pelanggan: el("bookName").value.trim(),
      no_wa: el("bookWa").value.trim(),
      nik_sim: el("bookNik").value.trim(),
      tgl_jam_mulai: el("bookStart").value,
      tgl_jam_selesai: el("bookEnd").value,
      metode_ambil: el("bookDelivery").value,
      alamat_antar: el("bookDelivery").value === "Diantar" ? el("bookDeliveryAddr").value.trim() : "-",
      layanan_sopir: el("bookDriver").value,
      alamat_pelanggan: el("bookNotes").value.trim(),
      catatan: el("bookNotes").value.trim()
    };

    try {
      const res = await G.apiCall(CONFIG, "public_booking", { data: payload });
      G.uiClose();
      if (!res.ok) throw new Error(res.error || "Gagal menyimpan booking.");

      const msg =
        "Halo Admin *" + SETTINGS.nama_rental + "*,\n" +
        "Saya ingin konfirmasi pemesanan mobil:\n\n" +
        "• Kode Booking: *" + res.id_transaksi + "*\n" +
        "• Mobil: *" + SELECTED_CAR.nama_mobil + "* (" + SELECTED_CAR.plat_nomor + ")\n" +
        "• Nama: " + payload.nama_pelanggan + "\n" +
        "• Mulai: " + G.formatDateTime(payload.tgl_jam_mulai) + "\n" +
        "• Selesai: " + G.formatDateTime(payload.tgl_jam_selesai) + " (" + res.durasi_hari + " hari)\n" +
        "• Layanan: " + payload.layanan_sopir + "\n" +
        "• Pengambilan: " + payload.metode_ambil + (payload.metode_ambil === "Diantar" ? " ke " + payload.alamat_antar : "") + "\n" +
        "• Total Estimasi: *" + G.formatRupiah(res.total_akhir) + "*\n\n" +
        "Mohon info ketersediaan & instruksi pembayarannya. Terima kasih!";

      closeModal();
      el("bookingForm").reset();
      await G.uiAlert(
        "Booking Berhasil!",
        "Kode Booking Anda: " + res.id_transaksi + "\nKlik OK untuk melanjutkan konfirmasi ke WhatsApp Admin.",
        "success"
      );

      if (SETTINGS.no_wa_admin) {
        window.open(G.buildWhatsAppUrl(SETTINGS.no_wa_admin, msg), "_blank");
      }
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Booking Gagal", err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
