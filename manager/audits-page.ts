/** Standalone audit history page for managers — scoped to their agents. */

export function getManagerAuditsPage(): string {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Audit History</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0b0f15;--bg-raised:#111620;--bg-surface:#161c28;--border:#1c2333;--text:#c9d1d9;--text-muted:#6e7681;--text-dim:#484f58;--text-bright:#e6edf3;--blue:#58a6ff;--green:#3fb950;--red:#f85149;--yellow:#d29922;--cyan:#39d0d8;--mono:'SF Mono','Fira Code',monospace}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;gap:16px;padding:0 24px;height:52px;background:var(--bg-raised);border-bottom:1px solid var(--border);flex-shrink:0}
.topbar h1{font-size:14px;font-weight:700;color:var(--text-bright)}
.topbar .back{font-size:11px;color:var(--text-muted);text-decoration:none;padding:4px 10px;border:1px solid var(--border);border-radius:6px;transition:all 0.15s}
.topbar .back:hover{background:var(--bg-surface);color:var(--text)}
.topbar .sub{font-size:11px;color:var(--text-dim);margin-left:auto}
.filters{display:flex;align-items:center;gap:10px;padding:14px 24px;background:var(--bg-raised);border-bottom:1px solid var(--border);flex-wrap:wrap}
.filters label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px}
.filters select,.filters input[type=number]{background:var(--bg);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:11px;padding:5px 8px;font-family:var(--mono)}
.window-btns{display:flex;gap:4px}.window-btn{padding:4px 10px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--text-muted);transition:all 0.15s}.window-btn:hover{background:var(--bg-surface);color:var(--text)}.window-btn.active{background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.5);color:var(--blue)}
.filters select:focus,.filters input:focus{outline:none;border-color:var(--blue)}
.btn{padding:5px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;border:none;transition:all 0.15s}
.btn-primary{background:#1f6feb;color:#fff}.btn-primary:hover{background:#388bfd}
.btn-ghost{background:transparent;color:var(--text-muted);border:1px solid var(--border)}.btn-ghost:hover{background:var(--bg-surface);color:var(--text)}
.content{flex:1;overflow:auto;padding:20px 24px}
.stats-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.stat-card{background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;padding:10px 16px;min-width:120px}
.stat-card .val{font-size:20px;font-weight:700;color:var(--text-bright);line-height:1}
.stat-card .lbl{font-size:10px;color:var(--text-muted);margin-top:3px}
table{width:100%;border-collapse:collapse;font-size:12px}
thead th{text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);padding:6px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
tbody tr{border-bottom:1px solid rgba(28,35,51,0.6);transition:background 0.1s}
tbody tr:hover{background:var(--bg-raised)}
tbody td{padding:8px 12px;color:var(--text);vertical-align:middle}
.mono{font-family:var(--mono);font-size:11px}
.tbl-link{color:var(--blue);text-decoration:none;font-family:var(--mono);font-size:11px}.tbl-link:hover{text-decoration:underline}
.score-green{color:var(--green);font-weight:700}
.score-yellow{color:var(--yellow);font-weight:700}
.score-red{color:var(--red);font-weight:700}
.badge{display:inline-flex;align-items:center;padding:1px 7px;border-radius:10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px}
.pagination{display:flex;align-items:center;gap:8px;padding:16px 0;justify-content:center}
.pagination button{padding:4px 12px;border-radius:5px;font-size:11px;cursor:pointer;border:1px solid var(--border);background:var(--bg-raised);color:var(--text);transition:all 0.15s}
.pagination button:hover:not(:disabled){background:var(--bg-surface)}
.pagination button:disabled{opacity:0.4;cursor:default}
.pagination .page-info{font-size:11px;color:var(--text-muted);padding:0 8px}
.empty{text-align:center;color:var(--text-dim);font-size:12px;padding:40px 0}
.loading{text-align:center;color:var(--text-muted);font-size:12px;padding:40px 0}
.tbl-wrap{background:var(--bg-raised);border:1px solid var(--border);border-radius:10px;overflow:hidden}
</style>
</head><body>
<div class="topbar">
  <a class="back" href="/manager">← Manager</a>
  <h1>Audit History <span id="hdr-window" style="font-weight:400;color:var(--text-muted);">(24h)</span></h1>
  <span class="sub" id="hdr-count">Loading...</span>
</div>
<div class="filters">
  <label>Date Range
    <div class="window-btns">
      <button class="window-btn" data-hours="1">1h</button>
      <button class="window-btn" data-hours="4">4h</button>
      <button class="window-btn" data-hours="12">12h</button>
      <button class="window-btn active-default" data-hours="24">24h</button>
      <button class="window-btn" data-hours="72">3d</button>
      <button class="window-btn" data-hours="168">7d</button>
      <span style="color:var(--text-dim);font-size:10px;margin:0 4px;align-self:center;">or</span>
      <input type="date" id="f-date-start" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;padding:3px 8px;height:26px;">
      <span style="color:var(--text-dim);align-self:center;">–</span>
      <input type="date" id="f-date-end" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:11px;padding:3px 8px;height:26px;">
      <button class="btn btn-primary" id="f-date-go" style="padding:3px 10px;font-size:11px;height:26px;">Go</button>
      <button class="btn btn-ghost" id="f-date-clear" style="padding:3px 8px;font-size:11px;height:26px;display:none;">✕ Clear</button>
    </div>
  </label>
  <label>Team Member
    <select id="f-owner"><option value="">All Members</option></select>
  </label>
  <label>Department
    <select id="f-dept"><option value="">All Departments</option></select>
  </label>
  <label>Shift
    <select id="f-shift"><option value="">All Shifts</option></select>
  </label>
  <label>Reviewed
    <select id="f-reviewed"><option value="">All</option><option value="yes">Reviewed</option><option value="auto">Auto</option><option value="invalid_genie">Invalid Genie</option></select>
  </label>
  <label>Min Score %
    <input type="number" id="f-score-min" value="0" min="0" max="100" style="width:70px">
  </label>
  <label>Max Score %
    <input type="number" id="f-score-max" value="100" min="0" max="100" style="width:70px">
  </label>
  <label style="align-self:flex-end">
    <button class="btn btn-primary" id="apply-btn">Apply Filters</button>
  </label>
  <label style="align-self:flex-end">
    <button class="btn btn-ghost" id="reset-btn">Reset</button>
  </label>
</div>
<div class="content">
  <div class="stats-row" id="stats-row"></div>
  <div class="tbl-wrap">
    <div id="tbl-body" class="loading">Loading...</div>
  </div>
  <div class="pagination" id="pagination" style="display:none"></div>
</div>
<script>
var WINDOW_HOURS = 24;
var state = { page: 1, owner: '', department: '', shift: '', reviewed: '', scoreMin: 0, scoreMax: 100, limit: 50, customStart: null, customEnd: null };
var logsBase = null;
var hm = window.location.hostname.match(/^([^.]+)\\.([^.]+)\\.deno\\.net$/);
if (hm) logsBase = 'https://console.deno.com/' + hm[2] + '/' + hm[1] + '/observability/logs?query=';
var qbDateUrl = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=';
var qbPkgUrl  = 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid=';

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function timeAgo(ts){var d=(Date.now()-ts)/1000;if(d<60)return Math.round(d)+'s ago';if(d<3600)return Math.round(d/60)+'m ago';if(d<86400)return Math.round(d/3600)+'h ago';return Math.round(d/86400)+'d ago'}
function fmtDur(ms){var s=Math.round(ms/1000);if(s<60)return s+'s';var m=Math.floor(s/60),r=s%60;return m+'m'+(r?' '+r+'s':'')}
function fmtTime(ts){return new Date(ts).toLocaleString()}
function scoreHtml(s){
  if(s==null)return '--';
  var cls=s===100?'score-green':s>=80?'score-yellow':'score-red';
  return '<span class="'+cls+'">'+s+'%</span>';
}
function windowLabel(){return WINDOW_HOURS>=168?'7d':WINDOW_HOURS>=72?'3d':WINDOW_HOURS>=24?'24h':WINDOW_HOURS+'h'}

function setWindow(h){
  WINDOW_HOURS=h;
  state.customStart=null;state.customEnd=null;
  document.getElementById('f-date-start').value='';
  document.getElementById('f-date-end').value='';
  document.getElementById('f-date-clear').style.display='none';
  document.querySelectorAll('.window-btn').forEach(function(b){b.classList.toggle('active',+b.getAttribute('data-hours')===h)});
  document.getElementById('hdr-window').textContent='('+windowLabel()+')';
  var ow=document.getElementById('f-owner');while(ow.options.length>1)ow.remove(1);
  var dw=document.getElementById('f-dept');while(dw.options.length>1)dw.remove(1);
  var sw=document.getElementById('f-shift');while(sw.options.length>1)sw.remove(1);
  state.owner='';state.department='';state.shift='';state.page=1;
  ow.value='';dw.value='';sw.value='';
}

function load(){
  var since=state.customStart!==null?state.customStart:Date.now()-WINDOW_HOURS*3600000;
  var p={owner:state.owner,department:state.department,shift:state.shift,reviewed:state.reviewed,scoreMin:state.scoreMin,scoreMax:state.scoreMax,page:state.page,limit:state.limit,since:since};
  if(state.customEnd!==null)p.until=state.customEnd;
  var params=new URLSearchParams(p);
  document.getElementById('tbl-body').innerHTML='<div class="loading">Loading...</div>';
  fetch('/manager/audits/data?'+params)
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.error){document.getElementById('tbl-body').innerHTML='<div class="empty">'+esc(d.error)+'</div>';return;}
      var ow=document.getElementById('f-owner');
      while(ow.options.length>1)ow.remove(1);
      (d.owners||[]).forEach(function(o){var opt=document.createElement('option');opt.value=o;opt.textContent=o;ow.appendChild(opt)});
      if(state.owner&&(d.owners||[]).indexOf(state.owner)===-1){state.owner='';} ow.value=state.owner;
      var dw=document.getElementById('f-dept');
      while(dw.options.length>1)dw.remove(1);
      (d.departments||[]).forEach(function(dep){var opt=document.createElement('option');opt.value=dep;opt.textContent=dep;dw.appendChild(opt)});
      if(state.department&&(d.departments||[]).indexOf(state.department)===-1){state.department='';}dw.value=state.department;
      var sw=document.getElementById('f-shift');
      while(sw.options.length>1)sw.remove(1);
      (d.shifts||[]).forEach(function(s){var opt=document.createElement('option');opt.value=s;opt.textContent=s;sw.appendChild(opt)});
      if(state.shift&&(d.shifts||[]).indexOf(state.shift)===-1){state.shift='';}sw.value=state.shift;
      renderStats(d);
      renderTable(d);
      renderPagination(d);
      document.getElementById('hdr-count').textContent=d.total+' audits in window';
    })
    .catch(function(e){document.getElementById('tbl-body').innerHTML='<div class="empty">Failed to load: '+e.message+'</div>'});
}

