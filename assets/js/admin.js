(function () {
  "use strict";

  const G = window.RentalGuard;
  const TOKEN_KEY = "rm_admin_token_v1";
  const DEFAULT_DRIVE_FOLDER = "https://drive.google.com/drive/folders/1vDgNQXMj9WatFSJPlbDDmkybk-euko7u?usp=sharing";

  let CONFIG = null;
  let TOKEN = sessionStorage.getItem(TOKEN_KEY) || "";
  let DATA = { cars: [], transactions: [], customers: [], settings: {} };
  let MONITOR_TIMER = null;
  let IS_UPLOADING_PHOTO = false;
  let CAR_PHOTO_UPLOAD_ERROR = false;

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
    G.bindRupiahInputs();
    bindGlobalEvents();

    if (TOKEN) {
      loadDashboard();
    } else {
      el("loginScreen").classList.remove("hidden");
    }
  }

  function bindGlobalEvents() {
    el("loginForm").addEventListener("submit", handleLogin);
    el("logoutBtn").addEventListener("click", logout);
    el("refreshDataBtn").addEventListener("click", () => loadDashboard(false));

    document.querySelectorAll(".dock-item[data-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".dock-item[data-tab]").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
        btn.classList.add("active");
        el(btn.dataset.tab).classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    el("trxStatusFilter").addEventListener("change", renderTransactions);
    el("custSearch").addEventListener("input", renderCustomers);
    el("reportMonth").addEventListener("change", renderReport);
    el("exportCsvBtn").addEventListener("click", exportReportCsv);

    // Car Form & Google Drive preview
        el("carTakePhotoBtn").addEventListener("click", () => el("carCameraInput").click());
    el("carPickGalleryBtn").addEventListener("click", () => el("carGalleryInput").click());
    el("carCameraInput").addEventListener("change", e => handlePhotoUpload(e.target.files[0], "car"));
    el("carGalleryInput").addEventListener("change", e => handlePhotoUpload(e.target.files[0], "car"));

    el("ciTakePhotoBtn").addEventListener("click", () => el("ciCameraInput").click());
    el("ciPickGalleryBtn").addEventListener("click", () => el("ciGalleryInput").click());
    el("ciCameraInput").addEventListener("change", e => handlePhotoUpload(e.target.files[0], "ci"));
    el("ciGalleryInput").addEventListener("change", e => handlePhotoUpload(e.target.files[0], "ci"));

    el("setFolderDrive").addEventListener("input", () => {
      el("openDriveFolderLink").href = el("setFolderDrive").value.trim() || DEFAULT_DRIVE_FOLDER;
    });
    el("carForm").addEventListener("submit", handleSaveCar);

    // New Transaction Form
    ["trxCarId", "trxStart", "trxEnd", "trxDeliveryMethod", "trxDeliveryFee", "trxDriverMethod", "trxDriverFee"].forEach(id => {
      el(id).addEventListener("change", updateNewTrxSummary);
      el(id).addEventListener("input", updateNewTrxSummary);
    });
    el("trxDeliveryMethod").addEventListener("change", () => {
      const isDiantar = el("trxDeliveryMethod").value === "Diantar";
      el("trxDeliveryAddrWrap").classList.toggle("hidden", !isDiantar);
      if (isDiantar && G.parseRupiah(el("trxDeliveryFee").value) === 0) {
        G.setRupiahInput(el("trxDeliveryFee"), Number(DATA.settings.biaya_antar_default) || 50000);
      } else if (!isDiantar) {
        G.setRupiahInput(el("trxDeliveryFee"), 0);
      }
      updateNewTrxSummary();
    });
    el("trxDriverMethod").addEventListener("change", () => {
      updateDriverFeeDefault();
      updateNewTrxSummary();
    });
    el("newTrxForm").addEventListener("submit", handleCreateTransaction);

    // Check-In Form
    ["ciReturnTime", "ciDendaOverride", "ciExtraFee", "ciPayNow"].forEach(id => {
      el(id).addEventListener("input", updateCheckinPreview);
      el(id).addEventListener("change", updateCheckinPreview);
    });
    el("checkinForm").addEventListener("submit", handleCheckinSubmit);

    // Customer & Settings Forms
    el("custForm").addEventListener("submit", handleSaveCustomer);
    el("settingsForm").addEventListener("submit", handleSaveSettings);
  }

  window.__closeModal = function (id) {
    el(id).classList.remove("open");
  };

  async function adminApi(action, payload) {
    const res = await G.apiCall(CONFIG, action, Object.assign({ token: TOKEN }, payload || {}));
    if (res && res.unauthorized) {
      logout();
      throw new Error(res.error || "Sesi admin berakhir.");
    }
    return res;
  }

  async function handleLogin(e) {
    e.preventDefault();
    const btn = el("loginSubmitBtn");
    el("loginAlert").classList.add("hidden");
    btn.disabled = true;
    G.uiLoading("Memverifikasi PIN Admin...", "Login Restu Bumi");
    try {
      const res = await G.apiCall(CONFIG, "admin_login", { pin: el("loginPin").value });
      if (!res.ok) throw new Error(res.error || "Login gagal.");
      TOKEN = res.token;
      sessionStorage.setItem(TOKEN_KEY, TOKEN);
      el("loginScreen").classList.add("hidden");
      await loadDashboard(true);
      G.uiClose();
    } catch (err) {
      G.uiClose();
      el("loginAlert").textContent = err.message;
      el("loginAlert").classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "Masuk Panel Admin";
    }
  }

  function logout() {
    TOKEN = "";
    sessionStorage.removeItem(TOKEN_KEY);
    if (MONITOR_TIMER) clearInterval(MONITOR_TIMER);
    el("adminContent").classList.add("hidden");
    el("logoutBtn").classList.add("hidden");
    el("adminDockNav").classList.add("hidden");
    el("refreshDataBtn").classList.add("hidden");
    el("loginScreen").classList.remove("hidden");
  }

  async function loadDashboard(silent) {
    if (!silent) G.uiLoading("Mengambil data terbaru dari Google Sheets...", "Memuat Dashboard");
    try {
      const res = await adminApi("dashboard_data", {});
      if (!res.ok) throw new Error(res.error || "Gagal memuat dashboard.");

      DATA.cars = res.cars || [];
      DATA.transactions = res.transactions || [];
      DATA.customers = res.customers || [];
      DATA.settings = res.settings || {};

      el("adminContent").classList.remove("hidden");
      el("logoutBtn").classList.remove("hidden");
      el("adminDockNav").classList.remove("hidden");
      el("refreshDataBtn").classList.remove("hidden");
      el("adminBrandName").textContent = "Admin • " + (DATA.settings.nama_rental || "Restu Bumi");

      if (!el("reportMonth").value) {
        const now = new Date();
        el("reportMonth").value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
      }

      G.uiClose();
      renderAll();

      if (MONITOR_TIMER) clearInterval(MONITOR_TIMER);
      MONITOR_TIMER = setInterval(() => {
        renderMonitor();
        renderKpis();
      }, 30000);
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Memuat Data", err.message, "error");
    }
  }

  function renderAll() {
    renderKpis();
    renderMonitor();
    renderTransactions();
    renderCars();
    renderCustomers();
    renderReport();
    fillSettingsForm();
  }

  function getPenaltyRules() {
    return {
      persen: Number(DATA.settings.persen_denda_per_jam) || 10,
      toleransi: Number(DATA.settings.toleransi_menit) || 30,
      ambang: Number(DATA.settings.ambang_pengingat_menit) || 120
    };
  }

  function renderKpis() {
    const rules = getPenaltyRules();
    const tersedia = DATA.cars.filter(c => c.status === "Tersedia").length;
    const disewa = DATA.cars.filter(c => c.status === "Disewa").length;
    const activeTrx = DATA.transactions.filter(t => t.status_sewa === "Berjalan");
    const pendingTrx = DATA.transactions.filter(t => t.status_sewa === "Pending").length;

    let dueOrOverdue = 0;
    activeTrx.forEach(t => {
      const ov = G.calculateOvertime(t.tgl_jam_selesai, null, t.harga_harian_deal, rules.persen, rules.toleransi);
      if (ov.isOverdue || ov.sisaMenit <= rules.ambang) dueOrOverdue++;
    });

    const omset = DATA.transactions
      .filter(t => t.status_sewa !== "Dibatalkan")
      .reduce((acc, t) => acc + (Number(t.dp_bayar) || 0), 0);

    el("kpiTersedia").textContent = tersedia;
    el("kpiDisewa").textContent = disewa;
    el("kpiOverdue").textContent = dueOrOverdue;
    el("kpiPending").textContent = pendingTrx;
    el("kpiOmset").textContent = G.formatRupiah(omset);
    const bMon = el("dockBadgeMonitor");
    if (bMon) {
      bMon.textContent = dueOrOverdue;
      bMon.classList.toggle("hidden", dueOrOverdue === 0);
    }
    const bPen = el("dockBadgePending");
    if (bPen) {
      bPen.textContent = pendingTrx;
      bPen.classList.toggle("hidden", pendingTrx === 0);
    }
    el("monitorRuleInfo").textContent =
      "Aturan denda aktif: " + rules.persen + "%/jam dari harga harian setelah toleransi " +
      rules.toleransi + " menit • Peringatan H-" + rules.ambang + " menit.";
  }

  // ============================================================================
  // TAB 1: MONITOR JATUH TEMPO & PERINGATAN WHATSAPP
  // ============================================================================
  function renderMonitor() {
    const rules = getPenaltyRules();
    const active = DATA.transactions.filter(t => t.status_sewa === "Berjalan");

    if (active.length === 0) {
      el("dueMonitorList").innerHTML = '<div class="text-muted">Tidak ada sewa aktif saat ini.</div>';
      return;
    }

    const enriched = active.map(t => {
      const ov = G.calculateOvertime(t.tgl_jam_selesai, null, t.harga_harian_deal, rules.persen, rules.toleransi);
      return { trx: t, ov: ov };
    }).sort((a, b) => b.ov.selisihMenit - a.ov.selisihMenit);

    el("dueMonitorList").innerHTML = enriched.map(({ trx, ov }) => {
      let itemCls = "due-item";
      let statusBadge = '<span class="badge badge-success">Aktif • ' + G.escapeHtml(ov.label) + "</span>";
      if (ov.isOverdue && !ov.inTolerance) {
        itemCls += " overdue";
        statusBadge = '<span class="badge badge-danger">TERLAMBAT • ' + G.escapeHtml(ov.label) + "</span>";
      } else if (ov.isOverdue && ov.inTolerance) {
        itemCls += " due-soon";
        statusBadge = '<span class="badge badge-warning">' + G.escapeHtml(ov.label) + "</span>";
      } else if (ov.sisaMenit <= rules.ambang) {
        itemCls += " due-soon";
        statusBadge = '<span class="badge badge-warning">SEGERA JATUH TEMPO • ' + G.escapeHtml(ov.label) + "</span>";
      }

      const dendaText = ov.denda > 0
        ? `<div class="text-danger small" style="font-weight:700;margin-top:4px;">Estimasi Denda Berjalan: ${G.formatRupiah(ov.denda)} (${ov.jamTelat} jam × ${rules.persen}%)</div>`
        : "";

      const remindedText = trx.terakhir_diingatkan
        ? `<div class="small text-muted">Terakhir diingatkan WA: ${G.formatDateTime(trx.terakhir_diingatkan)}</div>`
        : "";

      return `
        <div class="${itemCls}">
          <div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
              <strong>${G.escapeHtml(trx.nama_mobil)} (${G.escapeHtml(trx.plat_nomor)})</strong>
              ${statusBadge}
            </div>
            <div class="small">
              Penyewa: <strong>${G.escapeHtml(trx.nama_pelanggan)}</strong> (${G.escapeHtml(trx.no_wa)}) •
              Metode: <strong>${G.escapeHtml(trx.metode_ambil)}</strong>
            </div>
            <div class="small text-muted">
              Batas Kembali: <strong>${G.formatDateTime(trx.tgl_jam_selesai)}</strong> •
              Sisa Tagihan Awal: ${G.formatRupiah(trx.sisa_bayar)}
            </div>
            ${dendaText}
            ${remindedText}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button type="button" class="btn btn-wa btn-sm" onclick="window.__sendWaReminder('${G.escapeHtml(trx.id_transaksi)}')">
              Kirim WA Peringatan
            </button>
            <button type="button" class="btn btn-success btn-sm" onclick="window.__openCheckinModal('${G.escapeHtml(trx.id_transaksi)}')">
              Proses Kembali
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  window.__sendWaReminder = async function (idTrx) {
    const trx = DATA.transactions.find(t => t.id_transaksi === idTrx);
    if (!trx) return;
    const rules = getPenaltyRules();
    const ov = G.calculateOvertime(trx.tgl_jam_selesai, null, trx.harga_harian_deal, rules.persen, rules.toleransi);
    const rentalName = DATA.settings.nama_rental || "Restu Bumi";

    let msg = "";
    if (ov.isOverdue && !ov.inTolerance) {
      msg =
        "Halo Kak *" + trx.nama_pelanggan + "*,\n" +
        "Kami dari *" + rentalName + "* menginformasikan bahwa masa sewa mobil *" + trx.nama_mobil + "* (" + trx.plat_nomor + ") " +
        "telah melewati batas waktu pengembalian.\n\n" +
        "• Jadwal Kembali: " + G.formatDateTime(trx.tgl_jam_selesai) + "\n" +
        "• Status: *" + ov.label + "*\n" +
        "• Estimasi Denda Saat Ini: *" + G.formatRupiah(ov.denda) + "* (" + rules.persen + "%/jam)\n\n" +
        "Mohon segera konfirmasi apakah ingin perpanjang sewa atau dalam perjalanan pengembalian. Terima kasih.";
    } else {
      const dendaPerJam = Math.round((rules.persen / 100) * (Number(trx.harga_harian_deal) || 0));
      msg =
        "Halo Kak *" + trx.nama_pelanggan + "*,\n" +
        "Pengingat dari *" + rentalName + "* bahwa masa sewa mobil *" + trx.nama_mobil + "* (" + trx.plat_nomor + ") " +
        "akan segera berakhir (" + ov.label + ").\n\n" +
        "• Batas Waktu Pengembalian: *" + G.formatDateTime(trx.tgl_jam_selesai) + "*\n" +
        "• Lokasi Garasi: " + (DATA.settings.alamat_garasi || "-") + "\n" +
        "• Info: Keterlambatan melewati toleransi " + rules.toleransi + " menit dikenakan denda " +
        rules.persen + "%/jam (" + G.formatRupiah(dendaPerJam) + "/jam).\n\n" +
        "Jika ada rencana perpanjang sewa, mohon kabari kami sebelumnya ya Kak. Terima kasih!";
    }

    window.open(G.buildWhatsAppUrl(trx.no_wa, msg), "_blank");

    try {
      const res = await adminApi("mark_wa_reminded", { id_transaksi: idTrx });
      if (res.ok) {
        trx.terakhir_diingatkan = res.terakhir_diingatkan;
        renderMonitor();
      }
    } catch (_) {}
  };

  // ============================================================================
  // TAB 2: TRANSAKSI & PENGEMBALIAN
  // ============================================================================
  function renderTransactions() {
    const filter = el("trxStatusFilter").value;
    const list = DATA.transactions.filter(t => filter === "ALL" || t.status_sewa === filter);
    const rules = getPenaltyRules();

    if (list.length === 0) {
      el("trxTableBody").innerHTML = '<tr><td colspan="7" class="text-muted">Belum ada transaksi.</td></tr>';
      return;
    }

    el("trxTableBody").innerHTML = list.map(t => {
      const stCls =
        t.status_sewa === "Selesai" ? "badge-success" :
        t.status_sewa === "Berjalan" ? "badge-info" :
        t.status_sewa === "Pending" ? "badge-warning" : "badge-danger";
      const payCls =
        t.status_bayar === "Lunas" ? "badge-success" :
        t.status_bayar === "DP" ? "badge-warning" : "badge-danger";

      let liveOvHtml = "";
      if (t.status_sewa === "Berjalan") {
        const ov = G.calculateOvertime(t.tgl_jam_selesai, null, t.harga_harian_deal, rules.persen, rules.toleransi);
        if (ov.denda > 0) {
          liveOvHtml = `<div class="small text-danger">Denda berjalan: ${G.formatRupiah(ov.denda)}</div>`;
        }
      } else if (Number(t.denda_keterlambatan) > 0) {
        liveOvHtml = `<div class="small text-danger">Denda: ${G.formatRupiah(t.denda_keterlambatan)} (${t.jam_telat} jam)</div>`;
      }

      const actions = [];
      if (t.status_sewa === "Pending") {
        actions.push(`<button class="btn btn-primary btn-sm" onclick="window.__confirmBooking('${G.escapeHtml(t.id_transaksi)}')">Konfirmasi</button>`);
        actions.push(`<button class="btn btn-danger btn-sm" onclick="window.__cancelTrx('${G.escapeHtml(t.id_transaksi)}')">Batalkan</button>`);
      } else if (t.status_sewa === "Berjalan") {
        actions.push(`<button class="btn btn-success btn-sm" onclick="window.__openCheckinModal('${G.escapeHtml(t.id_transaksi)}')">Pengembalian</button>`);
        actions.push(`<button class="btn btn-wa btn-sm" onclick="window.__sendWaReminder('${G.escapeHtml(t.id_transaksi)}')">WA</button>`);
      }
      if (t.status_bayar !== "Lunas" && t.status_sewa !== "Dibatalkan") {
        actions.push(`<button class="btn btn-warning btn-sm" onclick="window.__markPaid('${G.escapeHtml(t.id_transaksi)}')">Lunasi</button>`);
      }
      actions.push(`<button class="btn btn-ghost btn-sm" onclick="window.__openInvoice('${G.escapeHtml(t.id_transaksi)}')">Struk</button>`);

      return `
        <tr>
          <td data-label="Kode & Tanggal">
            <strong>${G.escapeHtml(t.id_transaksi)}</strong>
            <div class="small text-muted">Mulai: ${G.formatDateTime(t.tgl_jam_mulai)}</div>
            <div class="small text-muted">Tempo: ${G.formatDateTime(t.tgl_jam_selesai)}</div>
          </td>
          <td data-label="Mobil">
            <strong>${G.escapeHtml(t.nama_mobil)}</strong>
            <div class="small text-muted">${G.escapeHtml(t.plat_nomor)} • ${G.escapeHtml(t.durasi_hari)} hari</div>
          </td>
          <td data-label="Pelanggan">
            <strong>${G.escapeHtml(t.nama_pelanggan)}</strong>
            <div class="small text-muted">${G.escapeHtml(t.no_wa)}</div>
            <div class="small text-muted">${G.escapeHtml(t.layanan_sopir)}</div>
          </td>
          <td data-label="Ambil / Antar">
            <span class="badge ${t.metode_ambil === "Diantar" ? "badge-info" : "badge-muted"}">${G.escapeHtml(t.metode_ambil)}</span>
            ${Number(t.biaya_antar) > 0 ? `<div class="small text-muted">+${G.formatRupiah(t.biaya_antar)}</div>` : ""}
            ${t.metode_ambil === "Diantar" ? `<div class="small text-muted">${G.escapeHtml(t.alamat_antar)}</div>` : ""}
          </td>
          <td data-label="Total & Denda">
            <strong>${G.formatRupiah(t.total_akhir)}</strong>
            ${liveOvHtml}
            <div class="small text-muted">Sisa: ${G.formatRupiah(t.sisa_bayar)}</div>
          </td>
          <td data-label="Status">
            <div><span class="badge ${stCls}">${G.escapeHtml(t.status_sewa)}</span></div>
            <div style="margin-top:4px;"><span class="badge ${payCls}">${G.escapeHtml(t.status_bayar)}</span></div>
          </td>
          <td data-label="Aksi">
            <div style="display:flex;gap:5px;flex-wrap:wrap;width:100%;">${actions.join("")}</div>
          </td>
        </tr>
      `;
    }).join("");
  }

  window.__openNewTrxModal = function () {
    const sel = el("trxCarId");
    const availCars = DATA.cars.filter(c => c.status === "Tersedia");
    const list = availCars.length > 0 ? availCars : DATA.cars;

    sel.innerHTML = list.map(c =>
      `<option value="${G.escapeHtml(c.id_mobil)}" data-rate="${c.harga_24jam}">` +
      `${G.escapeHtml(c.nama_mobil)} (${G.escapeHtml(c.plat_nomor)}) - ${G.formatRupiah(c.harga_24jam)}/hari [${G.escapeHtml(c.status)}]` +
      `</option>`
    ).join("");

    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    el("trxStart").value = G.toLocalInputValue(now);
    el("trxEnd").value = G.toLocalInputValue(tomorrow);
    el("trxDeliveryMethod").value = "Ambil Sendiri";
    G.setRupiahInput(el("trxDeliveryFee"), 0);
    el("trxDeliveryAddrWrap").classList.add("hidden");
    el("trxDriverMethod").value = "Lepas Kunci";
    G.setRupiahInput(el("trxDriverFee"), 0);
    G.setRupiahInput(el("trxDp"), 0);
    el("trxKmAwal").value = 0;

    updateNewTrxSummary();
    el("newTrxModal").classList.add("open");
  };

  function getTrxDays() {
    const s = new Date(el("trxStart").value);
    const e = new Date(el("trxEnd").value);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return 1;
    return Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
  }

  function updateDriverFeeDefault() {
    if (el("trxDriverMethod").value === "Dengan Sopir") {
      G.setRupiahInput(el("trxDriverFee"), getTrxDays() * (Number(DATA.settings.biaya_sopir_per_hari) || 150000));
    } else {
      G.setRupiahInput(el("trxDriverFee"), 0);
    }
  }

  function updateNewTrxSummary() {
    const days = getTrxDays();
    const opt = el("trxCarId").selectedOptions[0];
    const rate = opt ? Number(opt.dataset.rate || 0) : 0;
    const base = days * rate;
    const deliv = el("trxDeliveryMethod").value === "Diantar" ? G.parseRupiah(el("trxDeliveryFee").value) : 0;
    const drv = el("trxDriverMethod").value === "Dengan Sopir" ? G.parseRupiah(el("trxDriverFee").value) : 0;

    el("trxSumDays").textContent = days + " Hari";
    el("trxSumBase").textContent = G.formatRupiah(base);
    el("trxSumDeliv").textContent = G.formatRupiah(deliv);
    el("trxSumDrv").textContent = G.formatRupiah(drv);
    el("trxSumTotal").textContent = G.formatRupiah(base + deliv + drv);
  }

  async function handleCreateTransaction(e) {
    e.preventDefault();
    const btn = el("saveNewTrxBtn");
    btn.disabled = true;
    G.uiLoading("Menyimpan data mobil ke Google Sheets...", "Menyimpan Mobil");
    try {
      const res = await adminApi("create_transaction", {
        data: {
          id_mobil: el("trxCarId").value,
          nama_pelanggan: el("trxName").value.trim(),
          no_wa: el("trxWa").value.trim(),
          nik_sim: el("trxNik").value.trim(),
          alamat_pelanggan: el("trxAddr").value.trim(),
          tgl_jam_mulai: el("trxStart").value,
          tgl_jam_selesai: el("trxEnd").value,
          durasi_hari: getTrxDays(),
          metode_ambil: el("trxDeliveryMethod").value,
          biaya_antar: G.parseRupiah(el("trxDeliveryFee").value),
          alamat_antar: el("trxDeliveryAddr").value.trim(),
          layanan_sopir: el("trxDriverMethod").value,
          biaya_sopir: G.parseRupiah(el("trxDriverFee").value),
          km_awal: Number(el("trxKmAwal").value) || 0,
          dp_bayar: G.parseRupiah(el("trxDp").value)
        }
      });
      if (!res.ok) throw new Error(res.error);
      window.__closeModal("newTrxModal");
      el("newTrxForm").reset();
      G.uiLoading("Memperbarui daftar transaksi...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Transaksi Dimulai", "Transaksi sewa baru berhasil dibuat.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Membuat Transaksi", err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Mulai Sewa";
    }
  }

  window.__confirmBooking = async function (idTrx) {
    const km = await G.uiPrompt("Konfirmasi Booking", "Masukkan KM Awal mobil sebelum serah terima (opsional):", "0");
    if (km === null) return;
    G.uiLoading("Mengonfirmasi booking...", "Memproses");
    try {
      const res = await adminApi("confirm_booking", { id_transaksi: idTrx, km_awal: km });
      if (!res.ok) throw new Error(res.error);
      G.uiLoading("Memperbarui daftar transaksi...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Booking Aktif", "Status sewa diubah menjadi Berjalan.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal", err.message, "error");
    }
  };

  window.__cancelTrx = async function (idTrx) {
    const ok = await G.uiConfirm("Batalkan Transaksi", "Yakin membatalkan transaksi " + idTrx + "?", "Ya, Batalkan", "btn-danger");
    if (!ok) return;
    G.uiLoading("Membatalkan transaksi...", "Memproses");
    try {
      const res = await adminApi("cancel_transaction", { id_transaksi: idTrx });
      if (!res.ok) throw new Error(res.error);
      G.uiLoading("Memperbarui daftar transaksi...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Dibatalkan", "Transaksi berhasil dibatalkan.", "info");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal", err.message, "error");
    }
  };

  window.__markPaid = async function (idTrx) {
    const ok = await G.uiConfirm("Konfirmasi Pelunasan", "Tandai transaksi " + idTrx + " sudah LUNAS?", "Ya, Lunasi", "btn-success");
    if (!ok) return;
    G.uiLoading("Memperbarui status pembayaran...", "Memproses");
    try {
      const res = await adminApi("mark_paid", { id_transaksi: idTrx });
      if (!res.ok) throw new Error(res.error);
      G.uiLoading("Memperbarui data pembayaran...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Lunas", "Transaksi berhasil ditandai Lunas.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal", err.message, "error");
    }
  };

  // ============================================================================
  // CHECK-IN & OTOMATIS DENDA
  // ============================================================================
  let ACTIVE_CI_TRX = null;

  window.__openCheckinModal = function (idTrx) {
    ACTIVE_CI_TRX = DATA.transactions.find(t => t.id_transaksi === idTrx);
    if (!ACTIVE_CI_TRX) return;

    el("ciTrxId").value = idTrx;
    el("ciReturnTime").value = G.toLocalInputValue(new Date());
    el("ciKmAkhir").value = ACTIVE_CI_TRX.km_awal || 0;
    el("ciDendaOverride").value = "";
    G.setRupiahInput(el("ciExtraFee"), 0);
    G.setRupiahInput(el("ciPayNow"), 0);
    el("ciNotes").value = "";
    el("ciPhotoUrl").value = "";
    el("ciUploadStatus").textContent = "";
    el("ciPhotoPreviewWrap").innerHTML = "";

    el("ciInfoBox").innerHTML =
      `<strong>${G.escapeHtml(ACTIVE_CI_TRX.nama_mobil)}</strong> (${G.escapeHtml(ACTIVE_CI_TRX.plat_nomor)}) • ` +
      `Penyewa: <strong>${G.escapeHtml(ACTIVE_CI_TRX.nama_pelanggan)}</strong><br>` +
      `Batas Kembali: <strong>${G.formatDateTime(ACTIVE_CI_TRX.tgl_jam_selesai)}</strong> • ` +
      `Harga Harian: ${G.formatRupiah(ACTIVE_CI_TRX.harga_harian_deal)}`;

    updateCheckinPreview();
    el("checkinModal").classList.add("open");
  };

  function updateCheckinPreview() {
    if (!ACTIVE_CI_TRX) return;
    const rules = getPenaltyRules();
    const ov = G.calculateOvertime(
      ACTIVE_CI_TRX.tgl_jam_selesai,
      el("ciReturnTime").value,
      ACTIVE_CI_TRX.harga_harian_deal,
      rules.persen,
      rules.toleransi
    );

    const overrideRaw = el("ciDendaOverride").value.trim();
    const dendaFinal = overrideRaw !== "" ? G.parseRupiah(overrideRaw) : ov.denda;
    const extraFee = G.parseRupiah(el("ciExtraFee").value);
    const subtotalAwal = (Number(ACTIVE_CI_TRX.subtotal_sewa) || 0) + (Number(ACTIVE_CI_TRX.biaya_antar) || 0) + (Number(ACTIVE_CI_TRX.biaya_sopir) || 0);
    const totalAkhir = subtotalAwal + dendaFinal + extraFee;
    const sudahBayar = Number(ACTIVE_CI_TRX.dp_bayar) || 0;
    const bayarSkrg = G.parseRupiah(el("ciPayNow").value);
    const sisa = Math.max(0, totalAkhir - sudahBayar - bayarSkrg);

    el("ciPenaltyPreview").innerHTML = `
      <div class="summary-row"><span>Status Waktu</span><strong class="${ov.denda > 0 ? "text-danger" : "text-success"}">${G.escapeHtml(ov.label)}</strong></div>
      <div class="summary-row"><span>Denda Otomatis (${ov.jamTelat} jam × ${rules.persen}%)</span><span>${G.formatRupiah(ov.denda)}</span></div>
      <div class="summary-row"><span>Tagihan Sewa + Antar + Sopir</span><span>${G.formatRupiah(subtotalAwal)}</span></div>
      <div class="summary-row"><span>Sudah Dibayar (DP)</span><span>-${G.formatRupiah(sudahBayar)}</span></div>
      <div class="summary-row total"><span>Sisa Harus Dibayar</span><span>${G.formatRupiah(sisa)}</span></div>
    `;
  }

  async function handleCheckinSubmit(e) {
    e.preventDefault();
    const btn = el("saveCheckinBtn");
    btn.disabled = true;
    G.uiLoading("Menghitung denda dan menyelesaikan pengembalian...", "Memproses Check-In");

    try {
      const res = await adminApi("checkin_car", {
        data: {
          id_transaksi: el("ciTrxId").value,
          tgl_jam_kembali_aktual: el("ciReturnTime").value,
          km_akhir: Number(el("ciKmAkhir").value) || 0,
          denda_override: el("ciDendaOverride").value.trim() !== "" ? G.parseRupiah(el("ciDendaOverride").value) : "",
          biaya_tambahan_lain: G.parseRupiah(el("ciExtraFee").value),
          bayar_tambahan: G.parseRupiah(el("ciPayNow").value),
          status_mobil_kembali: el("ciCarStatus").value,
          catatan_kondisi: [el("ciNotes").value.trim(), el("ciPhotoUrl").value.trim() ? ("Foto Kondisi: " + el("ciPhotoUrl").value.trim()) : ""].filter(Boolean).join(" | ")
        }
      });
      if (!res.ok) throw new Error(res.error);
      window.__closeModal("checkinModal");
      G.uiLoading("Memperbarui status armada & transaksi...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert(
        "Pengembalian Selesai!",
        "Jam Telat: " + res.jam_telat + " jam\nDenda: " + G.formatRupiah(res.denda_keterlambatan) + "\nTotal Akhir: " + G.formatRupiah(res.total_akhir),
        "success"
      );
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Pengembalian", err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Selesaikan Pengembalian";
    }
  }

  // ============================================================================
  // TAB 3: ARMADA MOBIL (Google Drive Image)
  // ============================================================================
  function renderCars() {
    if (DATA.cars.length === 0) {
      el("carTableBody").innerHTML = '<tr><td colspan="6" class="text-muted">Belum ada data mobil.</td></tr>';
      return;
    }

    el("carTableBody").innerHTML = DATA.cars.map(c => {
      const stCls = c.status === "Tersedia" ? "badge-success" : (c.status === "Disewa" ? "badge-warning" : "badge-danger");
      return `
        <tr>
          <td data-label="Foto" style="width:110px;">
            <div style="width:96px;height:62px;border-radius:8px;overflow:hidden;border:1px solid var(--border);">
              ${G.renderCarImage(c.foto_url, c.nama_mobil, "car-img")}
            </div>
          </td>
          <td data-label="Mobil & Plat">
            <strong>${G.escapeHtml(c.nama_mobil)}</strong>
            <div class="small text-muted">${G.escapeHtml(c.plat_nomor)} • ${G.escapeHtml(c.tahun)}</div>
          </td>
          <td data-label="Spesifikasi" class="small">
            ${G.escapeHtml(c.transmisi)} • ${G.escapeHtml(c.kapasitas)} Kursi
            <div class="text-muted">${G.escapeHtml(c.merk)}</div>
          </td>
          <td data-label="Harga Sewa">
            <strong>${G.formatRupiah(c.harga_24jam)}</strong><span class="small text-muted">/24j</span>
            ${Number(c.harga_12jam) > 0 ? `<div class="small text-muted">${G.formatRupiah(c.harga_12jam)}/12j</div>` : ""}
          </td>
          <td data-label="Status">
            <select class="form-control" style="padding:5px 8px;width:auto;" onchange="window.__changeCarStatus('${G.escapeHtml(c.id_mobil)}', this.value)">
              <option value="Tersedia" ${c.status === "Tersedia" ? "selected" : ""}>Tersedia</option>
              <option value="Disewa" ${c.status === "Disewa" ? "selected" : ""}>Disewa</option>
              <option value="Servis" ${c.status === "Servis" ? "selected" : ""}>Servis</option>
            </select>
            <div style="margin-top:4px;"><span class="badge ${stCls}">${G.escapeHtml(c.status)}</span></div>
          </td>
          <td data-label="Aksi">
            <div style="display:flex;gap:6px;width:100%;">
              <button class="btn btn-ghost btn-sm" onclick="window.__openCarModal('${G.escapeHtml(c.id_mobil)}')">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="window.__deleteCar('${G.escapeHtml(c.id_mobil)}')">Hapus</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  window.__openCarModal = function (idMobil) {
    el("carForm").reset();
    el("carId").value = "";
    el("carUploadStatus").textContent = "";
    CAR_PHOTO_UPLOAD_ERROR = false;
    IS_UPLOADING_PHOTO = false;
    el("carModalTitle").textContent = idMobil ? "Edit Data Mobil" : "Tambah Mobil Baru";

    if (idMobil) {
      const c = DATA.cars.find(x => x.id_mobil === idMobil);
      if (c) {
        el("carId").value = c.id_mobil;
        el("carName").value = c.nama_mobil || "";
        el("carBrand").value = c.merk || "";
        el("carPlate").value = c.plat_nomor || "";
        el("carYear").value = c.tahun || 2023;
        el("carTrans").value = c.transmisi || "Matic";
        el("carSeats").value = c.kapasitas || 5;
        G.setRupiahInput(el("carPrice24"), c.harga_24jam || 0);
        G.setRupiahInput(el("carPrice12"), c.harga_12jam || 0);
        el("carStatus").value = c.status || "Tersedia";
        el("carPhotoUrl").value = c.foto_url || "";
        el("carDesc").value = c.deskripsi || "";
      }
    }
    updateCarPhotoPreview();
    el("carModal").classList.add("open");
  };


  async function handlePhotoUpload(file, target) {
    if (!file) return;
    const isCar = target === "car";
    const statusEl = el(isCar ? "carUploadStatus" : "ciUploadStatus");
    const urlEl = el(isCar ? "carPhotoUrl" : "ciPhotoUrl");

    IS_UPLOADING_PHOTO = true;
    if (isCar) {
      CAR_PHOTO_UPLOAD_ERROR = false;
      el("saveCarBtn").disabled = true;
    }

    try {
      G.uiLoading("Mengompresi foto dan mengunggah ke Google Drive...", "Mengunggah Foto");
      statusEl.className = "upload-status text-warning";
      statusEl.textContent = "Mengompresi & mengunggah ke Google Drive...";

      const compressed = await G.compressImageForUpload(file, 1280, 0.8);
      const prefix = isCar ? (el("carPlate").value.trim() || "mobil") : (el("ciTrxId").value || "kondisi");
      const fileName = prefix.replace(/\s+/g, "-") + "-" + Date.now() + ".jpg";

      const res = await adminApi("upload_drive_image", {
        data: {
          base64: compressed.base64,
          mimeType: compressed.mimeType,
          fileName: fileName
        }
      });
      G.uiClose();
      if (!res.ok) throw new Error(res.error || "Gagal upload ke Google Drive.");

      urlEl.value = res.url;
      statusEl.className = "upload-status text-success";
      statusEl.textContent = "Foto berhasil tersimpan ke Google Drive.";

      if (isCar) {
        CAR_PHOTO_UPLOAD_ERROR = false;
        updateCarPhotoPreview();
      } else {
        el("ciPhotoPreviewWrap").innerHTML = G.renderCarImage(res.url, "Foto Kondisi", "preview-thumb");
      }
      await G.uiAlert("Upload Berhasil", "Foto berhasil disimpan ke folder Google Drive Anda.", "success");
    } catch (err) {
      G.uiClose();
      if (isCar) {
        CAR_PHOTO_UPLOAD_ERROR = true;
      }
      statusEl.className = "upload-status text-danger";
      statusEl.textContent = "Gagal upload: " + err.message;
      await G.uiAlert(
        "Upload Foto Gagal",
        err.message + "\n\nMobil tidak dapat disimpan sebelum upload foto berhasil atau error dibersihkan.",
        "error"
      );
    } finally {
      IS_UPLOADING_PHOTO = false;
      if (isCar) {
        el("saveCarBtn").disabled = false;
        el("carCameraInput").value = "";
        el("carGalleryInput").value = "";
      } else {
        el("ciCameraInput").value = "";
        el("ciGalleryInput").value = "";
      }
    }
  }

  function updateCarPhotoPreview() {
    const url = el("carPhotoUrl").value.trim();
    const wrap = el("carPhotoPreviewWrap");
    if (!url) {
      wrap.innerHTML = "";
      return;
    }
    const info = G.resolveImageUrls(url);
    wrap.innerHTML =
      (info.isDrive ? `<div class="small text-success" style="margin-top:6px;">Link Google Drive terdeteksi (ID: ${G.escapeHtml(info.fileId)})</div>` : "") +
      G.renderCarImage(url, "Preview Mobil", "preview-thumb");
  }

  async function handleSaveCar(e) {
    e.preventDefault();
    if (IS_UPLOADING_PHOTO) {
      await G.uiAlert("Sedang Mengunggah", "Proses upload foto ke Google Drive belum selesai. Mohon tunggu sebentar.", "warning");
      return;
    }
    if (CAR_PHOTO_UPLOAD_ERROR) {
      await G.uiAlert("Simpan Dibatalkan", "Upload foto sebelumnya gagal sehingga data mobil tidak disimpan. Silakan ulangi ambil/pilih foto sampai berhasil.", "error");
      return;
    }
    const btn = el("saveCarBtn");
    btn.disabled = true;
    btn.textContent = "Menyimpan...";

    try {
      const res = await adminApi("save_car", {
        data: {
          id_mobil: el("carId").value,
          nama_mobil: el("carName").value.trim(),
          merk: el("carBrand").value.trim(),
          plat_nomor: el("carPlate").value.trim(),
          tahun: Number(el("carYear").value),
          transmisi: el("carTrans").value,
          kapasitas: Number(el("carSeats").value),
          harga_24jam: G.parseRupiah(el("carPrice24").value),
          harga_12jam: G.parseRupiah(el("carPrice12").value),
          status: el("carStatus").value,
          foto_url: el("carPhotoUrl").value.trim(),
          deskripsi: el("carDesc").value.trim()
        }
      });
      if (!res.ok) throw new Error(res.error);
      window.__closeModal("carModal");
      G.uiLoading("Memperbarui data mobil...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Berhasil", "Data mobil berhasil disimpan.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Menyimpan Mobil", err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Simpan Mobil";
    }
  }

  window.__changeCarStatus = async function (idMobil, status) {
    G.uiLoading("Mengubah status mobil...", "Memperbarui");
    try {
      const res = await adminApi("update_car_status", { id_mobil: idMobil, status: status });
      if (!res.ok) throw new Error(res.error);
      G.uiLoading("Memperbarui status mobil...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Status Diperbarui", "Status armada berhasil diperbarui.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal", err.message, "error");
    }
  };

  window.__deleteCar = async function (idMobil) {
    const ok = await G.uiConfirm("Hapus Mobil", "Yakin hapus mobil ini dari Google Sheet?", "Ya, Hapus", "btn-danger");
    if (!ok) return;
    G.uiLoading("Menghapus mobil...", "Menghapus");
    try {
      const res = await adminApi("delete_car", { id_mobil: idMobil });
      if (!res.ok) throw new Error(res.error);
      G.uiLoading("Memperbarui daftar mobil...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Terhapus", "Data mobil berhasil dihapus.", "info");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Menghapus", err.message, "error");
    }
  };

  // ============================================================================
  // TAB 4: PELANGGAN
  // ============================================================================
  function renderCustomers() {
    const q = el("custSearch").value.trim().toLowerCase();
    const list = DATA.customers.filter(c =>
      !q || (c.nama + " " + c.no_wa + " " + c.nik_sim + " " + c.alamat).toLowerCase().includes(q)
    );

    if (list.length === 0) {
      el("custTableBody").innerHTML = '<tr><td colspan="7" class="text-muted">Belum ada data pelanggan.</td></tr>';
      return;
    }

    el("custTableBody").innerHTML = list.map(c => {
      const tagCls = c.status_tag === "VIP" ? "badge-success" : (c.status_tag === "Blacklist" ? "badge-danger" : "badge-muted");
      return `
        <tr>
          <td data-label="Nama & ID"><strong>${G.escapeHtml(c.nama)}</strong><div class="small text-muted">ID: ${G.escapeHtml(c.nik_sim)}</div></td>
          <td data-label="WhatsApp"><a href="${G.buildWhatsAppUrl(c.no_wa, "Halo " + c.nama)}" target="_blank" class="text-success">${G.escapeHtml(c.no_wa)}</a></td>
          <td data-label="Alamat" class="small">${G.escapeHtml(c.alamat)}</td>
          <td data-label="Total Sewa"><strong>${G.escapeHtml(c.total_sewa)}x</strong></td>
          <td data-label="Status"><span class="badge ${tagCls}">${G.escapeHtml(c.status_tag || "Normal")}</span></td>
          <td data-label="Catatan" class="small text-muted">${G.escapeHtml(c.catatan || "-")}</td>
          <td data-label="Aksi"><button class="btn btn-ghost btn-sm" onclick="window.__openCustModal('${G.escapeHtml(c.id_pelanggan)}')">Edit</button></td>
        </tr>
      `;
    }).join("");
  }

  window.__openCustModal = function (idCust) {
    const c = DATA.customers.find(x => x.id_pelanggan === idCust);
    if (!c) return;
    el("editCustId").value = c.id_pelanggan;
    el("editCustName").value = c.nama || "";
    el("editCustWa").value = c.no_wa || "";
    el("editCustTag").value = c.status_tag || "Normal";
    el("editCustNotes").value = c.catatan || "";
    el("custModal").classList.add("open");
  };

  async function handleSaveCustomer(e) {
    e.preventDefault();
    G.uiLoading("Menyimpan data pelanggan...", "Menyimpan");
    try {
      const res = await adminApi("save_customer", {
        data: {
          id_pelanggan: el("editCustId").value,
          nama: el("editCustName").value.trim(),
          no_wa: el("editCustWa").value.trim(),
          status_tag: el("editCustTag").value,
          catatan: el("editCustNotes").value.trim()
        }
      });
      if (!res.ok) throw new Error(res.error);
      window.__closeModal("custModal");
      G.uiLoading("Memperbarui data pelanggan...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Berhasil", "Data pelanggan diperbarui.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal", err.message, "error");
    }
  }

  // ============================================================================
  // TAB 5: LAPORAN & EXPORT CSV
  // ============================================================================
  function getFilteredReportRows() {
    const month = el("reportMonth").value;
    return DATA.transactions.filter(t => {
      if (t.status_sewa === "Dibatalkan") return false;
      if (!month) return true;
      return String(t.tgl_jam_mulai || "").slice(0, 7) === month;
    });
  }

  function renderReport() {
    const rows = getFilteredReportRows();
    let sumSewa = 0, sumAntar = 0, sumSopir = 0, sumDenda = 0, sumTotal = 0;

    rows.forEach(r => {
      sumSewa += Number(r.subtotal_sewa) || 0;
      sumAntar += Number(r.biaya_antar) || 0;
      sumSopir += Number(r.biaya_sopir) || 0;
      sumDenda += Number(r.denda_keterlambatan) || 0;
      sumTotal += Number(r.total_akhir) || 0;
    });

    el("reportSummaryGrid").innerHTML = `
      <div class="kpi-card"><div class="kpi-label">Pendapatan Sewa</div><div class="kpi-value">${G.formatRupiah(sumSewa)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Biaya Antar</div><div class="kpi-value">${G.formatRupiah(sumAntar)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Denda Overtime</div><div class="kpi-value text-danger">${G.formatRupiah(sumDenda)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Total Tagihan</div><div class="kpi-value text-success">${G.formatRupiah(sumTotal)}</div></div>
    `;

    if (rows.length === 0) {
      el("reportTableBody").innerHTML = '<tr><td colspan="9" class="text-muted">Tidak ada transaksi pada periode ini.</td></tr>';
      return;
    }

    el("reportTableBody").innerHTML = rows.map(r => `
      <tr>
        <td data-label="Kode">${G.escapeHtml(r.id_transaksi)}</td>
        <td data-label="Mobil">${G.escapeHtml(r.nama_mobil)}</td>
        <td data-label="Pelanggan">${G.escapeHtml(r.nama_pelanggan)}</td>
        <td data-label="Sewa">${G.formatRupiah(r.subtotal_sewa)}</td>
        <td data-label="Biaya Antar">${G.formatRupiah(r.biaya_antar)}</td>
        <td data-label="Sopir">${G.formatRupiah(r.biaya_sopir)}</td>
        <td data-label="Denda" class="${Number(r.denda_keterlambatan) > 0 ? "text-danger" : ""}">${G.formatRupiah(r.denda_keterlambatan)}</td>
        <td data-label="Total Akhir"><strong>${G.formatRupiah(r.total_akhir)}</strong></td>
        <td data-label="Status Bayar">${G.escapeHtml(r.status_bayar)}</td>
      </tr>
    `).join("");
  }

  function exportReportCsv() {
    const rows = getFilteredReportRows();
    const header = ["ID Transaksi", "Mobil", "Plat", "Pelanggan", "Mulai", "Selesai", "Metode Ambil", "Sewa", "Biaya Antar", "Sopir", "Denda", "Total Akhir", "Status Bayar"];
    const lines = [header.join(",")].concat(
      rows.map(r => [
        r.id_transaksi, r.nama_mobil, r.plat_nomor, r.nama_pelanggan, r.tgl_jam_mulai, r.tgl_jam_selesai,
        r.metode_ambil, r.subtotal_sewa, r.biaya_antar, r.biaya_sopir, r.denda_keterlambatan, r.total_akhir, r.status_bayar
      ].map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(","))
    );
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "laporan-rental-" + (el("reportMonth").value || "all") + ".csv";
    a.click();
  }

  // ============================================================================
  // TAB 6: PENGATURAN
  // ============================================================================
  function fillSettingsForm() {
    const s = DATA.settings;
    el("setNamaRental").value = s.nama_rental || "";
    el("setWaAdmin").value = s.no_wa_admin || "";
    el("setAlamatGarasi").value = s.alamat_garasi || "";
    el("setPersenDenda").value = s.persen_denda_per_jam || 10;
    el("setToleransi").value = s.toleransi_menit || 30;
    el("setAmbang").value = s.ambang_pengingat_menit || 120;
    G.setRupiahInput(el("setBiayaAntar"), s.biaya_antar_default || 50000);
    G.setRupiahInput(el("setBiayaSopir"), s.biaya_sopir_per_hari || 150000);
    el("setFolderDrive").value = s.folder_drive_url || DEFAULT_DRIVE_FOLDER;
    el("openDriveFolderLink").href = el("setFolderDrive").value;
    el("setPinBaru").value = "";
  }

  async function handleSaveSettings(e) {
    e.preventDefault();
    const btn = el("saveSettingsBtn");
    btn.disabled = true;
    G.uiLoading("Menyimpan pengaturan bisnis & Google Drive...", "Menyimpan Pengaturan");
    try {
      const res = await adminApi("save_settings", {
        data: {
          nama_rental: el("setNamaRental").value.trim(),
          no_wa_admin: el("setWaAdmin").value.trim(),
          alamat_garasi: el("setAlamatGarasi").value.trim(),
          persen_denda_per_jam: el("setPersenDenda").value,
          toleransi_menit: el("setToleransi").value,
          ambang_pengingat_menit: el("setAmbang").value,
          biaya_antar_default: G.parseRupiah(el("setBiayaAntar").value),
          biaya_sopir_per_hari: G.parseRupiah(el("setBiayaSopir").value),
          folder_drive_url: el("setFolderDrive").value.trim(),
          admin_pin_baru: el("setPinBaru").value.trim()
        }
      });
      if (!res.ok) throw new Error(res.error);
      G.uiLoading("Memperbarui pengaturan...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Tersimpan", "Pengaturan berhasil disimpan!", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal", err.message, "error");
    } finally {
      btn.disabled = false;
      btn.textContent = "Simpan Pengaturan";
    }
  }

  // ============================================================================
  // INVOICE / STRUK CETAK
  // ============================================================================
  window.__openInvoice = function (idTrx) {
    const t = DATA.transactions.find(x => x.id_transaksi === idTrx);
    if (!t) return;
    const rental = DATA.settings.nama_rental || "Restu Bumi";

    el("invoicePaper").innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0f172a;padding-bottom:12px;margin-bottom:16px;">
        <div>
          <h2 style="margin:0;">${G.escapeHtml(rental)}</h2>
          <div style="font-size:0.85rem;color:#475569;">${G.escapeHtml(DATA.settings.alamat_garasi || "")}</div>
          <div style="font-size:0.85rem;color:#475569;">WA: ${G.escapeHtml(DATA.settings.no_wa_admin || "")}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:800;font-size:1.1rem;">INVOICE SEWA</div>
          <div style="font-size:0.85rem;">${G.escapeHtml(t.id_transaksi)}</div>
          <div style="font-size:0.85rem;">Status: <strong>${G.escapeHtml(t.status_bayar)}</strong></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:0.88rem;margin-bottom:16px;">
        <div>
          <strong>Penyewa:</strong><br>
          ${G.escapeHtml(t.nama_pelanggan)}<br>
          WA: ${G.escapeHtml(t.no_wa)}<br>
          ID: ${G.escapeHtml(t.nik_sim)}
        </div>
        <div>
          <strong>Armada &amp; Jadwal:</strong><br>
          ${G.escapeHtml(t.nama_mobil)} (${G.escapeHtml(t.plat_nomor)})<br>
          Mulai: ${G.formatDateTime(t.tgl_jam_mulai)}<br>
          Batas: ${G.formatDateTime(t.tgl_jam_selesai)}
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:0.88rem;margin-bottom:14px;">
        <thead>
          <tr><th>Keterangan</th><th style="text-align:right;">Jumlah</th></tr>
        </thead>
        <tbody>
          <tr><td>Sewa Mobil (${G.escapeHtml(t.durasi_hari)} hari × ${G.formatRupiah(t.harga_harian_deal)})</td><td style="text-align:right;">${G.formatRupiah(t.subtotal_sewa)}</td></tr>
          <tr><td>Pengambilan (${G.escapeHtml(t.metode_ambil)})</td><td style="text-align:right;">${G.formatRupiah(t.biaya_antar)}</td></tr>
          <tr><td>Layanan (${G.escapeHtml(t.layanan_sopir)})</td><td style="text-align:right;">${G.formatRupiah(t.biaya_sopir)}</td></tr>
          ${Number(t.denda_keterlambatan) > 0 ? `<tr><td>Denda Overtime (${G.escapeHtml(t.jam_telat)} jam)</td><td style="text-align:right;">${G.formatRupiah(t.denda_keterlambatan)}</td></tr>` : ""}
          ${Number(t.biaya_tambahan_lain) > 0 ? `<tr><td>Biaya Tambahan Lain</td><td style="text-align:right;">${G.formatRupiah(t.biaya_tambahan_lain)}</td></tr>` : ""}
          <tr><td><strong>Total Tagihan</strong></td><td style="text-align:right;"><strong>${G.formatRupiah(t.total_akhir)}</strong></td></tr>
          <tr><td>Telah Dibayar</td><td style="text-align:right;">${G.formatRupiah(t.dp_bayar)}</td></tr>
          <tr><td><strong>Sisa Pembayaran</strong></td><td style="text-align:right;"><strong>${G.formatRupiah(t.sisa_bayar)}</strong></td></tr>
        </tbody>
      </table>
      <div style="font-size:0.8rem;color:#475569;">Catatan: ${G.escapeHtml(t.catatan_kondisi || "-")}</div>
    `;
    el("invoiceModal").classList.add("open");
  };

  document.addEventListener("DOMContentLoaded", init);
})();
