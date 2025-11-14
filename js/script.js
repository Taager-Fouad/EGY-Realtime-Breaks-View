const sheetId = '1JcITqKR5NZ6Ulavf43Ikz9vBc8gDCTA76X7dE9713TI';
const gids = [370233430];
const breakSheetId = '11scN38eNhFZU4w6pxzk95ZnAd3pveP4v2sPTTWcOhyk';
const breakGid = 1793971504;
const percentCols = ["WAIT %","TALK TIME %","DISPOTIME %","PAUSETIME %","DEAD TIME %"];
const fcMetrics = ["CONNECTED","ACW","COH","IT","MAN","DISPO"];
// pauseMetrics labels kept as Exc and BRK30 (we'll add LAGGED to Exc)
const pauseMetrics = ["Exc","BRK30"];
let jsonData = [];
let headers = [];
let breaksData = [];

/* helper: format Date(...) to hh:mm:ss */
function formatTime(value) {
  if(typeof value==='string' && value.startsWith('Date(')){
    const parts = value.match(/\d+/g);
    if(parts && parts.length>=6){
      const h=String(parts[3]).padStart(2,'0');
      const m=String(parts[4]).padStart(2,'0');
      const s=String(parts[5]).padStart(2,'0');
      return `${h}:${m}:${s}`;
    }
  }
  return value;
}
function timeToSeconds(t){
  if(!t||typeof t!=='string'||!t.includes(':')) return 0;
  const p=t.split(':').map(Number);
  return (p[0]||0)*3600 + (p[1]||0)*60 + (p[2]||0);
}
function secondsToTime(sec){
  const h=Math.floor(sec/3600).toString().padStart(2,'0');
  const m=Math.floor((sec%3600)/60).toString().padStart(2,'0');
  const s=(sec%60).toString().padStart(2,'0');
  return `${h}:${m}:${s}`;
}

/* convert "HH:MM:SS" 24h to "hh:MM AM/PM" */
function to12Hour(time) {
  if(!time || typeof time !== 'string') return time || '—';
  if(time.startsWith('Date(')) time = formatTime(time);
  if(!time.includes(':')) return time;
  let [h,m,s] = time.split(':').map(Number);
  if(isNaN(h)) return time;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if(h === 0) h = 12;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ampm}`;
}

/* convert column letters to zero-based index (A -> 0, AF -> 31) */
function colLetterToIndex(letter){
  if(!letter || typeof letter !== 'string') return -1;
  letter = letter.toUpperCase();
  let index = 0;
  for(let i=0;i<letter.length;i++){
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}
function isTimeString(s){
  if(!s || typeof s !== 'string') return false;
  return /^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/.test(s);
}

async function fetchSheetData(gid){
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`;
  const res = await fetch(url);
  const text = await res.text();
  const json = JSON.parse(text.substring(47,text.length-2));
  const cols = (json.table.cols || []).map(c => c.label||'');
  const rows = (json.table.rows || []).map(r => (r.c || []).map(c=>formatTime(c?.v||"")));
  return {cols, rows, raw: json.table};
}

async function fetchBreaksData(){
  const url = `https://docs.google.com/spreadsheets/d/${breakSheetId}/gviz/tq?tqx=out:json&gid=${breakGid}`;
  const res = await fetch(url);
  const text = await res.text();
  const json = JSON.parse(text.substring(47,text.length-2));
  breaksData = (json.table.rows || []).map(r => ({
    id: (r.c[0]?.v !== undefined ? String(r.c[0].v) : '').trim(),
    originalShift: r.c[3]?.v || '',
    firstBreak: r.c[7]?.v || '',
    secondBreak: r.c[8]?.v || '',
  }));
}