function renderStats(d){
  var items=d.items;
  var avgScore=items.length?Math.round(items.reduce(function(a,c){return a+(c.score!=null?c.score:0)},0)/items.length):0;
  var passes=items.filter(function(c){return(c.score!=null?c.score:0)>=80}).length;
  var lbl=document.getElementById('hdr-window').textContent.replace(/[()]/g,'').trim();
  document.getElementById('stats-row').innerHTML=
    stat(d.total,'Total ('+lbl+')')+stat(passes,'≥80% Pass')+stat(items.length-passes,'<80% Fail')+stat(avgScore+'%','Avg Score (page)');
}
function stat(v,l){return '<div class="stat-card"><div class="val">'+v+'</div><div class="lbl">'+l+'</div></div>'}

function renderTable(d){
  if(!d.items.length){document.getElementById('tbl-body').innerHTML='<div class="empty">No audits match the current filters</div>';return}
  var rows=d.items.map(function(c){
    var fid=c.findingId||'--';
    var logsHtml=logsBase?'<a href="'+logsBase+encodeURIComponent(fid)+'&start=now%2Fy&end=now" target="_blank" class="tbl-link">logs</a>':'--';
    var ridHtml='--';
    if(c.recordId){var u=(c.isPackage?qbPkgUrl:qbDateUrl)+encodeURIComponent(c.recordId);ridHtml='<a href="'+u+'" target="_blank" class="tbl-link">'+esc(c.recordId)+'</a>';}
    var dept=c.department?'<span class="mono" style="font-size:10px">'+esc(c.department)+'</span>':'<span style="color:var(--text-dim);font-size:10px">--</span>';
    var ownerLabel=c.voName||(c.owner&&c.owner!=='api'?c.owner.split('@')[0]:'');
    var owner=ownerLabel?'<span class="mono" style="font-size:10px">'+esc(ownerLabel)+'</span>':'<span style="color:var(--text-dim);font-size:10px">--</span>';
    var started=c.startedAt?'<span title="'+fmtTime(c.startedAt)+'">'+timeAgo(c.startedAt)+'</span>':'--';
    var finished='<span title="'+fmtTime(c.ts)+'">'+timeAgo(c.ts)+'</span>';
    var dur=c.durationMs?'<span style="font-variant-numeric:tabular-nums">'+fmtDur(c.durationMs)+'</span>':'--';
    var reviewedBadge='';
    if(c.reason==='perfect_score'){reviewedBadge='<span class="badge" style="background:rgba(63,185,80,0.10);color:#3fb950;border:1px solid rgba(63,185,80,0.25);" title="100% — no review needed">✓ Auto</span>';}
    else if(c.reason==='invalid_genie'){reviewedBadge='<span class="badge" style="background:rgba(110,118,129,0.12);color:#8b949e;border:1px solid rgba(110,118,129,0.3);" title="No recording — no review needed">✓ Auto</span>';}
    else if(c.reviewed){reviewedBadge='<span class="badge" style="background:rgba(63,185,80,0.12);color:#3fb950;border:1px solid rgba(63,185,80,0.3);">✓ Reviewed</span>';}
    return '<tr><td><a href="/audit/report?id='+encodeURIComponent(fid)+'" target="_blank" class="tbl-link">'+esc(fid)+'</a></td><td>'+logsHtml+'</td><td>'+ridHtml+'</td><td>'+dept+'</td><td>'+owner+'</td><td>'+scoreHtml(c.score)+'</td><td>'+started+'</td><td>'+finished+'</td><td>'+dur+'</td><td>'+reviewedBadge+'</td></tr>';
  }).join('');
  document.getElementById('tbl-body').innerHTML='<table><thead><tr><th>Finding ID</th><th>Logs</th><th>QB Record</th><th>Department</th><th>Team Member</th><th>Score</th><th>Started</th><th>Finished</th><th>Duration</th><th>Reviewed</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function renderPagination(d){
  var el=document.getElementById('pagination');
  if(d.pages<=1){el.style.display='none';return}
  el.style.display='flex';
  el.innerHTML='<button id="pg-prev" '+(d.page<=1?'disabled':'')+'>← Prev</button>'+
    '<span class="page-info">Page '+d.page+' of '+d.pages+'</span>'+
    '<button id="pg-next" '+(d.page>=d.pages?'disabled':'')+'>Next →</button>';
  document.getElementById('pg-prev').onclick=function(){if(state.page>1){state.page--;load();}};
  document.getElementById('pg-next').onclick=function(){if(state.page<d.pages){state.page++;load();}};
}

