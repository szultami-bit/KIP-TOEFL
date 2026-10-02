(function(){
"use strict";
const cfg = window.KIP_CONFIG || window.KIP_SUPABASE || {};
    const SUPABASE_URL = cfg.SUPABASE_URL || cfg.url || "";
    const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || cfg.anonKey || "";

    let sbClient = null;
    let allRows = [];
    let filteredRows = [];

    const loginSection = document.getElementById("loginSection");
    const dashboardSection = document.getElementById("dashboardSection");
    const signOutBtn = document.getElementById("signOutBtn");
    const loginForm = document.getElementById("loginForm");
    const loginBtn = document.getElementById("loginBtn");
    const loginMessage = document.getElementById("loginMessage");
    const searchInput = document.getElementById("searchInput");
    const refreshBtn = document.getElementById("refreshBtn");
    const resultsBody = document.getElementById("resultsBody");
    const footerNote = document.getElementById("footerNote");
    const toolbarInfo = document.getElementById("toolbarInfo");
    const statusNote = document.getElementById("statusNote");

    const statTotal = document.getElementById("statTotal");
    const statRaw = document.getElementById("statRaw");
    const statSection2 = document.getElementById("statSection2");
    const statTime = document.getElementById("statTime");

    function showMessage(type, text){
      loginMessage.className = "message show " + type;
      loginMessage.textContent = text;
    }

    function hideMessage(){
      loginMessage.className = "message";
      loginMessage.textContent = "";
    }

    function escapeHtml(value){
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function toNumber(value){
      const n = Number(value);
      return Number.isFinite(n) ? n : 0;
    }

    function average(list){
      if(!list.length) return 0;
      return list.reduce((a,b)=>a+b,0) / list.length;
    }

    function formatDate(value){
      if(!value) return "-";
      const d = new Date(value);
      if(Number.isNaN(d.getTime())) return "-";
      return d.toLocaleString("en-GB", {
        day:"2-digit",
        month:"short",
        year:"numeric",
        hour:"2-digit",
        minute:"2-digit"
      });
    }

    function formatTime(seconds){
      const total = Math.max(0, Math.round(toNumber(seconds)));
      const mm = Math.floor(total / 60);
      const ss = total % 60;
      return `${mm}:${String(ss).padStart(2,"0")}`;
    }

    function getField(row, names, fallback=""){
      for(const name of names){
        if(row && row[name] !== undefined && row[name] !== null && row[name] !== ""){
          return row[name];
        }
      }
      return fallback;
    }

    function normalizeAttempt(row){
      const createdAt = getField(row, [
        "created_at", "submitted_at", "finished_at", "completed_at", "ended_at", "inserted_at"
      ], "");

      const rawScore = toNumber(getField(row, ["raw_score", "total_correct", "score_raw"], 0));
      const partAScore = toNumber(getField(row, ["part_a_score", "score_part_a"], 0));
      const partBScore = toNumber(getField(row, ["part_b_score", "score_part_b"], 0));
      const section2Score = toNumber(getField(row, ["section2_score", "estimated_section2", "scaled_score"], 0));

      let accuracy = getField(row, ["accuracy_percent", "accuracy", "raw_accuracy"], "");
      if(accuracy === "" && rawScore){
        accuracy = Math.round((rawScore / 40) * 100);
      }
      accuracy = toNumber(accuracy);

      const timeSeconds = toNumber(getField(row, [
        "time_used_seconds", "elapsed_seconds", "duration_seconds", "time_seconds"
      ], 0));

      let unanswered = getField(row, ["unanswered_count", "unanswered", "blank_count"], "");
      if(unanswered === "" && rawScore >= 0){
        unanswered = Math.max(0, 40 - rawScore);
      }
      unanswered = toNumber(unanswered);

      const autoSubmitted = getField(row, ["auto_submitted"], null);

      return {
        id: getField(row, ["id"], ""),
        dateRaw: createdAt,
        dateText: formatDate(createdAt),
        participant: getField(row, ["participant_name", "name"], "-"),
        whatsapp: getField(row, ["whatsapp", "phone", "whatsapp_number"], "-"),
        institution: getField(row, ["institution", "school", "school_institution"], "-"),
        version: getField(row, ["version"], "-"),
        rawScore,
        partAScore,
        partBScore,
        section2Score,
        accuracy,
        timeSeconds,
        unanswered,
        autoSubmitted,
        source: row
      };
    }

    function sortRows(rows){
      return [...rows].sort((a,b) => {
        const ad = a.dateRaw ? new Date(a.dateRaw).getTime() : 0;
        const bd = b.dateRaw ? new Date(b.dateRaw).getTime() : 0;
        return bd - ad;
      });
    }

    function renderStats(rows){
      statTotal.textContent = rows.length;

      const avgRaw = average(rows.map(r => r.rawScore));
      const avgSec2 = average(rows.map(r => r.section2Score));
      const avgTime = average(rows.map(r => r.timeSeconds));

      statRaw.textContent = `${avgRaw.toFixed(1)}/40`;
      statSection2.textContent = avgSec2.toFixed(1);
      statTime.textContent = formatTime(avgTime);
    }

    function renderTable(rows){
      if(!rows.length){
        resultsBody.innerHTML = `
          <tr>
            <td colspan="13" class="empty">No assessment data found.</td>
          </tr>
        `;
        footerNote.textContent = "0 assessment record(s) loaded.";
        return;
      }

      resultsBody.innerHTML = rows.map(row => {
        const statusBadge = row.autoSubmitted === true
          ? `<span class="badge-soft badge-red">Auto-submitted</span>`
          : `<span class="badge-soft badge-green">Completed</span>`;

        return `
          <tr>
            <td>${escapeHtml(row.dateText)}</td>
            <td><strong>${escapeHtml(row.participant)}</strong></td>
            <td>${escapeHtml(row.whatsapp)}</td>
            <td>${escapeHtml(row.institution)}</td>
            <td><span class="badge-soft badge-blue">${escapeHtml(row.version || "-")}</span></td>
            <td><a href="#" class="score-link">${row.rawScore}/40</a></td>
            <td>${row.partAScore}/15</td>
            <td>${row.partBScore}/25</td>
            <td><a href="#" class="score-link">${row.section2Score}/68</a></td>
            <td>${row.accuracy}%</td>
            <td>${formatTime(row.timeSeconds)}</td>
            <td>${row.unanswered}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      }).join("");

      footerNote.textContent = `${rows.length} assessment record(s) loaded.`;
    }

    function applyFilter(){
      const keyword = searchInput.value.trim().toLowerCase();

      if(!keyword){
        filteredRows = [...allRows];
      } else {
        filteredRows = allRows.filter(row => {
          const haystack = [
            row.participant,
            row.whatsapp,
            row.institution,
            row.version,
            row.dateText
          ].join(" ").toLowerCase();

          return haystack.includes(keyword);
        });
      }

      renderStats(filteredRows);
      renderTable(filteredRows);
      toolbarInfo.textContent = keyword
        ? `Filtered result: ${filteredRows.length} row(s)`
        : `Showing all results: ${filteredRows.length} row(s)`;
    }

    async function loadResults(){
      toolbarInfo.textContent = "Loading data...";
      resultsBody.innerHTML = `<tr><td colspan="13" class="loading">Loading assessment data...</td></tr>`;

      try{
        let data = null;
        let error = null;

        // Try ordered query
        ({ data, error } = await sbClient
          .from("test_attempts")
          .select("*")
          .order("created_at", { ascending:false }));

        // fallback if created_at does not exist
        if(error){
          ({ data, error } = await sbClient
            .from("test_attempts")
            .select("*"));
        }

        if(error) throw error;

        allRows = sortRows((data || []).map(normalizeAttempt));
        applyFilter();
        toolbarInfo.textContent = `Last refresh: ${new Date().toLocaleTimeString("en-GB", {hour:"2-digit", minute:"2-digit", second:"2-digit"})}`;
      }catch(err){
        console.error(err);
        resultsBody.innerHTML = `
          <tr>
            <td colspan="13" class="empty">Failed to load data: ${escapeHtml(err.message || "Unknown error")}</td>
          </tr>
        `;
        footerNote.textContent = "Failed to load records.";
        toolbarInfo.textContent = "Load failed";
      }
    }

    async function showDashboard(){
      loginSection.classList.add("hidden");
      dashboardSection.classList.remove("hidden");
      signOutBtn.classList.remove("hidden");
      statusNote.textContent = "Connected to Supabase";
      await loadResults();
    }

    function showLogin(){
      dashboardSection.classList.add("hidden");
      loginSection.classList.remove("hidden");
      signOutBtn.classList.add("hidden");
    }

    async function signIn(email, password){
      hideMessage();
      loginBtn.disabled = true;
      loginBtn.textContent = "Signing in...";

      try{
        const { data, error } = await sbClient.auth.signInWithPassword({ email, password });
        if(error) throw error;
        if(!data || !data.session) throw new Error("Login berhasil tetapi session tidak terbentuk.");

        showMessage("success", "Login berhasil. Memuat dashboard...");
        await showDashboard();
      }catch(err){
        console.error(err);
        showLogin();
        showMessage("error", err.message || "Login gagal.");
      }finally{
        loginBtn.disabled = false;
        loginBtn.textContent = "Sign In";
      }
    }

    async function signOut(){
      signOutBtn.disabled = true;
      signOutBtn.textContent = "Signing out...";
      try{
        await sbClient.auth.signOut();
      }catch(err){
        console.error(err);
      }finally{
        signOutBtn.disabled = false;
        signOutBtn.textContent = "Sign Out";
      }
    }

    async function init(){
      const diagBox = document.getElementById("diagBox");

      try{
        if(diagBox) diagBox.textContent = "Diagnostic: JS V1603 aktif";

        if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
          showLogin();
          showMessage("error", "Supabase config belum terbaca. Cek config.js.");
          if(diagBox) diagBox.textContent = "Diagnostic: JS OK • CONFIG GAGAL";
          return;
        }

        if(!window.supabase || typeof window.supabase.createClient !== "function"){
          showLogin();
          showMessage("error", "Supabase JavaScript SDK gagal dimuat.");
          if(diagBox) diagBox.textContent = "Diagnostic: JS OK • CONFIG OK • SDK GAGAL";
          return;
        }

        sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        if(diagBox) diagBox.textContent = "Diagnostic: V1603 • JS OK • CONFIG OK • SDK OK";

        const { data, error } = await sbClient.auth.getSession();
        if(error) throw error;

        if(data?.session){
          await showDashboard();
        }else{
          showLogin();
        }
      }catch(err){
        console.error("INIT ERROR:", err);
        showLogin();
        showMessage("error", "Init error: " + (err.message || "Unknown error"));
        if(diagBox) diagBox.textContent = "Diagnostic: INIT ERROR";
      }
    }

    loginBtn.addEventListener("click", async () => {
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value;

      if(!email || !password){
        showMessage("error", "Isi email dan password terlebih dahulu.");
        return;
      }

      if(!sbClient){
        showMessage("error", "Supabase belum siap. Lihat kotak Diagnostic di bawah.");
        return;
      }

      await signIn(email, password);
    });

    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      loginBtn.click();
    });

    signOutBtn.addEventListener("click", signOut);
    refreshBtn.addEventListener("click", loadResults);
    searchInput.addEventListener("input", applyFilter);

    init();

})();
