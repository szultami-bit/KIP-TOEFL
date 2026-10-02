(function(){
"use strict";

const cfg = window.KIP_CONFIG || window.KIP_SUPABASE || {};
const SUPABASE_URL = cfg.SUPABASE_URL || cfg.url || "";
const SUPABASE_ANON_KEY = cfg.SUPABASE_ANON_KEY || cfg.anonKey || "";

let sbClient = null;
let allRows = [];
let filteredRows = [];

const $ = id => document.getElementById(id);

const loginSection = $("loginSection");
const dashboardSection = $("dashboardSection");
const signOutBtn = $("signOutBtn");
const loginForm = $("loginForm");
const loginBtn = $("loginBtn");
const loginMessage = $("loginMessage");

const searchInput = $("searchInput");
const versionFilter = $("versionFilter");
const dateFrom = $("dateFrom");
const dateTo = $("dateTo");
const refreshBtn = $("refreshBtn");
const exportBtn = $("exportBtn");
const resultsBody = $("resultsBody");
const footerNote = $("footerNote");
const statusNote = $("statusNote");

const statTotal = $("statTotal");
const statRaw = $("statRaw");
const statSection2 = $("statSection2");
const statTime = $("statTime");
const statDetailed = $("statDetailed");

const topicMetrics = $("topicMetrics");
const partMetrics = $("partMetrics");
const itemBody = $("itemBody");

const detailModal = $("detailModal");
const detailTitle = $("detailTitle");
const detailSubtitle = $("detailSubtitle");
const detailBody = $("detailBody");
const detailCloseBtn = $("detailCloseBtn");

function showMessage(type,text){
  loginMessage.className = "message show " + type;
  loginMessage.textContent = text;
}
function hideMessage(){
  loginMessage.className = "message";
  loginMessage.textContent = "";
}
function escapeHtml(value){
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}
function toNumber(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function average(list){
  if(!list.length) return 0;
  return list.reduce((a,b)=>a+b,0)/list.length;
}
function formatDate(value){
  if(!value) return "-";
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
}
function dateOnly(value){
  if(!value) return "";
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function formatTime(seconds){
  const total = Math.max(0,Math.round(toNumber(seconds)));
  const mm = Math.floor(total/60);
  const ss = total%60;
  return `${mm}:${String(ss).padStart(2,"0")}`;
}
function getField(row,names,fallback=""){
  for(const name of names){
    if(row && row[name] !== undefined && row[name] !== null && row[name] !== "") return row[name];
  }
  return fallback;
}
function parseArray(value){
  if(Array.isArray(value)) return value;
  if(typeof value === "string"){
    try{
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    }catch(_e){ return []; }
  }
  return [];
}
function getItemsFromSource(source){
  return parseArray(source?.item_results);
}

function normalizeAttempt(row){
  const createdAt = getField(row,["submitted_at","created_at","finished_at","completed_at","ended_at","inserted_at"],"");
  const rawScore = toNumber(getField(row,["raw_score","total_correct","score_raw"],0));
  const partAScore = toNumber(getField(row,["part_a_score","score_part_a"],0));
  const partBScore = toNumber(getField(row,["part_b_score","score_part_b"],0));
  const section2Score = toNumber(getField(row,["estimated_section2","section2_score","scaled_score"],0));
  let accuracy = getField(row,["accuracy","accuracy_percent","raw_accuracy"],"");
  if(accuracy === "" && rawScore >= 0) accuracy = Math.round((rawScore/40)*100);
  const timeSeconds = toNumber(getField(row,["elapsed_seconds","time_used_seconds","duration_seconds","time_seconds"],0));
  let unanswered = getField(row,["unanswered","unanswered_count","blank_count"],"");
  if(unanswered === "") unanswered = Math.max(0,40-rawScore);
  const items = getItemsFromSource(row);

  return {
    id:getField(row,["id"],""),
    dateRaw:createdAt,
    dateText:formatDate(createdAt),
    dateOnly:dateOnly(createdAt),
    participant:getField(row,["participant_name","name"],"-"),
    whatsapp:getField(row,["whatsapp","phone","whatsapp_number"],"-"),
    institution:getField(row,["institution","school","school_institution"],"-"),
    version:getField(row,["version"],"-"),
    rawScore,
    partAScore,
    partBScore,
    section2Score,
    accuracy:toNumber(accuracy),
    timeSeconds,
    unanswered:toNumber(unanswered),
    autoSubmitted:getField(row,["auto_submitted"],false) === true,
    cefr:getField(row,["cefr_band"],"-"),
    items,
    source:row
  };
}
function sortRows(rows){
  return [...rows].sort((a,b)=>{
    const ad = a.dateRaw ? new Date(a.dateRaw).getTime() : 0;
    const bd = b.dateRaw ? new Date(b.dateRaw).getTime() : 0;
    return bd-ad;
  });
}

function renderStats(rows){
  statTotal.textContent = rows.length;
  statRaw.textContent = `${average(rows.map(r=>r.rawScore)).toFixed(1)}/40`;
  statSection2.textContent = average(rows.map(r=>r.section2Score)).toFixed(1);
  statTime.textContent = formatTime(average(rows.map(r=>r.timeSeconds)));
  statDetailed.textContent = rows.filter(r=>r.items.length).length;
}

function fillVersionOptions(){
  const versions = [...new Set(allRows.map(r=>r.version).filter(v=>v && v !== "-"))].sort();
  const current = versionFilter.value;
  versionFilter.innerHTML = `<option value="">All versions</option>` +
    versions.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if(versions.includes(current)) versionFilter.value = current;
}

function renderTable(rows){
  if(!rows.length){
    resultsBody.innerHTML = `<tr><td colspan="14" class="empty">No assessment data found.</td></tr>`;
    footerNote.textContent = "0 assessment record(s) loaded.";
    return;
  }

  resultsBody.innerHTML = rows.map(row=>{
    const status = row.autoSubmitted
      ? `<span class="badge red">Auto-submitted</span>`
      : `<span class="badge green">Completed</span>`;
    const detailButton = row.items.length
      ? `<button class="view-btn" type="button" data-attempt-id="${escapeHtml(row.id)}">View</button>`
      : `<span class="badge amber">No item data</span>`;

    return `<tr>
      <td>${escapeHtml(row.dateText)}</td>
      <td><strong>${escapeHtml(row.participant)}</strong></td>
      <td>${escapeHtml(row.whatsapp)}</td>
      <td>${escapeHtml(row.institution)}</td>
      <td><span class="badge blue">${escapeHtml(row.version)}</span></td>
      <td><strong>${row.rawScore}/40</strong></td>
      <td>${row.partAScore}/15</td>
      <td>${row.partBScore}/25</td>
      <td><strong>${row.section2Score}/68</strong></td>
      <td>${row.accuracy}%</td>
      <td>${formatTime(row.timeSeconds)}</td>
      <td>${row.unanswered}</td>
      <td>${status}</td>
      <td>${detailButton}</td>
    </tr>`;
  }).join("");

  footerNote.textContent = `${rows.length} assessment record(s) loaded.`;
}

function topicAggregates(rows){
  const map = new Map();
  rows.forEach(row=>{
    row.items.forEach(item=>{
      if(!item) return;
      const topic = item.topic || "Other";
      if(!map.has(topic)) map.set(topic,{topic,attempts:0,correct:0,parts:new Set()});
      const x = map.get(topic);
      x.attempts++;
      if(item.is_correct === true) x.correct++;
      if(item.part) x.parts.add(item.part);
    });
  });
  return [...map.values()].map(x=>({
    ...x,
    accuracy:x.attempts ? Math.round((x.correct/x.attempts)*100) : 0,
    parts:[...x.parts].join("/")
  }));
}

function renderWeakness(rows){
  const topics = topicAggregates(rows)
    .filter(x=>x.attempts>0)
    .sort((a,b)=>a.accuracy-b.accuracy || b.attempts-a.attempts)
    .slice(0,12);

  topicMetrics.innerHTML = topics.length ? topics.map(x=>`
    <div class="metric-row">
      <div>
        <div class="metric-name">${escapeHtml(x.topic)}</div>
        <div class="metric-sub">${x.attempts} item response(s) · Part ${escapeHtml(x.parts || "-")}</div>
      </div>
      <div class="bar"><span style="width:${x.accuracy}%"></span></div>
      <div class="metric-score">${x.accuracy}%</div>
    </div>
  `).join("") : `<div class="empty">No item-level data available.</div>`;

  const detailed = rows.filter(r=>r.items.length);
  const avgA = detailed.length ? average(detailed.map(r=>(r.partAScore/15)*100)) : 0;
  const avgB = detailed.length ? average(detailed.map(r=>(r.partBScore/25)*100)) : 0;

  partMetrics.innerHTML = detailed.length ? `
    <div class="metric-row">
      <div><div class="metric-name">Part A · Structure</div><div class="metric-sub">${detailed.length} detailed attempt(s)</div></div>
      <div class="bar"><span style="width:${avgA}%"></span></div><div class="metric-score">${avgA.toFixed(0)}%</div>
    </div>
    <div class="metric-row">
      <div><div class="metric-name">Part B · Written Expression</div><div class="metric-sub">${detailed.length} detailed attempt(s)</div></div>
      <div class="bar"><span style="width:${avgB}%"></span></div><div class="metric-score">${avgB.toFixed(0)}%</div>
    </div>
  ` : `<div class="empty">No item-level data available.</div>`;
}

function itemAggregates(rows){
  const map = new Map();
  rows.forEach(row=>{
    row.items.forEach(item=>{
      if(!item) return;
      const no = Number(item.item_no);
      if(!Number.isFinite(no)) return;
      if(!map.has(no)){
        map.set(no,{
          item:no,
          part:item.part || "-",
          topic:item.topic || "-",
          difficulty:item.difficulty || "-",
          attempts:0,
          correct:0
        });
      }
      const x = map.get(no);
      x.attempts++;
      if(item.is_correct === true) x.correct++;
      if(x.topic === "-" && item.topic) x.topic = item.topic;
      if(x.difficulty === "-" && item.difficulty) x.difficulty = item.difficulty;
      if(x.part === "-" && item.part) x.part = item.part;
    });
  });
  return [...map.values()]
    .map(x=>({...x,accuracy:x.attempts?Math.round((x.correct/x.attempts)*100):0}))
    .sort((a,b)=>a.item-b.item);
}

function signalForAccuracy(acc,attempts){
  if(attempts < 5) return {label:"Early data",cls:"blue"};
  if(acc < 30) return {label:"Review difficulty",cls:"red"};
  if(acc > 90) return {label:"Very easy",cls:"amber"};
  return {label:"Monitor",cls:"green"};
}

function renderItems(rows){
  const items = itemAggregates(rows);
  if(!items.length){
    itemBody.innerHTML = `<tr><td colspan="8" class="empty">No item-level data available.</td></tr>`;
    return;
  }
  itemBody.innerHTML = items.map(x=>{
    const signal = signalForAccuracy(x.accuracy,x.attempts);
    return `<tr>
      <td><strong>Q${x.item}</strong></td>
      <td>${escapeHtml(x.part)}</td>
      <td>${escapeHtml(x.topic)}</td>
      <td>${escapeHtml(x.difficulty)}</td>
      <td>${x.attempts}</td>
      <td>${x.correct}</td>
      <td><strong>${x.accuracy}%</strong></td>
      <td><span class="badge ${signal.cls}">${signal.label}</span></td>
    </tr>`;
  }).join("");
}

function applyFilter(){
  const keyword = searchInput.value.trim().toLowerCase();
  const version = versionFilter.value;
  const from = dateFrom.value;
  const to = dateTo.value;

  filteredRows = allRows.filter(row=>{
    if(keyword){
      const haystack = [row.participant,row.whatsapp,row.institution,row.version,row.dateText].join(" ").toLowerCase();
      if(!haystack.includes(keyword)) return false;
    }
    if(version && row.version !== version) return false;
    if(from && row.dateOnly && row.dateOnly < from) return false;
    if(to && row.dateOnly && row.dateOnly > to) return false;
    return true;
  });

  renderStats(filteredRows);
  renderTable(filteredRows);
  renderWeakness(filteredRows);
  renderItems(filteredRows);
}

function buildWeaknesses(items){
  const map = new Map();
  items.forEach(item=>{
    if(!item || item.is_correct === true) return;
    const topic = item.topic || "Other";
    map.set(topic,(map.get(topic)||0)+1);
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1] || a[0].localeCompare(b[0]));
}

function openDetail(row){
  const items = row.items;
  detailTitle.textContent = row.participant || "Participant Detail";
  detailSubtitle.textContent = `${row.dateText} • Version ${row.version} • ${row.whatsapp}`;

  const weakness = buildWeaknesses(items);

  const summary = `
    <div class="detail-summary">
      <div class="detail-stat"><span>Raw Score</span><strong>${row.rawScore}/40</strong></div>
      <div class="detail-stat"><span>Part A</span><strong>${row.partAScore}/15</strong></div>
      <div class="detail-stat"><span>Part B</span><strong>${row.partBScore}/25</strong></div>
      <div class="detail-stat"><span>Section 2</span><strong>${row.section2Score}/68</strong></div>
      <div class="detail-stat"><span>Accuracy</span><strong>${row.accuracy}%</strong></div>
      <div class="detail-stat"><span>Time</span><strong>${formatTime(row.timeSeconds)}</strong></div>
    </div>`;

  const insight = `
    <div class="insight-box">
      <h4>Topics needing attention</h4>
      <div class="chips">
        ${weakness.length
          ? weakness.map(([topic,count])=>`<span class="chip">${escapeHtml(topic)} · ${count} missed</span>`).join("")
          : `<span class="chip">No incorrect items in this attempt</span>`}
      </div>
    </div>`;

  const table = `
    <div class="table-wrap" style="border:1px solid var(--line);border-radius:16px">
      <table class="detail-table">
        <thead>
          <tr><th>No.</th><th>Part</th><th>Topic</th><th>Difficulty</th><th>Selected</th><th>Correct</th><th>Result</th></tr>
        </thead>
        <tbody>
          ${items.map(item=>{
            const selected = item.selected ?? "—";
            const correct = item.correct ?? "—";
            const unanswered = item.selected === null || item.selected === undefined || item.selected === "";
            const resultText = unanswered ? "Unanswered" : (item.is_correct === true ? "Correct" : "Incorrect");
            const resultClass = unanswered ? "result-unanswered" : (item.is_correct === true ? "result-correct" : "result-wrong");
            return `<tr>
              <td><strong>${escapeHtml(item.item_no ?? "-")}</strong></td>
              <td>${escapeHtml(item.part ?? "-")}</td>
              <td>${escapeHtml(item.topic ?? "-")}</td>
              <td>${escapeHtml(item.difficulty ?? "-")}</td>
              <td>${escapeHtml(selected)}</td>
              <td>${escapeHtml(correct)}</td>
              <td class="${resultClass}">${resultText}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  detailBody.innerHTML = summary + insight + table;
  detailModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeDetail(){
  detailModal.classList.add("hidden");
  document.body.style.overflow = "";
}

function csvEscape(value){
  const s = String(value ?? "");
  return `"${s.replaceAll('"','""')}"`;
}
function exportCsv(){
  if(!filteredRows.length){
    alert("No filtered records to export.");
    return;
  }
  const headers = ["Date","Participant","WhatsApp","Institution","Version","Raw","Part A","Part B","Section 2","Accuracy","Time Seconds","Unanswered","Status"];
  const lines = [headers.map(csvEscape).join(",")];
  filteredRows.forEach(r=>{
    lines.push([
      r.dateText,r.participant,r.whatsapp,r.institution,r.version,r.rawScore,r.partAScore,r.partBScore,
      r.section2Score,r.accuracy,r.timeSeconds,r.unanswered,r.autoSubmitted?"Auto-submitted":"Completed"
    ].map(csvEscape).join(","));
  });
  const blob = new Blob([lines.join("\n")],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `KIP-Assessment-V1.7-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function loadResults(){
  resultsBody.innerHTML = `<tr><td colspan="14" class="loading">Loading assessment data...</td></tr>`;
  statusNote.textContent = "Loading data...";

  try{
    let data = null;
    let error = null;

    ({data,error} = await sbClient.from("test_attempts").select("*").order("submitted_at",{ascending:false}));
    if(error){
      ({data,error} = await sbClient.from("test_attempts").select("*"));
    }
    if(error) throw error;

    allRows = sortRows((data||[]).map(normalizeAttempt));
    fillVersionOptions();
    applyFilter();
    statusNote.textContent = `Connected to Supabase • Last refresh ${new Date().toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}`;
  }catch(err){
    console.error(err);
    resultsBody.innerHTML = `<tr><td colspan="14" class="empty">Failed to load data: ${escapeHtml(err.message || "Unknown error")}</td></tr>`;
    statusNote.textContent = "Load failed";
  }
}

function showLogin(){
  loginSection.classList.remove("hidden");
  dashboardSection.classList.add("hidden");
  signOutBtn.classList.add("hidden");
}
async function showDashboard(){
  loginSection.classList.add("hidden");
  dashboardSection.classList.remove("hidden");
  signOutBtn.classList.remove("hidden");
  await loadResults();
}
async function signIn(){
  hideMessage();
  const email = $("email").value.trim();
  const password = $("password").value;

  if(!email || !password){
    showMessage("error","Isi email dan password terlebih dahulu.");
    return;
  }
  if(!sbClient){
    showMessage("error","Supabase belum siap. Muat ulang halaman lalu coba lagi.");
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in...";
  try{
    const {data,error} = await sbClient.auth.signInWithPassword({email,password});
    if(error) throw error;
    if(!data?.session) throw new Error("Login berhasil tetapi session tidak terbentuk.");
    showMessage("success","Login berhasil.");
    await showDashboard();
  }catch(err){
    console.error(err);
    showMessage("error",err.message || "Login gagal.");
  }finally{
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In";
  }
}
async function signOut(){
  try{ await sbClient.auth.signOut(); }catch(_e){}
  showLogin();
}

function switchTab(name){
  document.querySelectorAll(".tab-btn").forEach(btn=>btn.classList.toggle("active",btn.dataset.tab===name));
  $("participantsPanel").classList.toggle("active",name==="participants");
  $("weaknessPanel").classList.toggle("active",name==="weakness");
  $("itemsPanel").classList.toggle("active",name==="items");
}

async function init(){
  try{
    if(!SUPABASE_URL || !SUPABASE_ANON_KEY){
      showLogin();
      showMessage("error","Supabase config belum terbaca. Cek config.js.");
      return;
    }
    if(!window.supabase || typeof window.supabase.createClient !== "function"){
      showLogin();
      showMessage("error","Supabase JavaScript SDK gagal dimuat.");
      return;
    }

    sbClient = window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

    const {data,error} = await sbClient.auth.getSession();
    if(error) throw error;
    if(data?.session) await showDashboard();
    else showLogin();
  }catch(err){
    console.error("INIT ERROR",err);
    showLogin();
    showMessage("error","Init error: " + (err.message || "Unknown error"));
  }
}

loginBtn.addEventListener("click",signIn);
loginForm.addEventListener("submit",e=>{e.preventDefault();loginBtn.click();});
signOutBtn.addEventListener("click",signOut);
refreshBtn.addEventListener("click",loadResults);
exportBtn.addEventListener("click",exportCsv);
searchInput.addEventListener("input",applyFilter);
versionFilter.addEventListener("change",applyFilter);
dateFrom.addEventListener("change",applyFilter);
dateTo.addEventListener("change",applyFilter);

document.querySelectorAll(".tab-btn").forEach(btn=>btn.addEventListener("click",()=>switchTab(btn.dataset.tab)));

resultsBody.addEventListener("click",event=>{
  const btn = event.target.closest(".view-btn");
  if(!btn) return;
  const row = allRows.find(r=>String(r.id)===String(btn.dataset.attemptId));
  if(row) openDetail(row);
});
detailCloseBtn.addEventListener("click",closeDetail);
detailModal.addEventListener("click",event=>{if(event.target===detailModal) closeDetail();});
document.addEventListener("keydown",event=>{if(event.key==="Escape" && !detailModal.classList.contains("hidden")) closeDetail();});

init();
})();