document.getElementById('apply-btn').onclick=function(){
  state.owner=document.getElementById('f-owner').value;
  state.department=document.getElementById('f-dept').value;
  state.shift=document.getElementById('f-shift').value;
  state.reviewed=document.getElementById('f-reviewed').value;
  state.scoreMin=parseInt(document.getElementById('f-score-min').value,10)||0;
  state.scoreMax=parseInt(document.getElementById('f-score-max').value,10)||100;
  state.page=1;load();
};
document.getElementById('reset-btn').onclick=function(){
  state={page:1,owner:'',department:'',shift:'',reviewed:'',scoreMin:0,scoreMax:100,limit:50,customStart:null,customEnd:null};
  document.getElementById('f-reviewed').value='';
  document.getElementById('f-score-min').value=0;
  document.getElementById('f-score-max').value=100;
  setWindow(24);
  load();
};
document.getElementById('f-owner').onchange=function(){state.owner=this.value;state.page=1;load()};
document.getElementById('f-dept').onchange=function(){state.department=this.value;state.page=1;load()};
document.getElementById('f-shift').onchange=function(){state.shift=this.value;state.page=1;load()};
document.getElementById('f-reviewed').onchange=function(){state.reviewed=this.value;state.page=1;load()};
document.querySelectorAll('.window-btn').forEach(function(btn){
  btn.addEventListener('click',function(){setWindow(+this.getAttribute('data-hours'));load();});
});
document.getElementById('f-date-go').addEventListener('click',function(){
  var s=document.getElementById('f-date-start').value;
  var e=document.getElementById('f-date-end').value;
  if(!s||!e){alert('Select both start and end dates');return;}
  if(s>e){alert('Start date must be before end date');return;}
  state.customStart=new Date(s+'T00:00:00').getTime();
  state.customEnd=new Date(e+'T23:59:59').getTime();
  state.page=1;
  document.querySelectorAll('.window-btn').forEach(function(b){b.classList.remove('active')});
  document.getElementById('hdr-window').textContent='('+s+' – '+e+')';
  document.getElementById('f-date-clear').style.display='';
  var ow=document.getElementById('f-owner');while(ow.options.length>1)ow.remove(1);
  var dw=document.getElementById('f-dept');while(dw.options.length>1)dw.remove(1);
  var sw2=document.getElementById('f-shift');while(sw2.options.length>1)sw2.remove(1);
  state.owner='';state.department='';state.shift='';ow.value='';dw.value='';sw2.value='';
  load();
});
document.getElementById('f-date-clear').addEventListener('click',function(){setWindow(24);load();});
setWindow(24);
load();
</script>
</body></html>`;
}
