const sheetId = '1JcITqKR5NZ6Ulavf43Ikz9vBc8gDCTA76X7dE9713TI';
const gids = [370233430];
const breakSheetId = '11scN38eNhFZU4w6pxzk95ZnAd3pveP4v2sPTTWcOhyk';
const breakGid = 1793971504;
const percentCols = ["WAIT %","TALK TIME %","DISPOTIME %","PAUSETIME %","DEAD TIME %"];
const fcMetrics = ["CONNECTED","ACW","COH","IT","MAN","DISPO"];
const pauseMetrics = ["Exc","BRK30"];
let jsonData = [];
let headers = [];
let breaksData = [];

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
  return p[0]*3600 + p[1]*60 + (p[2]||0);
}
function secondsToTime(sec){
  const h=Math.floor(sec/3600).toString().padStart(2,'0');
  const m=Math.floor((sec%3600)/60).toString().padStart(2,'0');
  const s=(sec%60).toString().padStart(2,'0');
  return `${h}:${m}:${s}`;
}

async function fetchSheetData(gid){
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}`;
  const res = await fetch(url);
  const text = await res.text();
  const json = JSON.parse(text.substring(47,text.length-2));
  const cols = json.table.cols.map(c => c.label||'');
  const rows = json.table.rows.map(r => r.c.map(c=>formatTime(c?.v||"")));
  return {cols, rows};
}

async function fetchBreaksData(){
  const url = `https://docs.google.com/spreadsheets/d/${breakSheetId}/gviz/tq?tqx=out:json&gid=${breakGid}`;
  const res = await fetch(url);
  const text = await res.text();
  const json = JSON.parse(text.substring(47,text.length-2));
  breaksData = json.table.rows.map(r => ({
    id: r.c[0]?.v || '',
    originalShift: r.c[3]?.v || '',
    firstBreak: r.c[7]?.v || '',
    secondBreak: r.c[8]?.v || '',
  }));
}

async function loadData(){
  const allData=[];
  for(const gid of gids) allData.push(await fetchSheetData(gid));
  headers = allData[0].cols;
  const combined={};

  allData.forEach(sheet=>{
    sheet.rows.forEach(r=>{
      const key = String(r[1]||"")+"__"+String(r[0]||"");
      if(!combined[key]) combined[key]=r.slice();
      else{
        for(let i=2;i<r.length;i++){
          const val = r[i];
          if(typeof val==='string' && val.includes(":")){
            combined[key][i]=secondsToTime(timeToSeconds(combined[key][i])+timeToSeconds(val));
          } else if(!isNaN(parseFloat(val))){
            combined[key][i]=(parseFloat(combined[key][i])+parseFloat(val)).toString();
          }
        }
      }
    });
  });

  if(!headers.includes("Final Connect")) headers.push("Final Connect");

  jsonData = Object.values(combined);
  document.getElementById("searchBtn").disabled=false;
  await fetchBreaksData();
}

function animateNumber(element, targetValue, callback){
  let current = 0;
  const step = Math.ceil(targetValue/50) || 1;
  const interval = setInterval(()=>{
    current += step;
    if(current >= targetValue){
      current = targetValue;
      clearInterval(interval);
    }
    if(callback) callback(current);
  },20);
}

