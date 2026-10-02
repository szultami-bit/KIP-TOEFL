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
    const detailModal = document.getElementById("detailModal");
    const detailTitle = document.getElementById("detailTitle");
    const detailSubtitle = document.getElementById("detailSubtitle");
    const detailBody = document.getElementById("detailBody");
    const detailCloseBtn = document.getElementById("detailCloseBtn");

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


    function getItemResults(row){
      let items = row?.source?.item_results ?? [];
      if(typeof items === "string"){
        try{ items = JSON.parse(items); }catch(_e){ items = []; }
      }
      return Array.isArray(items) ? items : [];
    }

    function buildWeaknesses(items){
      const missed = items.filter(item => item && item.is_correct !== true);
      const map = new Map();

      missed.forEach(item => {
        const topic = item.topic || "Other";
        map.set(topic, (map.get(topic) || 0) + 1);
      });

      return [...map.entries()]
        .sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    function openDetail(index){
      const row = allRows[index];
      if(!row) return;

      const items = getItemResults(row);
      const weaknesses = buildWeaknesses(items);

      detailTitle.textContent = row.participant || "Participant Detail";
      detailSubtitle.textContent = `${row.dateText} • Version ${row.version || "-"} • ${row.whatsapp || "-"}`;

      const summary = `
        <div class="detail-summary">
          <div class="detail-stat"><span>Raw Score</span><strong>${row.rawScore}/40</strong></div>
          <div class="detail-stat"><span>Part A</span><strong>${row.partAScore}/15</strong></div>
          <div class="detail-stat"><span>Part B</span><strong>${row.partBScore}/25</strong></div>
          <div class="detail-stat"><span>Section 2</span><strong>${row.section2Score}/68</strong></div>
          <div class="detail-stat"><span>Accuracy</span><strong>${row.accuracy}%</strong></div>
        </div>
      `;

      let weaknessHtml = "";
      if(items.length){
        weaknessHtml = `
          <div class="weakness-box">
            <h4>Topics needing attention</h4>
            <div class="weakness-list">
              ${
                weaknesses.length
                  ? weaknesses.map(([topic,count]) =>
                      `<span class="weakness-chip">${escapeHtml(topic)} · ${count} missed</span>`
                    ).join("")
                  : `<span class="weakness-chip">No incorrect items in this attempt</span>`
              }
            </div>
          </div>
        `;
      }

      let tableHtml = "";
      if(items.length){
        tableHtml = `
          <div class="detail-table-wrap">
            <table class="detail-table">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Part</th>
                  <th>Topic</th>
                  <th>Difficulty</th>
                  <th>Selected</th>
                  <th>Correct</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                ${items.map(item => {
                  const selected = item.selected ?? "—";
                  const correct = item.correct ?? "—";
                  const unanswered = item.selected === null || item.selected === undefined || item.selected === "";
                  const resultText = unanswered ? "Unanswered" : (item.is_correct === true ? "Correct" : "Incorrect");
                  const resultClass = unanswered ? "result-unanswered" : (item.is_correct === true ? "result-correct" : "result-wrong");
                  return `
                    <tr>
                      <td><strong>${escapeHtml(item.item_no ?? "-")}</strong></td>
                      <td>${escapeHtml(item.part ?? "-")}</td>
                      <td>${escapeHtml(item.topic ?? "-")}</td>
                      <td>${escapeHtml(item.difficulty ?? "-")}</td>
                      <td>${escapeHtml(selected)}</td>
                      <td>${escapeHtml(correct)}</td>
                      <td class="${resultClass}">${resultText}</td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        `;
      }else{
        tableHtml = `
          <div class="empty" style="border:1px solid var(--line);border-radius:16px">
            Detailed item data is not available for this older record.
          </div>
        `;
      }

      detailBody.innerHTML = summary + weaknessHtml + tableHtml;
      detailModal.classList.remove("hidden");
      document.body.style.overflow = "hidden";
    }

    function closeDetail(){
      detailModal.classList.add("hidden");
      document.body.style.overflow = "";
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
            <td><button class="detail-btn" type="button" data-attempt-id="${escapeHtml(row.id)}">View</button></td>
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
try{

        if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
          showLogin();
          showMessage("error", "Supabase config belum terbaca. Cek config.js.");
          return;
        }

        if(!window.supabase || typeof window.supabase.createClient !== "function"){
          showLogin();
          showMessage("error", "Supabase JavaScript SDK gagal dimuat.");
          return;
        }

        sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
        showMessage("error", "Supabase belum siap. Muat ulang halaman lalu coba lagi.");
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

    resultsBody.addEventListener("click", (event) => {
      const btn = event.target.closest(".detail-btn");
      if(!btn) return;

      const attemptId = btn.dataset.attemptId;
      const index = allRows.findIndex(row => String(row.id) === String(attemptId));
      if(index >= 0) openDetail(index);
    });

    detailCloseBtn.addEventListener("click", closeDetail);
    detailModal.addEventListener("click", (event) => {
      if(event.target === detailModal) closeDetail();
    });
    document.addEventListener("keydown", (event) => {
      if(event.key === "Escape" && !detailModal.classList.contains("hidden")) closeDetail();
    });

    init();

})();
