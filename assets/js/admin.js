(function () {
  "use strict";

  const G = window.RentalGuard;
  const TOKEN_KEY = "rm_admin_token_v1";
  const ACTIVE_TAB_KEY = "rb_admin_active_tab_v1";
  const ACTIVE_SUBTAB_KEY = "rb_admin_mobil_subtab_v1";
  const DEFAULT_DRIVE_FOLDER = "https://drive.google.com/drive/folders/1vDgNQXMj9WatFSJPlbDDmkybk-euko7u?usp=sharing";

  let CONFIG = null;
  let TOKEN = sessionStorage.getItem(TOKEN_KEY) || "";
  let DATA = { cars: [], brands: [], types: [], transactions: [], customers: [], settings: {} };
  let MONITOR_TIMER = null;
  let MONITOR_TICK_TIMER = null;
  let IS_UPLOADING_PHOTO = false;
  let CAR_PHOTO_UPLOAD_ERROR = false;
  let CAR_PHOTO_ITEMS = [];
  let PENDING_CI_PHOTO = null;

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

  function switchTab(tabId, shouldScroll) {
    const targetBtn =
      document.querySelector('.dock-item[data-tab="' + tabId + '"]') ||
      document.querySelector('.dock-item[data-tab="tabMonitor"]');
    const resolvedTab = targetBtn ? targetBtn.dataset.tab : "tabMonitor";
    document.querySelectorAll(".dock-item[data-tab]").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.add("hidden"));
    if (targetBtn) targetBtn.classList.add("active");
    const panel = el(resolvedTab);
    if (panel) panel.classList.remove("hidden");
    try { sessionStorage.setItem(ACTIVE_TAB_KEY, resolvedTab); } catch (_) {}
    if (shouldScroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function switchMobilSubTab(subTabId) {
    const btn =
      document.querySelector('.subtab-btn[data-subtab="' + subTabId + '"]') ||
      document.querySelector('.subtab-btn[data-subtab="subTabMobil"]');
    const resolved = btn ? btn.dataset.subtab : "subTabMobil";
    document.querySelectorAll(".subtab-btn[data-subtab]").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".subtab-panel").forEach(p => p.classList.add("hidden"));
    if (btn) btn.classList.add("active");
    const panel = el(resolved);
    if (panel) panel.classList.remove("hidden");
    try { sessionStorage.setItem(ACTIVE_SUBTAB_KEY, resolved); } catch (_) {}
  }

  function bindGlobalEvents() {
    el("loginForm").addEventListener("submit", handleLogin);
    el("logoutBtn").addEventListener("click", confirmLogout);
    el("refreshDataBtn").addEventListener("click", () => loadDashboard(false));

    document.querySelectorAll(".dock-item[data-tab]").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab, true));
    });

    document.querySelectorAll(".subtab-btn[data-subtab]").forEach(btn => {
      btn.addEventListener("click", () => switchMobilSubTab(btn.dataset.subtab));
    });

    el("trxStatusFilter").addEventListener("change", renderTransactions);
    el("custSearch").addEventListener("input", renderCustomers);
    el("reportMonth").addEventListener("change", renderReport);
    el("exportCsvBtn").addEventListener("click", exportReportCsv);

    // Car Form & Google Drive preview
        el("carTakePhotoBtn").addEventListener("click", () => el("carCameraInput").click());
    el("carPickGalleryBtn").addEventListener("click", () => el("carGalleryInput").click());
    el("carCameraInput").addEventListener("change", e => handlePhotoUpload(e.target.files, "car"));
    el("carGalleryInput").addEventListener("change", e => handlePhotoUpload(e.target.files, "car"));

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

    // Edit Transaction Form (Monitor)
    ["editTrxCarId", "editTrxStart", "editTrxEnd", "editTrxDeliveryMethod", "editTrxDeliveryFee", "editTrxDriverMethod", "editTrxDriverFee", "editTrxDp"].forEach(id => {
      el(id).addEventListener("change", updateEditTrxSummary);
      el(id).addEventListener("input", updateEditTrxSummary);
    });
    el("editTrxDeliveryMethod").addEventListener("change", () => {
      const isDiantar = el("editTrxDeliveryMethod").value === "Diantar";
      el("editTrxDeliveryAddrWrap").classList.toggle("hidden", !isDiantar);
      if (isDiantar && G.parseRupiah(el("editTrxDeliveryFee").value) === 0) {
        G.setRupiahInput(el("editTrxDeliveryFee"), Number(DATA.settings.biaya_antar_default) || 50000);
      } else if (!isDiantar) {
        G.setRupiahInput(el("editTrxDeliveryFee"), 0);
      }
      updateEditTrxSummary();
    });
    el("editTrxDriverMethod").addEventListener("change", () => {
      updateEditDriverFeeDefault();
      updateEditTrxSummary();
    });
    el("editTrxForm").addEventListener("submit", handleEditTransaction);

    // Brand & Type Master Forms
    el("brandForm").addEventListener("submit", handleSaveBrand);
    el("typeForm").addEventListener("submit", handleSaveType);

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

  async function confirmLogout() {
    const ok = await G.uiConfirm(
      "Konfirmasi Keluar",
      "Apakah Anda yakin ingin keluar dari Panel Admin?",
      "Ya, Keluar",
      "btn-danger"
    );
    if (ok) logout();
  }

  function logout() {
    TOKEN = "";
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ACTIVE_TAB_KEY);
    sessionStorage.removeItem(ACTIVE_SUBTAB_KEY);
    if (MONITOR_TIMER) clearInterval(MONITOR_TIMER);
    if (MONITOR_TICK_TIMER) clearInterval(MONITOR_TICK_TIMER);
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
      DATA.brands = res.brands || [];
      DATA.types = res.types || [];
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
      let savedTab = "tabMonitor";
      try { savedTab = sessionStorage.getItem(ACTIVE_TAB_KEY) || "tabMonitor"; } catch (_) {}
      switchTab(savedTab, false);
      let savedSubTab = "subTabMobil";
      try { savedSubTab = sessionStorage.getItem(ACTIVE_SUBTAB_KEY) || "subTabMobil"; } catch (_) {}
      switchMobilSubTab(savedSubTab);

      if (MONITOR_TIMER) clearInterval(MONITOR_TIMER);
      MONITOR_TIMER = setInterval(() => {
        renderMonitor();
        renderKpis();
      }, 30000);
      if (MONITOR_TICK_TIMER) clearInterval(MONITOR_TICK_TIMER);
      MONITOR_TICK_TIMER = setInterval(tickMonitorCountdowns, 1000);
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
    renderBrands();
    renderTypes();
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
  function pad2(n) {
    return String(Math.floor(Math.max(0, n))).padStart(2, "0");
  }

  function formatMonitorCountdown(endIso, toleransiMenit) {
    const end = new Date(endIso);
    if (isNaN(end.getTime())) return { text: "Sisa Waktu: -", cls: "" };
    const diffMs = end.getTime() - Date.now();
    if (diffMs > 0) {
      const totalSec = Math.floor(diffMs / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const cls = h < 2 ? "warn" : "";
      return { text: "Sisa Waktu: " + h + "j " + pad2(m) + "m " + pad2(s) + "d", cls: cls };
    }
    const lateSec = Math.floor(Math.abs(diffMs) / 1000);
    const h = Math.floor(lateSec / 3600);
    const m = Math.floor((lateSec % 3600) / 60);
    const s = lateSec % 60;
    const lateMin = Math.floor(lateSec / 60);
    const inTol = lateMin <= (Number(toleransiMenit) || 30);
    return {
      text: (inTol ? "Lewat (Toleransi): " : "Terlambat: +") + h + "j " + pad2(m) + "m " + pad2(s) + "d",
      cls: inTol ? "warn" : "danger"
    };
  }

  function tickMonitorCountdowns() {
    document.querySelectorAll(".monitor-countdown[data-end]").forEach(node => {
      const info = formatMonitorCountdown(node.dataset.end, node.dataset.tol);
      node.className = "monitor-countdown" + (info.cls ? " " + info.cls : "");
      const txtEl = node.querySelector(".monitor-countdown-txt");
      if (txtEl) txtEl.textContent = info.text;
    });
  }

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

      const cd = formatMonitorCountdown(trx.tgl_jam_selesai, rules.toleransi);
      const countdownHtml = `<div class="monitor-countdown ${cd.cls}" data-end="${G.escapeHtml(trx.tgl_jam_selesai)}" data-tol="${rules.toleransi}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span class="monitor-countdown-txt">${G.escapeHtml(cd.text)}</span></div>`;
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
            ${countdownHtml}
            ${dendaText}
            ${remindedText}
          </div>
          <div style="display:flex;gap:7px;flex-wrap:wrap;">
            <button type="button" class="btn btn-ghost btn-sm" onclick="window.__openEditTrxModal('${G.escapeHtml(trx.id_transaksi)}')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
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
            <div class="td-stack">
              <strong>${G.escapeHtml(t.id_transaksi)}</strong>
              <div class="small text-muted">Mulai: ${G.formatDateTime(t.tgl_jam_mulai)}</div>
              <div class="small text-muted">Tempo: ${G.formatDateTime(t.tgl_jam_selesai)}</div>
            </div>
          </td>
          <td data-label="Mobil">
            <div class="td-stack">
              <strong>${G.escapeHtml(t.nama_mobil)}</strong>
              <div class="small text-muted">${G.escapeHtml(t.plat_nomor)} • ${G.escapeHtml(t.durasi_hari)} hari</div>
            </div>
          </td>
          <td data-label="Pelanggan">
            <div class="td-stack">
              <strong>${G.escapeHtml(t.nama_pelanggan)}</strong>
              <div class="small text-muted">${G.escapeHtml(t.no_wa)}</div>
              <div class="small text-muted">${G.escapeHtml(t.layanan_sopir)}</div>
            </div>
          </td>
          <td data-label="Ambil / Antar">
            <div class="td-stack">
              <div><span class="badge ${t.metode_ambil === "Diantar" ? "badge-info" : "badge-muted"}">${G.escapeHtml(t.metode_ambil)}</span></div>
              ${Number(t.biaya_antar) > 0 ? `<div class="small text-muted">+${G.formatRupiah(t.biaya_antar)}</div>` : ""}
              ${t.metode_ambil === "Diantar" ? `<div class="small text-muted">${G.escapeHtml(t.alamat_antar)}</div>` : ""}
            </div>
          </td>
          <td data-label="Total & Denda">
            <div class="td-stack">
              <strong>${G.formatRupiah(t.total_akhir)}</strong>
              ${liveOvHtml}
              <div class="small text-muted">Sisa: ${G.formatRupiah(t.sisa_bayar)}</div>
            </div>
          </td>
          <td data-label="Status">
            <div class="td-badges">
              <span class="badge ${stCls}">${G.escapeHtml(t.status_sewa)}</span>
              <span class="badge ${payCls}">${G.escapeHtml(t.status_bayar)}</span>
            </div>
          </td>
          <td data-label="Aksi">
            <div class="td-actions">${actions.join("")}</div>
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

  window.__openEditTrxModal = function (idTrx) {
    const trx = DATA.transactions.find(t => t.id_transaksi === idTrx);
    if (!trx) return;
    const sel = el("editTrxCarId");
    const availCars = DATA.cars.filter(c => c.status === "Tersedia" || c.id_mobil === trx.id_mobil);
    const list = availCars.length > 0 ? availCars : DATA.cars;
    sel.innerHTML = list.map(c =>
      `<option value="${G.escapeHtml(c.id_mobil)}" data-rate="${c.id_mobil === trx.id_mobil ? (trx.harga_harian_deal || c.harga_24jam) : c.harga_24jam}">` +
      `${G.escapeHtml(c.nama_mobil)} (${G.escapeHtml(c.plat_nomor)}) - ${G.formatRupiah(c.harga_24jam)}/hari [${G.escapeHtml(c.status)}]` +
      `</option>`
    ).join("");
    sel.value = trx.id_mobil;
    el("editTrxId").value = trx.id_transaksi;
    el("editTrxName").value = trx.nama_pelanggan || "";
    el("editTrxWa").value = trx.no_wa || "";
    el("editTrxNik").value = trx.nik_sim || "";
    el("editTrxAddr").value = trx.alamat_pelanggan || "";
    el("editTrxStart").value = G.toLocalInputValue(trx.tgl_jam_mulai);
    el("editTrxEnd").value = G.toLocalInputValue(trx.tgl_jam_selesai);
    const metode = trx.metode_ambil === "Diantar" ? "Diantar" : "Ambil Sendiri";
    el("editTrxDeliveryMethod").value = metode;
    el("editTrxDeliveryAddrWrap").classList.toggle("hidden", metode !== "Diantar");
    el("editTrxDeliveryAddr").value = trx.alamat_antar && trx.alamat_antar !== "-" ? trx.alamat_antar : "";
    G.setRupiahInput(el("editTrxDeliveryFee"), Number(trx.biaya_antar) || 0);
    el("editTrxDriverMethod").value = trx.layanan_sopir === "Dengan Sopir" ? "Dengan Sopir" : "Lepas Kunci";
    G.setRupiahInput(el("editTrxDriverFee"), Number(trx.biaya_sopir) || 0);
    el("editTrxKmAwal").value = Number(trx.km_awal) || 0;
    G.setRupiahInput(el("editTrxDp"), Number(trx.dp_bayar) || 0);
    updateEditTrxSummary();
    el("editTrxModal").classList.add("open");
  };

  function getEditTrxDays() {
    const s = new Date(el("editTrxStart").value);
    const e = new Date(el("editTrxEnd").value);
    if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) return 1;
    return Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)));
  }

  function updateEditDriverFeeDefault() {
    if (el("editTrxDriverMethod").value === "Dengan Sopir") {
      G.setRupiahInput(el("editTrxDriverFee"), getEditTrxDays() * (Number(DATA.settings.biaya_sopir_per_hari) || 150000));
    } else {
      G.setRupiahInput(el("editTrxDriverFee"), 0);
    }
  }

  function updateEditTrxSummary() {
    const days = getEditTrxDays();
    const opt = el("editTrxCarId").selectedOptions[0];
    const rate = opt ? Number(opt.dataset.rate || 0) : 0;
    const base = days * rate;
    const deliv = el("editTrxDeliveryMethod").value === "Diantar" ? G.parseRupiah(el("editTrxDeliveryFee").value) : 0;
    const drv = el("editTrxDriverMethod").value === "Dengan Sopir" ? G.parseRupiah(el("editTrxDriverFee").value) : 0;
    const total = base + deliv + drv;
    const dp = G.parseRupiah(el("editTrxDp").value);
    const remain = Math.max(0, total - dp);
    el("editTrxSumDays").textContent = days + " Hari";
    el("editTrxSumBase").textContent = G.formatRupiah(base);
    el("editTrxSumDeliv").textContent = G.formatRupiah(deliv);
    el("editTrxSumDrv").textContent = G.formatRupiah(drv);
    el("editTrxSumTotal").textContent = G.formatRupiah(total);
    el("editTrxSumRemain").textContent = G.formatRupiah(remain);
  }

  async function handleEditTransaction(e) {
    e.preventDefault();
    const btn = el("saveEditTrxBtn");
    btn.disabled = true;
    G.uiLoading("Menyimpan perubahan transaksi sewa...", "Memperbarui Transaksi");
    try {
      const res = await adminApi("update_transaction", {
        data: {
          id_transaksi: el("editTrxId").value,
          id_mobil: el("editTrxCarId").value,
          nama_pelanggan: el("editTrxName").value.trim(),
          no_wa: el("editTrxWa").value.trim(),
          nik_sim: el("editTrxNik").value.trim(),
          alamat_pelanggan: el("editTrxAddr").value.trim(),
          tgl_jam_mulai: el("editTrxStart").value,
          tgl_jam_selesai: el("editTrxEnd").value,
          durasi_hari: getEditTrxDays(),
          metode_ambil: el("editTrxDeliveryMethod").value,
          biaya_antar: G.parseRupiah(el("editTrxDeliveryFee").value),
          alamat_antar: el("editTrxDeliveryAddr").value.trim(),
          layanan_sopir: el("editTrxDriverMethod").value,
          biaya_sopir: G.parseRupiah(el("editTrxDriverFee").value),
          km_awal: Number(el("editTrxKmAwal").value) || 0,
          dp_bayar: G.parseRupiah(el("editTrxDp").value)
        }
      });
      if (!res.ok) throw new Error(res.error);
      window.__closeModal("editTrxModal");
      G.uiLoading("Memperbarui monitor & transaksi...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Transaksi Diperbarui", "Data transaksi sewa berhasil diperbarui.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Memperbarui", err.message, "error");
    } finally {
      btn.disabled = false;
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
    PENDING_CI_PHOTO = null;
    el("ciCameraInput").value = "";
    el("ciGalleryInput").value = "";
    el("ciPhotoUrl").value = "";
    el("ciUploadStatus").className = "upload-status text-muted";
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

    try {
      if (PENDING_CI_PHOTO) {
        G.uiLoading("Mengunggah foto kondisi ke Google Drive...", "Mengunggah Foto");
        const prefix = (el("ciTrxId").value || "kondisi").replace(/\s+/g, "-");
        const upRes = await adminApi("upload_drive_image", {
          data: {
            base64: PENDING_CI_PHOTO.base64,
            mimeType: PENDING_CI_PHOTO.mimeType,
            fileName: prefix + "-" + Date.now() + ".jpg"
          }
        });
        if (!upRes.ok) throw new Error(upRes.error || "Gagal upload foto kondisi ke Google Drive.");
        el("ciPhotoUrl").value = upRes.url;
        PENDING_CI_PHOTO = null;
      }

      G.uiLoading("Menghitung denda dan menyelesaikan pengembalian...", "Memproses Check-In");
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
  // TAB 3: ARMADA MOBIL, MASTER MERK & MASTER TYPE (Multi-Foto Google Drive)
  // ============================================================================
  function renderCars() {
    const grid = el("adminCarGrid");
    if (!grid) return;
    if (DATA.cars.length === 0) {
      grid.innerHTML = '<div class="panel-card text-muted" style="grid-column:1/-1;">Belum ada data mobil. Klik + Tambah Mobil untuk memulai.</div>';
      return;
    }

    grid.innerHTML = DATA.cars.map(c => {
      const stCls = c.status === "Tersedia" ? "badge-success" : (c.status === "Disewa" ? "badge-warning" : "badge-danger");
      const metaParts = [c.merk, c.type_mobil, c.tahun].filter(Boolean).map(v => G.escapeHtml(v));
      return `
        <article class="car-card">
          <div class="car-media">
            ${G.renderCarGallery(c.foto_url, c.nama_mobil, "car-img")}
            <span class="badge ${stCls} car-badge-float">${G.escapeHtml(c.status)}</span>
          </div>
          <div class="car-body">
            <div class="car-head">
              <div class="car-title">${G.escapeHtml(c.nama_mobil)}</div>
              ${metaParts.length ? `<div class="car-meta-line">${metaParts.join(" • ")}</div>` : ""}
            </div>
            <div class="car-specs">
              <span class="car-spec-item">${G.escapeHtml(c.transmisi || "Matic")}</span>
              <span class="car-spec-item">${G.escapeHtml(c.kapasitas || 5)} Kursi</span>
              <span class="car-spec-item">${G.escapeHtml(c.plat_nomor || "-")}</span>
            </div>
            ${c.deskripsi ? `<p class="car-desc">${G.escapeHtml(c.deskripsi)}</p>` : ""}
            <div class="car-price-row">
              <div>
                <div class="price-main">${G.formatRupiah(c.harga_24jam)}<span class="price-unit"> /24 jam</span></div>
                ${Number(c.harga_12jam) > 0 ? `<div class="price-sub">12 Jam: ${G.formatRupiah(c.harga_12jam)}</div>` : ""}
              </div>
            </div>
            <div class="admin-car-actions">
              <select class="form-control admin-car-status-sel" onchange="window.__changeCarStatus('${G.escapeHtml(c.id_mobil)}', this.value)">
                <option value="Tersedia" ${c.status === "Tersedia" ? "selected" : ""}>Tersedia</option>
                <option value="Disewa" ${c.status === "Disewa" ? "selected" : ""}>Disewa</option>
                <option value="Servis" ${c.status === "Servis" ? "selected" : ""}>Servis</option>
              </select>
              <button type="button" class="btn btn-ghost btn-sm" onclick="window.__openCarModal('${G.escapeHtml(c.id_mobil)}')">Edit</button>
              <button type="button" class="btn btn-danger btn-sm" onclick="window.__deleteCar('${G.escapeHtml(c.id_mobil)}')">Hapus</button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderBrands() {
    const tbody = el("brandTableBody");
    if (!tbody) return;
    if (DATA.brands.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Belum ada data master merk.</td></tr>';
      return;
    }
    tbody.innerHTML = DATA.brands.map(b => {
      const count = DATA.cars.filter(c => String(c.merk || "").trim().toLowerCase() === String(b.nama_merk || "").trim().toLowerCase()).length;
      return `
        <tr>
          <td data-label="Nama Merk"><strong>${G.escapeHtml(b.nama_merk)}</strong></td>
          <td data-label="Jumlah Unit"><span class="badge badge-info">${count} Mobil</span></td>
          <td data-label="Aksi">
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-ghost btn-sm" onclick="window.__openBrandModal('${G.escapeHtml(b.id_merk)}')">Edit</button>
              <button type="button" class="btn btn-danger btn-sm" onclick="window.__deleteBrand('${G.escapeHtml(b.id_merk)}')">Hapus</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  window.__openBrandModal = function (idMerk) {
    el("brandForm").reset();
    el("brandId").value = "";
    el("brandModalTitle").textContent = idMerk ? "Edit Merk Mobil" : "Tambah Merk Mobil";
    if (idMerk) {
      const b = DATA.brands.find(x => x.id_merk === idMerk);
      if (b) {
        el("brandId").value = b.id_merk;
        el("brandName").value = b.nama_merk || "";
      }
    }
    el("brandModal").classList.add("open");
  };

  async function handleSaveBrand(e) {
    e.preventDefault();
    const btn = el("saveBrandBtn");
    btn.disabled = true;
    G.uiLoading("Menyimpan master merk...", "Menyimpan Merk");
    try {
      const res = await adminApi("save_brand", {
        data: { id_merk: el("brandId").value, nama_merk: el("brandName").value.trim() }
      });
      if (!res.ok) throw new Error(res.error);
      window.__closeModal("brandModal");
      G.uiLoading("Memperbarui master merk...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Berhasil", "Master merk berhasil disimpan.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Menyimpan Merk", err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  window.__deleteBrand = async function (idMerk) {
    const ok = await G.uiConfirm("Hapus Merk", "Yakin ingin menghapus merk ini dari master?", "Ya, Hapus", "btn-danger");
    if (!ok) return;
    G.uiLoading("Menghapus merk...", "Menghapus");
    try {
      const res = await adminApi("delete_brand", { id_merk: idMerk });
      if (!res.ok) throw new Error(res.error);
      G.uiLoading("Memperbarui daftar merk...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Terhapus", "Merk berhasil dihapus.", "info");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Menghapus", err.message, "error");
    }
  };

  function renderTypes() {
    const tbody = el("typeTableBody");
    if (!tbody) return;
    if (DATA.types.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Belum ada data master type.</td></tr>';
      return;
    }
    tbody.innerHTML = DATA.types.map(tp => {
      const count = DATA.cars.filter(c => String(c.type_mobil || "").trim().toLowerCase() === String(tp.nama_type || "").trim().toLowerCase()).length;
      return `
        <tr>
          <td data-label="Nama Type"><strong>${G.escapeHtml(tp.nama_type)}</strong></td>
          <td data-label="Jumlah Unit"><span class="badge badge-info">${count} Mobil</span></td>
          <td data-label="Aksi">
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn-ghost btn-sm" onclick="window.__openTypeModal('${G.escapeHtml(tp.id_type)}')">Edit</button>
              <button type="button" class="btn btn-danger btn-sm" onclick="window.__deleteType('${G.escapeHtml(tp.id_type)}')">Hapus</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  window.__openTypeModal = function (idType) {
    el("typeForm").reset();
    el("typeId").value = "";
    el("typeModalTitle").textContent = idType ? "Edit Type Mobil" : "Tambah Type Mobil";
    if (idType) {
      const tp = DATA.types.find(x => x.id_type === idType);
      if (tp) {
        el("typeId").value = tp.id_type;
        el("typeName").value = tp.nama_type || "";
      }
    }
    el("typeModal").classList.add("open");
  };

  async function handleSaveType(e) {
    e.preventDefault();
    const btn = el("saveTypeBtn");
    btn.disabled = true;
    G.uiLoading("Menyimpan master type...", "Menyimpan Type");
    try {
      const res = await adminApi("save_type", {
        data: { id_type: el("typeId").value, nama_type: el("typeName").value.trim() }
      });
      if (!res.ok) throw new Error(res.error);
      window.__closeModal("typeModal");
      G.uiLoading("Memperbarui master type...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Berhasil", "Master type berhasil disimpan.", "success");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Menyimpan Type", err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  window.__deleteType = async function (idType) {
    const ok = await G.uiConfirm("Hapus Type", "Yakin ingin menghapus type ini dari master?", "Ya, Hapus", "btn-danger");
    if (!ok) return;
    G.uiLoading("Menghapus type...", "Menghapus");
    try {
      const res = await adminApi("delete_type", { id_type: idType });
      if (!res.ok) throw new Error(res.error);
      G.uiLoading("Memperbarui daftar type...", "Sinkronisasi Data");
      await loadDashboard(true);
      G.uiClose();
      await G.uiAlert("Terhapus", "Type berhasil dihapus.", "info");
    } catch (err) {
      G.uiClose();
      await G.uiAlert("Gagal Menghapus", err.message, "error");
    }
  };

  function populateCarMasterSelects(selectedBrand, selectedType) {
    const brandSel = el("carBrand");
    const typeSel = el("carType");
    const brandNames = DATA.brands.map(b => String(b.nama_merk || "").trim()).filter(Boolean);
    if (selectedBrand && !brandNames.some(n => n.toLowerCase() === selectedBrand.toLowerCase())) {
      brandNames.unshift(selectedBrand);
    }
    brandSel.innerHTML = '<option value="">-- Pilih Merk --</option>' +
      brandNames.map(n => `<option value="${G.escapeHtml(n)}">${G.escapeHtml(n)}</option>`).join("");
    if (selectedBrand) brandSel.value = selectedBrand;

    const typeNames = DATA.types.map(tp => String(tp.nama_type || "").trim()).filter(Boolean);
    if (selectedType && !typeNames.some(n => n.toLowerCase() === selectedType.toLowerCase())) {
      typeNames.unshift(selectedType);
    }
    typeSel.innerHTML = '<option value="">-- Pilih Type --</option>' +
      typeNames.map(n => `<option value="${G.escapeHtml(n)}">${G.escapeHtml(n)}</option>`).join("");
    if (selectedType) typeSel.value = selectedType;
  }

  window.__openCarModal = function (idMobil) {
    el("carForm").reset();
    el("carId").value = "";
    el("carPhotoUrl").value = "";
    el("carCameraInput").value = "";
    el("carGalleryInput").value = "";
    el("carPhotoPreviewWrap").innerHTML = "";
    el("carUploadStatus").className = "upload-status text-muted";
    el("carUploadStatus").textContent = "";
    CAR_PHOTO_ITEMS = [];
    CAR_PHOTO_UPLOAD_ERROR = false;
    IS_UPLOADING_PHOTO = false;
    el("carModalTitle").textContent = idMobil ? "Edit Data Mobil" : "Tambah Mobil Baru";
    el("saveCarBtn").textContent = idMobil ? "Update Mobil" : "Simpan Mobil";

    let selBrand = "";
    let selType = "";
    if (idMobil) {
      const c = DATA.cars.find(x => x.id_mobil === idMobil);
      if (c) {
        el("carId").value = c.id_mobil;
        el("carName").value = c.nama_mobil || "";
        selBrand = c.merk || "";
        selType = c.type_mobil || "";
        el("carPlate").value = c.plat_nomor || "";
        el("carYear").value = c.tahun || 2023;
        el("carTrans").value = c.transmisi || "Matic";
        el("carSeats").value = c.kapasitas || 5;
        G.setRupiahInput(el("carPrice24"), c.harga_24jam || 0);
        G.setRupiahInput(el("carPrice12"), c.harga_12jam || 0);
        el("carStatus").value = c.status || "Tersedia";
        el("carPhotoUrl").value = c.foto_url || "";
        el("carDesc").value = c.deskripsi || "";
        CAR_PHOTO_ITEMS = G.parseCarImages(c.foto_url).map(u => ({ kind: "url", url: u }));
      }
    }
    populateCarMasterSelects(selBrand, selType);
    renderCarPhotoItems();
    el("carModal").classList.add("open");
  };

  function renderCarPhotoItems() {
    const wrap = el("carPhotoPreviewWrap");
    if (!CAR_PHOTO_ITEMS.length) {
      wrap.innerHTML = "";
      return;
    }
    wrap.innerHTML =
      '<div class="multi-photo-grid">' +
      CAR_PHOTO_ITEMS.map((item, idx) => {
        const imgHtml = item.kind === "pending"
          ? '<img src="' + item.previewDataUrl + '" alt="Preview Foto ' + (idx + 1) + '">'
          : G.renderCarImage(item.url, "Foto " + (idx + 1), "");
        const tag = idx === 0 ? "Utama" : (item.kind === "pending" ? "Baru" : "Drive");
        return `
          <div class="multi-photo-item">
            ${imgHtml}
            <span class="multi-photo-tag">${tag}</span>
            <button type="button" class="multi-photo-remove" title="Hapus foto ini" onclick="window.__removeCarPhotoItem(${idx})">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        `;
      }).join("") +
      "</div>";
  }

  window.__removeCarPhotoItem = function (idx) {
    CAR_PHOTO_ITEMS.splice(idx, 1);
    el("carPhotoUrl").value = G.serializeCarImages(
      CAR_PHOTO_ITEMS.filter(x => x.kind === "url").map(x => x.url)
    );
    renderCarPhotoItems();
  };

  async function handlePhotoUpload(filesOrFile, target) {
    if (!filesOrFile) return;
    const files = filesOrFile instanceof FileList ? Array.from(filesOrFile) : [filesOrFile];
    if (!files.length) return;

    const isCar = target === "car";
    const statusEl = el(isCar ? "carUploadStatus" : "ciUploadStatus");

    IS_UPLOADING_PHOTO = true;
    if (isCar) {
      CAR_PHOTO_UPLOAD_ERROR = false;
      el("saveCarBtn").disabled = true;
    }

    try {
      G.uiLoading("Memproses dan mengompresi foto...", "Menyiapkan Foto");
      statusEl.className = "upload-status text-warning";
      statusEl.textContent = "Memproses & mengompresi foto...";

      if (isCar) {
        for (let i = 0; i < files.length; i++) {
          const compressed = await G.compressImageForUpload(files[i], 1280, 0.8);
          CAR_PHOTO_ITEMS.push({
            kind: "pending",
            base64: compressed.base64,
            mimeType: compressed.mimeType,
            fileName: compressed.fileName,
            previewDataUrl: compressed.previewDataUrl
          });
        }
        CAR_PHOTO_UPLOAD_ERROR = false;
        renderCarPhotoItems();
        statusEl.className = "upload-status text-success";
        statusEl.textContent = CAR_PHOTO_ITEMS.length + " foto siap (akan diupload ke Google Drive saat Simpan).";
      } else {
        const compressed = await G.compressImageForUpload(files[0], 1280, 0.8);
        PENDING_CI_PHOTO = {
          base64: compressed.base64,
          mimeType: compressed.mimeType,
          fileName: compressed.fileName,
          previewDataUrl: compressed.previewDataUrl
        };
        el("ciPhotoPreviewWrap").innerHTML =
          '<div class="small text-info" style="margin-top:6px;">Preview foto kondisi (akan diupload saat Selesaikan)</div>' +
          '<img src="' + compressed.previewDataUrl + '" alt="Preview Kondisi" class="preview-thumb">';
        statusEl.className = "upload-status text-success";
        statusEl.textContent = "Foto siap diupload saat Selesaikan Pengembalian.";
      }
      G.uiClose();
    } catch (err) {
      G.uiClose();
      if (isCar) {
        CAR_PHOTO_UPLOAD_ERROR = true;
      } else {
        PENDING_CI_PHOTO = null;
      }
      statusEl.className = "upload-status text-danger";
      statusEl.textContent = "Gagal memproses foto: " + err.message;
      await G.uiAlert("Foto Tidak Valid", err.message, "error");
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

  async function handleSaveCar(e) {
    e.preventDefault();
    if (IS_UPLOADING_PHOTO) {
      await G.uiAlert("Sedang Memproses Foto", "Proses persiapan foto belum selesai. Mohon tunggu sebentar.", "warning");
      return;
    }
    const btn = el("saveCarBtn");
    btn.disabled = true;
    btn.textContent = "Menyimpan...";

    try {
      const pendingCount = CAR_PHOTO_ITEMS.filter(x => x.kind === "pending").length;
      let uploadedIdx = 0;

      for (let i = 0; i < CAR_PHOTO_ITEMS.length; i++) {
        const item = CAR_PHOTO_ITEMS[i];
        if (item.kind !== "pending") continue;
        uploadedIdx++;
        G.uiLoading(
          "Mengunggah foto " + uploadedIdx + " dari " + pendingCount + " ke Google Drive...",
          "Mengunggah Foto"
        );
        const prefix = (el("carPlate").value.trim() || "mobil").replace(/\s+/g, "-");
        const upRes = await adminApi("upload_drive_image", {
          data: {
            base64: item.base64,
            mimeType: item.mimeType,
            fileName: prefix + "-" + Date.now() + "-" + uploadedIdx + ".jpg"
          }
        });
        if (!upRes.ok) {
          throw new Error("UPLOAD_FAILED:" + (upRes.error || "Gagal upload foto ke Google Drive."));
        }
        CAR_PHOTO_ITEMS[i] = { kind: "url", url: upRes.url };
      }

      const finalFotoUrl = G.serializeCarImages(CAR_PHOTO_ITEMS.map(x => x.url));
      el("carPhotoUrl").value = finalFotoUrl;
      if (pendingCount > 0) {
        el("carUploadStatus").className = "upload-status text-success";
        el("carUploadStatus").textContent = "Semua foto berhasil diupload ke Google Drive.";
      }

      G.uiLoading("Menyimpan data mobil ke Google Sheets...", "Menyimpan Mobil");
      const res = await adminApi("save_car", {
        data: {
          id_mobil: el("carId").value,
          nama_mobil: el("carName").value.trim(),
          merk: el("carBrand").value.trim(),
          type_mobil: el("carType").value.trim(),
          plat_nomor: el("carPlate").value.trim(),
          tahun: Number(el("carYear").value),
          transmisi: el("carTrans").value,
          kapasitas: Number(el("carSeats").value),
          harga_24jam: G.parseRupiah(el("carPrice24").value),
          harga_12jam: G.parseRupiah(el("carPrice12").value),
          status: el("carStatus").value,
          foto_url: finalFotoUrl,
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
      const hasPending = CAR_PHOTO_ITEMS.some(x => x.kind === "pending");
      const rawMsg = String(err && err.message ? err.message : err);
      const isUploadErr = rawMsg.indexOf("UPLOAD_FAILED:") === 0 || hasPending;
      const cleanMsg = rawMsg.replace(/^UPLOAD_FAILED:/, "");
      if (isUploadErr) {
        CAR_PHOTO_UPLOAD_ERROR = true;
        renderCarPhotoItems();
        el("carUploadStatus").className = "upload-status text-danger";
        el("carUploadStatus").textContent = "Gagal upload: " + cleanMsg;
        await G.uiAlert("Upload Foto Gagal", cleanMsg + "\n\nData mobil tidak disimpan karena upload foto gagal.", "error");
      } else {
        await G.uiAlert("Gagal Menyimpan Mobil", cleanMsg, "error");
      }
    } finally {
      btn.disabled = false;
      btn.textContent = el("carId").value ? "Update Mobil" : "Simpan Mobil";
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
          <td data-label="Nama & ID"><div class="td-stack"><strong>${G.escapeHtml(c.nama)}</strong><div class="small text-muted">ID: ${G.escapeHtml(c.nik_sim)}</div></div></td>
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
