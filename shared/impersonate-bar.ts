/** Admin impersonation bar: thin yellow line at top, expands to full bar on hover. */

export function getImpersonateSnippet(targetRole: string, currentAsEmail: string): string {
  return `<style>
#impersonate-bar {
  position:fixed;top:0;left:0;right:0;z-index:99999;
  height:3px;background:#f59e0b;
  overflow:hidden;white-space:nowrap;
  transition:height 0.2s ease, padding 0.2s ease;
  cursor:default;
  font-size:11px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fef3c7;
  display:flex;align-items:center;gap:10px;padding:0 16px;
}
#impersonate-bar:hover {
  height:32px;padding:0 16px;background:#78350f;border-bottom:2px solid #f59e0b;
}
#impersonate-bar > * { opacity:0; transition:opacity 0.15s ease 0s; }
#impersonate-bar:hover > * { opacity:1; transition:opacity 0.15s ease 0.1s; }
</style>
<div id="impersonate-bar">
<span style="font-weight:700;letter-spacing:0.5px;text-transform:uppercase;font-size:9px;color:#fbbf24;flex-shrink:0;">ADMIN VIEW</span>
<span style="color:#fde68a;flex-shrink:0;">Viewing as:</span>
<select id="impersonate-select" style="padding:1px 6px;border-radius:4px;border:1px solid #f59e0b;background:#451a03;color:#fef3c7;font-size:10px;font-family:inherit;cursor:pointer;">
<option value="">-- select ${targetRole} --</option>
</select>
<a id="impersonate-exit" href="#" style="margin-left:auto;color:#fbbf24;font-size:10px;font-weight:600;text-decoration:underline;flex-shrink:0;">Exit Impersonation</a>
</div>
<script>
(function(){
  var currentAs = ${JSON.stringify(currentAsEmail)};
  var targetRole = ${JSON.stringify(targetRole)};
  var sel = document.getElementById('impersonate-select');
  var exitLink = document.getElementById('impersonate-exit');

  exitLink.href = '/admin/dashboard';
  exitLink.addEventListener('click', function(e) {
    e.preventDefault();
    console.log('[IMPERSONATE] Exiting impersonation — currentAs:', currentAs, '| redirecting to /admin/dashboard');
    window.location.href = '/admin/dashboard';
  });

  fetch('/admin/users').then(function(r){return r.json()}).then(function(users){
    var filtered = users.filter(function(u){return u.role === targetRole});
    filtered.forEach(function(u){
      var opt = document.createElement('option');
      opt.value = u.email;
      opt.textContent = u.email;
      if(u.email === currentAs) opt.selected = true;
      sel.appendChild(opt);
    });
  });

  sel.addEventListener('change', function(){
    var email = sel.value;
    if(!email) return;
    var u = new URL(location.href);
    u.searchParams.set('as', email);
    location.href = u.href;
  });

  if(currentAs){
    var origFetch = window.fetch;
    window.fetch = function(input, init){
      if(typeof input === 'string' && input.startsWith('/')) {
        var u = new URL(input, location.origin);
        if(!u.searchParams.has('as')) u.searchParams.set('as', currentAs);
        input = u.pathname + u.search;
      } else if(input instanceof URL && input.origin === location.origin) {
        if(!input.searchParams.has('as')) input.searchParams.set('as', currentAs);
      } else if(input instanceof Request && new URL(input.url).origin === location.origin) {
        var ru = new URL(input.url);
        if(!ru.searchParams.has('as')) ru.searchParams.set('as', currentAs);
        input = new Request(ru.href, input);
      }
      return origFetch.call(this, input, init);
    };
  }
})();
</script>`;
}