async function loadData(){
  try{
    const allData=[];
    for(const gid of gids) allData.push(await fetchSheetData(gid));
    headers = allData[0].cols || [];
    const rows = allData[0].rows || [];

    // --- improved AF2 reading: if header found, scan rows[0..N] in that column for time-like value
    let af2ValueRaw = undefined;
    const attempts = [];

    const headerIdx = headers.findIndex(h => String(h||'').toLowerCase().includes('last'));
    attempts.push({step:'header contains last', headerIdx});
    if(headerIdx !== -1){
      const scanMax = Math.min(rows.length, 6);
      attempts.push(`scanning rows[0..${scanMax-1}] at column ${headerIdx}`);
      for(let r=0; r<scanMax; r++){
        const candidate = rows[r] ? rows[r][headerIdx] : undefined;
        if(candidate !== undefined && candidate !== null && String(candidate).trim() !== ''){
          if(isTimeString(String(candidate))){
            af2ValueRaw = candidate;
            attempts.push(`found time at rows[${r}][${headerIdx}]`);
            break;
          } else {
            attempts.push(`value at rows[${r}][${headerIdx}] not time: "${candidate}"`);
          }
        } else {
          attempts.push(`rows[${r}][${headerIdx}] empty/undefined`);
        }
      }
    }

    if(af2ValueRaw === undefined){
      const afIdx = colLetterToIndex('AF');
      attempts.push({step:'col letter AF', afIdx});
      const scanMax = Math.min(rows.length, 6);
      attempts.push(`scanning rows[0..${scanMax-1}] at AF index ${afIdx}`);
      for(let r=0; r<scanMax; r++){
        const candidate = rows[r] ? rows[r][afIdx] : undefined;
        if(candidate !== undefined && candidate !== null && String(candidate).trim() !== ''){
          if(isTimeString(String(candidate))){
            af2ValueRaw = candidate;
            attempts.push(`found time at rows[${r}][${afIdx}]`);
            break;
          } else {
            attempts.push(`value at rows[${r}][${afIdx}] not time: "${candidate}"`);
          }
        } else {
          attempts.push(`rows[${r}][${afIdx}] empty/undefined`);
        }
      }
    }

    if(af2ValueRaw === undefined){
      const maxRows = Math.min(rows.length, 6);
      const maxCols = Math.min(headers.length || 10, 12);
      attempts.push(`fallback scan rows[0..${maxRows-1}] cols[0..${maxCols-1}]`);
      outer:
      for(let r=0; r<maxRows; r++){
        for(let c=0; c<maxCols; c++){
          const candidate = rows[r] ? rows[r][c] : undefined;
          if(candidate !== undefined && candidate !== null && String(candidate).trim() !== '' && isTimeString(String(candidate))){
            af2ValueRaw = candidate;
            attempts.push(`found time at rows[${r}][${c}] during fallback`);
            break outer;
          }
        }
      }
    }

    let af2Display = '—';
    if(af2ValueRaw === undefined || af2ValueRaw === null) {
      af2Display = '— (AF not found)';
      console.warn('AF2 not found. Attempts:', attempts, {headersSample: headers.slice(0,40), rowsSample: rows.slice(0,6)});
    } else if(String(af2ValueRaw).trim() === '') {
      af2Display = '— (empty)';
      console.info('AF2 is empty string. Attempts:', attempts);
    } else {
      af2Display = to12Hour(String(af2ValueRaw));
      console.info('AF2 read success:', af2ValueRaw, '->', af2Display, attempts);
    }
    document.getElementById("lastUpdateRaw").textContent = "Last Update: " + af2Display;

    const combined={};
    allData.forEach(sheet=>{
      (sheet.rows || []).forEach(r=>{
        const name = String(r[0]||'').trim();
        const id = String(r[1]||'').trim();
        const key = `${name}__${id}`;
        if(!combined[key]) {
          combined[key] = r.slice();
        } else {
          for(let i=2;i<r.length;i++){
            const val = r[i] || "";
            const existing = combined[key][i] || "";
            if(typeof val === 'string' && val.includes(':') && typeof existing === 'string' && existing.includes(':')){
              const s = timeToSeconds(existing) + timeToSeconds(val);
              combined[key][i] = secondsToTime(s);
            } else if(!isNaN(parseFloat(val)) && val !== ""){
              const sum = (parseFloat(existing||0) + parseFloat(val));
              combined[key][i] = String(sum);
            } else {
              combined[key][i] = existing || val;
            }
          }
        }
      });
    });

    if(!headers.includes("Final Connect")) headers.push("Final Connect");
    jsonData = Object.values(combined);
    document.getElementById("searchBtn").disabled=false;
    await fetchBreaksData();
  }catch(err){
    console.error("loadData error:", err);
    document.getElementById("noData").style.display="block";
    document.getElementById("noData").textContent = "Failed to load sheet data";
    document.getElementById("lastUpdateRaw").textContent = "Last Update: —";
  }
}

