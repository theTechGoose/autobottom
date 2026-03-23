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
.window-btns{display:flex;gap:4px}
.window-btn{padding:4px 10px;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;border:1px solid var(--border);background:var(--bg);color:var(--text-muted);transition:all 0.15s}
.window-btn:hover{background:var(--bg-surface);color:var(--text)}
.window-btn.active{background:rgba(88,166,255,0.15);border-color:rgba(88,166,255,0.5);color:var(--blue)}
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
.badge-pkg{background:rgba(251,191,36,0.12);color:#fbbf24;border:1px solid rgba(251,191,36,0.3)}
.badge-dl{background:rgba(88,166,255,0.12);color:var(--blue);border:1px solid rgba(88,166,255,0.25)}
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
      <button class="window-btn active" data-hours="24">24h</button>
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
  <label>Shift
    <select id="f-shift"><option value="">All Shifts</option></select>
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
var state = { page: 1, owner: '', shift: '', scoreMin: 0, scoreMax: 100, limit: 50, customStart: null, customEnd: null };

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

function buildQuery(){
  var params = 'limit='+state.limit+'&page='+state.page;
  if(state.customStart && state.customEnd){
    params += '&since='+state.customStart+'&until='+state.customEnd;
  } else {
    params += '&since='+(Date.now()-WINDOW_HOURS*3600000);
  }
  if(state.owner) params += '&owner='+encodeURIComponent(state.owner);
  if(state.shift) params += '&shift='+encodeURIComponent(state.shift);
  params += '&scoreMin='+state.scoreMin+'&scoreMax='+state.scoreMax;
  return params;
}

function populateSelect(id, values, currentVal, emptyLabel){
  var sel = document.getElementById(id);
  var prev = currentVal || sel.value;
  sel.innerHTML = '<option value="">'+emptyLabel+'</option>';
  values.forEach(function(v){
    var opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    if(v === prev) opt.selected = true;
    sel.appendChild(opt);
  });
}

function load(){
  document.getElementById('tbl-body').innerHTML = '<div class="loading">Loading...</div>';
  document.getElementById('pagination').style.display = 'none';
  fetch('/manager/audits/data?'+buildQuery())
    .then(function(r){return r.json()})
    .then(function(d){
      if(d.error){document.getElementById('tbl-body').innerHTML='<div class="empty">'+esc(d.error)+'</div>';return;}
      populateSelect('f-owner', d.owners||[], state.owner, 'All Members');
      populateSelect('f-shift', d.shifts||[], state.shift, 'All Shifts');
      renderStats(d);
      renderTable(d.items||[]);
      renderPagination(d.total, d.pages, d.page);
      var label = state.customStart ? 'custom range' : windowLabel();
      document.getElementById('hdr-window').textContent = '('+label+')';
      document.getElementById('hdr-count').textContent = d.total+' audit'+(d.total===1?'':'s');
    })
    .catch(function(e){document.getElementById('tbl-body').innerHTML='<div class="empty">Error: '+esc(String(e))+'</div>';});
}

function renderStats(d){
  var items = d.items || [];
  var allInWindow = d.total;
  var pass = (d.items||[]).filter(function(c){return c.score!=null&&c.score>=80}).length;
  var fail = (d.items||[]).filter(function(c){return c.score!=null&&c.score<80}).length;
  var scores = (d.items||[]).filter(function(c){return c.score!=null}).map(function(c){return c.score});
  var avg = scores.length ? Math.round(scores.reduce(function(a,b){return a+b},0)/scores.length) : null;
  document.getElementById('stats-row').innerHTML =
    stat(allInWindow,'Total')+
    stat(pass,'≥80% Pass','color:var(--green)')+
    stat(fail,'<80% Fail','color:var(--red)')+
    (avg!=null?stat(avg+'%','Avg Score'):'');
}
function stat(v,l,style){return '<div class="stat-card"><div class="val"'+(style?' style="'+style+'"':'')+'>'+v+'</div><div class="lbl">'+l+'</div></div>';}

function renderTable(items){
  if(!items.length){document.getElementById('tbl-body').innerHTML='<div class="empty">No audits in this window</div>';return;}
  var html='<table><thead><tr>'+
    '<th>Finding ID</th><th>QB Record</th><th>Type</th><th>Team Member</th><th>Shift</th><th>Score</th><th>Started</th><th>Duration</th>'+
    '</tr></thead><tbody>';
  items.forEach(function(c){
    var qbBase = c.isPackage
      ? 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bttffb64u/action/dr?rid='
      : 'https://monsterrg.quickbase.com/nav/app/bmhvhc7sk/table/bpb28qsnn/action/dr?rid=';
    var qbLink = c.recordId ? '<a class="tbl-link" href="'+qbBase+esc(c.recordId)+'" target="_blank">'+esc(c.recordId)+'</a>' : '--';
    var typeBadge = c.isPackage
      ? '<span class="badge badge-pkg">Partner</span>'
      : '<span class="badge badge-dl">Internal</span>';
    html += '<tr>'+
      '<td class="mono">'+esc(c.findingId.slice(0,8))+'…</td>'+
      '<td>'+qbLink+'</td>'+
      '<td>'+typeBadge+'</td>'+
      '<td>'+esc(c.owner||'--')+'</td>'+
      '<td>'+esc(c.shift||'--')+'</td>'+
      '<td>'+scoreHtml(c.score)+'</td>'+
      '<td style="color:var(--text-muted);font-size:11px;">'+timeAgo(c.ts)+'</td>'+
      '<td style="color:var(--text-muted);font-size:11px;">'+(c.durationMs?fmtDur(c.durationMs):'--')+'</td>'+
      '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('tbl-body').innerHTML = html;
}

function renderPagination(total, pages, page){
  var el = document.getElementById('pagination');
  if(pages<=1){el.style.display='none';return;}
  el.style.display='flex';
  el.innerHTML =
    '<button '+(page<=1?'disabled':'')+' id="pg-prev">← Prev</button>'+
    '<span class="page-info">Page '+page+' of '+pages+' ('+total+' total)</span>'+
    '<button '+(page>=pages?'disabled':'')+' id="pg-next">Next →</button>';
  var p=page,ps=pages;
  el.querySelector('#pg-prev').addEventListener('click',function(){if(p>1){state.page=p-1;load();}});
  el.querySelector('#pg-next').addEventListener('click',function(){if(p<ps){state.page=p+1;load();}});
}

// Window buttons
document.querySelectorAll('.window-btn').forEach(function(btn){
  btn.addEventListener('click',function(){
    document.querySelectorAll('.window-btn').forEach(function(b){b.classList.remove('active');});
    this.classList.add('active');
    WINDOW_HOURS = parseInt(this.getAttribute('data-hours'),10);
    state.page=1; state.customStart=null; state.customEnd=null;
    document.getElementById('f-date-start').value='';
    document.getElementById('f-date-end').value='';
    document.getElementById('f-date-clear').style.display='none';
    load();
  });
});

// Custom date range
document.getElementById('f-date-go').addEventListener('click',function(){
  var s=document.getElementById('f-date-start').value;
  var e=document.getElementById('f-date-end').value;
  if(!s||!e)return;
  state.customStart=new Date(s+'T00:00:00').getTime();
  state.customEnd=new Date(e+'T23:59:59').getTime();
  state.page=1;
  document.querySelectorAll('.window-btn').forEach(function(b){b.classList.remove('active');});
  document.getElementById('f-date-clear').style.display='';
  load();
});
document.getElementById('f-date-clear').addEventListener('click',function(){
  state.customStart=null; state.customEnd=null;
  document.getElementById('f-date-start').value='';
  document.getElementById('f-date-end').value='';
  this.style.display='none';
  document.querySelector('.window-btn[data-hours="24"]').classList.add('active');
  WINDOW_HOURS=24; state.page=1; load();
});

// Apply / Reset
document.getElementById('apply-btn').addEventListener('click',function(){
  state.owner=document.getElementById('f-owner').value;
  state.shift=document.getElementById('f-shift').value;
  state.scoreMin=parseInt(document.getElementById('f-score-min').value||'0',10);
  state.scoreMax=parseInt(document.getElementById('f-score-max').value||'100',10);
  state.page=1; load();
});
document.getElementById('reset-btn').addEventListener('click',function(){
  state={page:1,owner:'',shift:'',scoreMin:0,scoreMax:100,limit:50,customStart:null,customEnd:null};
  WINDOW_HOURS=24;
  document.getElementById('f-owner').value='';
  document.getElementById('f-shift').value='';
  document.getElementById('f-score-min').value='0';
  document.getElementById('f-score-max').value='100';
  document.getElementById('f-date-start').value='';
  document.getElementById('f-date-end').value='';
  document.getElementById('f-date-clear').style.display='none';
  document.querySelectorAll('.window-btn').forEach(function(b){b.classList.remove('active');});
  document.querySelector('.window-btn[data-hours="24"]').classList.add('active');
  load();
});

load();
</script>
</body></html>`;
}