document.getElementById("searchBtn").addEventListener("click", async ()=>{
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
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
    const name=String(r[0]||"").trim().toLowerCase();
    const id=String(r[1]||"").trim().toLowerCase();
    return name.includes(query)||id.includes(query);
  });

  const filteredBreaks = breaksData.filter(b => String(b.id||"").toLowerCase() === query);

  if(filteredMain.length===0 && filteredBreaks.length===0){
    document.getElementById("noData").style.display="block";
    return;
  }

  filteredMain.forEach(agent=>{
    const agentHeader=document.createElement("div");
    agentHeader.className="agentHeader";
    const callsIdx = headers.indexOf("CALLS");
    const callsVal = callsIdx>=0 ? parseInt(agent[callsIdx]) : 0;

    const talkIdx = headers.indexOf("TALK");
    const acwIdx = headers.indexOf("ACW");
    const talkSec = talkIdx>=0 ? timeToSeconds(agent[talkIdx]) : 0;
    const acwSec = acwIdx>=0 ? timeToSeconds(agent[acwIdx]) : 0;
    const aht = callsVal > 0 ? secondsToTime(Math.floor((talkSec + acwSec)/callsVal)) : "0:00:00";

    agentHeader.textContent = `Name: ${agent[0]} | ID: ${agent[1]} | CALLS: 0 | AHT: ${aht}`;
    headerContainer.appendChild(agentHeader);

    animateNumber(agentHeader, callsVal,(current)=>{
      const currentAHT = current>0 ? secondsToTime(Math.floor((talkSec + acwSec)/current)) : "0:00:00";
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
    const totalFC = fcValues.reduce((a,b)=>a+b,0);

    fcMetrics.forEach((metric,i)=>{
      const barLabel=document.createElement("div");
      barLabel.className="barLabel";
      const percent = ((fcValues[i]/totalFC)*100).toFixed(1);
      barLabel.innerHTML=`<span>${metric}</span><span>0:00:00 (0%)</span>`;
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
        const step = Math.ceil(fcValues[i]/50) || 1;
        const interval = setInterval(()=>{
          currentSec += step;
          if(currentSec >= fcValues[i]){
            currentSec = fcValues[i];
            clearInterval(interval);
          }
          barLabel.children[1].textContent = `${secondsToTime(currentSec)} (${((currentSec/totalFC)*100).toFixed(1)}%)`;
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

    const pauseColors=["#ff3333","#ff9900"];
    const pauseValues=pauseMetrics.map(m=>{
      const idx=headers.indexOf(m);
      return idx>=0 ? timeToSeconds(agent[idx]) : 0;
    });
    const totalPause = pauseValues.reduce((a,b)=>a+b,0);

    pauseMetrics.forEach((metric,i)=>{
      const barLabel=document.createElement("div");
      barLabel.className="barLabel";
      const percent = ((pauseValues[i]/totalPause)*100).toFixed(1);
      barLabel.innerHTML=`<span>${metric}</span><span>0:00:00 (0%)</span>`;
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
        const step = Math.ceil(pauseValues[i]/50) || 1;
        const interval = setInterval(()=>{
          currentSec += step;
          if(currentSec >= pauseValues[i]){
            currentSec = pauseValues[i];
            clearInterval(interval);
          }
          barLabel.children[1].textContent = `${secondsToTime(currentSec)} (${((currentSec/totalPause)*100).toFixed(1)}%)`;
        },20);
      },100);
    });

    pauseContainer.appendChild(pauseDiv);
    animateNumber(pauseTotal,totalPause,(val)=>{ pauseTotal.textContent = secondsToTime(val); });

    // --- Breaks ---
    const agentId = String(agent[1]||"");
    const breakInfo = breaksData.find(b => String(b.id||"") === agentId);
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

  // إنشاء div جديد للـ Original Shift
  const originalShiftEl = document.createElement('div');
  originalShiftEl.id = 'originalShiftDiv';
  originalShiftEl.style.color = '#ffcc00';
  originalShiftEl.style.textShadow = '0 0 10px #ffcc00';
  originalShiftEl.style.fontWeight = 'bold';
  originalShiftEl.style.marginBottom = '5px';
  originalShiftEl.textContent = `Shift: ${breakInfo.originalShift || '—'}`;

  // ضعه أول عنصر في الـ breaksContainer
  breaksContainer.insertBefore(originalShiftEl, breaksContainer.firstChild);
       
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

    agent.forEach((val,index)=>{
      const colName=headers[index];
      if(index<2) return;
      if(index > 29) return;
      if(fcMetrics.includes(colName)) return;
      if(pauseMetrics.includes(colName)) return;
      if(colName==="Final Connect") return;
      if(colName==="CALLS") return;
      const row=document.createElement("tr");
      const td1=document.createElement("td"); td1.textContent=colName;
      const td2=document.createElement("td");
      if(percentCols.includes(colName)) td2.textContent=(parseFloat(val)*100).toFixed(2)+"%";
      else td2.textContent=val;
      row.appendChild(td1); row.appendChild(td2);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    card.appendChild(table);
    container.appendChild(card);
  });


  // --- لو فيه بيانات بس في breaks sheet ---
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
  firstBreakEl.textContent = formatBreakTime(breakInfo.firstBreak);
  secondBreakEl.textContent = formatBreakTime(breakInfo.secondBreak);
  breaksContainer.style.display='block';
}

});

// تنفيذ البحث عند الضغط على Enter
document.getElementById("searchInput").addEventListener("keypress", function(e) {
    if (e.key === "Enter") {
        document.getElementById("searchBtn").click();
    }
});

loadData();