function animateNumber(elementOrCallbackTarget, targetValue, callback){
  let current = 0;
  targetValue = Math.max(0, Math.floor(targetValue || 0));
  const steps = 50;
  const step = Math.max(1, Math.ceil(targetValue / steps));
  const interval = setInterval(()=>{
    current += step;
    if(current >= targetValue){
      current = targetValue;
      clearInterval(interval);
    }
    if(typeof elementOrCallbackTarget === 'function'){
      elementOrCallbackTarget(current);
    } else if(callback){
      callback(current);
    }
  }, 20);
}

document.getElementById("searchBtn").addEventListener("click", async ()=>{
  const rawQuery = document.getElementById("searchInput").value.trim();
  const query = rawQuery.toLowerCase();
  const fcContainer = document.getElementById("finalConnectContainer");
  const pauseContainer = document.getElementById("totalPauseContainer");
  const container = document.getElementById("agentsContainer");
  const headerContainer = document.getElementById("agentHeaderContainer");
  const breaksContainer = document.getElementById("breaksContainer");
  const firstBreakEl = document.getElementById("firstBreak");
  const secondBreakEl = document.getElementById("secondBreak");

  fcContainer.innerHTML = "";
  pauseContainer.innerHTML = "";
  container.innerHTML = "";
  headerContainer.innerHTML = "";
  firstBreakEl.textContent = '—';
  secondBreakEl.textContent = '—';
  breaksContainer.style.display = 'none';
  document.getElementById("noData").style.display="none";

  if(!query) return;

  const filteredMain = jsonData.filter(r=>{
    const name = String(r[0]||"").trim().toLowerCase();
    const id = String(r[1]||"").trim().toLowerCase();
    return (name && name.includes(query)) || (id && id.includes(query));
  });

  const filteredBreaks = breaksData.filter(b => String(b.id||"").toLowerCase() === query);

  if(filteredMain.length===0 && filteredBreaks.length===0){
    document.getElementById("noData").style.display="block";
    document.getElementById("noData").textContent = "No data found";
    return;
  }

  filteredMain.forEach(agent=>{
    const agentHeader=document.createElement("div");
    agentHeader.className="agentHeader";
    const callsIdx = headers.indexOf("CALLS");
    const callsVal = callsIdx>=0 ? parseInt(agent[callsIdx]||0,10) : 0;

    const talkIdx = headers.indexOf("TALK");
    const acwIdx = headers.indexOf("ACW");
    const talkSec = talkIdx>=0 ? timeToSeconds(agent[talkIdx]) : 0;
    const acwSec = acwIdx>=0 ? timeToSeconds(agent[acwIdx]) : 0;
    const aht = callsVal > 0 ? secondsToTime(Math.floor((talkSec + acwSec)/callsVal)) : "00:00:00";

    agentHeader.textContent = `Name: ${agent[0]} | ID: ${agent[1]} | CALLS: 0 | AHT: ${aht}`;
    headerContainer.appendChild(agentHeader);

    animateNumber(agentHeader, callsVal,(current)=>{
      const currentAHT = current>0 ? secondsToTime(Math.floor((talkSec + acwSec)/current)) : "00:00:00";
      agentHeader.textContent=`Name: ${agent[0]} | ID: ${agent[1]} | CALLS: ${current} | AHT: ${currentAHT}`;
    });

    // --- Final Connect ---
    const fcDiv=document.createElement("div");
    fcDiv.className="finalConnectDiv";
    const fcTitle=document.createElement("div");
    fcTitle.className="fcTitle";
    fcTitle.textContent="Final Connect";
    fcDiv.appendChild(fcTitle);
    const fcTotal=document.createElement("div");
    fcTotal.className="fcTotal";
    fcDiv.appendChild(fcTotal);

    const fcColors=["#00ffff","#00ff99","#ff00ff","#ffcc00","#ff6600","#ff3399"];
    const fcValues=fcMetrics.map(m=>{
      const idx=headers.indexOf(m);
      return idx>=0 ? timeToSeconds(agent[idx]) : 0;
    });
    const totalFC = fcValues.reduce((a,b)=>a+b,0) || 0;

    fcMetrics.forEach((metric,i)=>{
      const barLabel=document.createElement("div");
      barLabel.className="barLabel";
      const percent = totalFC > 0 ? ((fcValues[i]/totalFC)*100).toFixed(1) : "0.0";
      barLabel.innerHTML=`<span>${metric}</span><span>00:00:00 (0%)</span>`;
      const bar=document.createElement("div");
      bar.className="bar";
      const inner=document.createElement("div");
      inner.className="barInner";
      inner.style.background=fcColors[i];
      inner.style.width="0%";
      bar.appendChild(inner);
      fcDiv.appendChild(barLabel);
      fcDiv.appendChild(bar);

      setTimeout(()=>{
        inner.style.width = percent+"%";
        let currentSec = 0;
        const target = fcValues[i] || 0;
        const step = Math.max(1, Math.ceil(target / 50));
        const interval = setInterval(()=>{
          currentSec += step;
          if(currentSec >= target){
            currentSec = target;
            clearInterval(interval);
          }
          const percentNow = totalFC>0 ? ((currentSec/totalFC)*100).toFixed(1) : "0.0";
          barLabel.children[1].textContent = `${secondsToTime(currentSec)} (${percentNow}%)`;
        },20);
      },100);
    });

    fcContainer.appendChild(fcDiv);
    animateNumber(fcTotal,totalFC,(val)=>{ fcTotal.textContent = secondsToTime(val); });

    // --- Total Pause ---
    const pauseDiv=document.createElement("div");
    pauseDiv.className="totalPauseDiv";
    const pauseTitle=document.createElement("div");
    pauseTitle.className="pauseTitle";
    pauseTitle.textContent="Total Pause";
    pauseDiv.appendChild(pauseTitle);
    const pauseTotal=document.createElement("div");
    pauseTotal.className="pauseTotal";
    pauseDiv.appendChild(pauseTotal);

    // --- combine LAGGED with Exc (not with BRK30) ---
    const pauseColors=["#ff3333","#ff9900"];
    const excIdx = headers.indexOf("Exc");
    const brkIdx = headers.indexOf("BRK30");
    const lagIdx = headers.indexOf("LAGGED");

    const excVal = excIdx >= 0 ? timeToSeconds(agent[excIdx]) : 0;
    const brkVal = brkIdx >= 0 ? timeToSeconds(agent[brkIdx]) : 0;
    const lagVal = lagIdx >= 0 ? timeToSeconds(agent[lagIdx]) : 0;

    // Now combine LAGGED into Exc
    const combinedExc = excVal + lagVal;
    const pauseValues = [combinedExc, brkVal]; // [Exc (with LAGGED), BRK30]
    const totalPause = pauseValues.reduce((a,b)=>a+b,0) || 0;
    const pauseLabels = ["Exc","BRK30"];

    pauseLabels.forEach((metric,i)=>{
      const barLabel=document.createElement("div");
      barLabel.className="barLabel";
      const percent = totalPause > 0 ? ((pauseValues[i]/totalPause)*100).toFixed(1) : "0.0";
      barLabel.innerHTML=`<span>${metric}</span><span>00:00:00 (0%)</span>`;
      const bar=document.createElement("div");
      bar.className="bar";
      const inner=document.createElement("div");
      inner.className="barInner";
      inner.style.background=pauseColors[i];
      inner.style.width="0%";
      bar.appendChild(inner);
      pauseDiv.appendChild(barLabel);
      pauseDiv.appendChild(bar);

      setTimeout(()=>{
        inner.style.width = percent+"%";
        let currentSec = 0;
        const target = pauseValues[i] || 0;
        const step = Math.max(1, Math.ceil(target / 50));
        const interval = setInterval(()=>{
          currentSec += step;
          if(currentSec >= target){
            currentSec = target;
            clearInterval(interval);
          }
          const percentNow = totalPause>0 ? ((currentSec/totalPause)*100).toFixed(1) : "0.0";
          barLabel.children[1].textContent = `${secondsToTime(currentSec)} (${percentNow}%)`;
        },20);
      },100);
    });

    pauseContainer.appendChild(pauseDiv);
    animateNumber(pauseTotal,totalPause,(val)=>{ pauseTotal.textContent = secondsToTime(val); });

    // --- Breaks ---
    const agentId = String(agent[1]||"").trim();
    const breakInfo = breaksData.find(b => String(b.id||"").trim() === agentId);
    if(breakInfo){
      function formatBreakTime(value){
        if(typeof value==='string' && value.startsWith('Date(')){
          const parts = value.match(/\d+/g);
          if(parts && parts.length>=6){
            let h = parseInt(parts[3],10);
            const m = parseInt(parts[4],10);
            const ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12; if(h===0) h=12;
            return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ampm}`;
          }
        }
        return '—';
      }

      const oldShiftEl = document.getElementById('originalShiftDiv');
      if(oldShiftEl) oldShiftEl.remove();

      const originalShiftEl = document.createElement('div');
      originalShiftEl.id = 'originalShiftDiv';
      originalShiftEl.style.color = '#ffcc00';
      originalShiftEl.style.textShadow = '0 0 10px #ffcc00';
      originalShiftEl.style.fontWeight = 'bold';
      originalShiftEl.style.marginBottom = '5px';
      originalShiftEl.textContent = `Shift: ${breakInfo.originalShift || '—'}`;
      breaksContainer.insertBefore(originalShiftEl, breaksContainer.firstChild);

      const firstBreakEl = document.getElementById("firstBreak");
      const secondBreakEl = document.getElementById("secondBreak");
      firstBreakEl.textContent = formatBreakTime(breakInfo.firstBreak);
      secondBreakEl.textContent = formatBreakTime(breakInfo.secondBreak);
      breaksContainer.style.display='block';
    }

    // --- Table (Agent Metrics) ---
    const card=document.createElement("div");
    card.className="agentCard";
    const table=document.createElement("table");
    const thead=document.createElement("thead");
    thead.innerHTML="<tr><th>Metric</th><th>Value</th></tr>";
    table.appendChild(thead);
    const tbody=document.createElement("tbody");

    // limit columns up to index 29 and exclude LAGGED column from table
    agent.forEach((val,index)=>{
      if(index < 2) return;
      if(index > 29) return;
      const colName = headers[index];
      if(!colName) return;
      if(fcMetrics.includes(colName)) return;
      if(pauseMetrics.includes(colName)) return;
      if(colName === "Final Connect") return;
      if(colName === "CALLS") return;
      if(colName === "LAGGED") return; // exclude LAGGED from table

      const row=document.createElement("tr");
      const td1=document.createElement("td"); td1.textContent = colName;
      const td2=document.createElement("td");
      if(percentCols.includes(colName)){
        const num = parseFloat(val) || 0;
        td2.textContent = (num*100).toFixed(2) + "%";
      } else {
        td2.textContent = val !== undefined ? val : "";
      }
      row.appendChild(td1); row.appendChild(td2);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    card.appendChild(table);
    container.appendChild(card);
  });

  if(filteredMain.length===0 && filteredBreaks.length>0){
    const breakInfo = filteredBreaks[0];
    function formatBreakTime(value){
      if(typeof value==='string' && value.startsWith('Date(')){
        const parts = value.match(/\d+/g);
        if(parts && parts.length>=6){
          let h = parseInt(parts[3],10);
          const m = parseInt(parts[4],10);
          const ampm = h >= 12 ? 'PM' : 'AM';
          h = h % 12; if(h===0) h = 12;
          return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ampm}`;
        }
      }
      return '—';
    }
    const firstBreakEl = document.getElementById("firstBreak");
    const secondBreakEl = document.getElementById("secondBreak");
    firstBreakEl.textContent = formatBreakTime(breakInfo.firstBreak);
    secondBreakEl.textContent = formatBreakTime(breakInfo.secondBreak);
    breaksContainer.style.display='block';
  }
});

document.getElementById("searchInput").addEventListener("keypress", function(e) {
    if (e.key === "Enter") {
        document.getElementById("searchBtn").click();
    }
});

loadData();
