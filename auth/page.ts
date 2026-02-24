/** Registration + Login HTML pages. */

export function getRegisterPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Bot - Register</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0e14;--bg-raised:#111820;--border:#1a2030;--text:#c9d1d9;--text-muted:#6e7681;--text-dim:#484f58;--text-bright:#e6edf3;--blue:#58a6ff;--blue-bg:rgba(31,111,235,0.10);--green:#3fb950;--red:#f85149;--mono:'SF Mono','Fira Code',monospace}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{width:100%;max-width:400px;padding:0 24px}
  .logo{font-size:22px;font-weight:800;color:var(--text-bright);margin-bottom:4px;letter-spacing:-0.5px}
  .sub{font-size:13px;color:var(--text-dim);margin-bottom:32px}
  .form-group{margin-bottom:16px}
  label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px}
  input{width:100%;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:10px 14px;font-size:14px;outline:none;transition:border-color .15s}
  input:focus{border-color:var(--blue)}
  .btn{width:100%;background:var(--blue);color:#fff;border:none;border-radius:8px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s;margin-top:8px}
  .btn:hover{opacity:0.9}
  .btn:disabled{opacity:0.4;cursor:default}
  .error{color:var(--red);font-size:12px;margin-top:8px;display:none}
  .link{text-align:center;margin-top:20px;font-size:13px;color:var(--text-muted)}
  .link a{color:var(--blue);text-decoration:none}
  .link a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
  <div class="logo">Auto-Bot</div>
  <p class="sub">Create your organization</p>
  <form id="form" onsubmit="return handleRegister(event)">
    <div class="form-group">
      <label>Organization Name</label>
      <input type="text" id="orgName" placeholder="My Company" required />
    </div>
    <div class="form-group">
      <label>Admin Email</label>
      <input type="email" id="email" placeholder="admin@example.com" required />
    </div>
    <div class="form-group">
      <label>Password</label>
      <input type="password" id="password" placeholder="Min 6 characters" minlength="6" required />
    </div>
    <button class="btn" type="submit" id="btn">Create Organization</button>
    <div class="error" id="error"></div>
  </form>
  <p class="link">Already have an account? <a href="/login">Sign in</a></p>
</div>
<script>
function handleRegister(e) {
  e.preventDefault();
  var btn = document.getElementById('btn');
  var err = document.getElementById('error');
  btn.disabled = true;
  btn.textContent = 'Creating...';
  err.style.display = 'none';

  fetch('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: document.getElementById('orgName').value.trim(),
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    }),
  })
  .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
  .then(function(res) {
    if (!res.ok) {
      err.textContent = res.data.error || 'Registration failed';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Create Organization';
      return;
    }
    window.location.href = res.data.redirect || '/admin/dashboard';
  })
  .catch(function() {
    err.textContent = 'Network error';
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Create Organization';
  });

  return false;
}
</script>
</body>
</html>`;
}

export function getLoginPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto-Bot - Login</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0a0e14;--bg-raised:#111820;--border:#1a2030;--text:#c9d1d9;--text-muted:#6e7681;--text-dim:#484f58;--text-bright:#e6edf3;--blue:#58a6ff;--blue-bg:rgba(31,111,235,0.10);--green:#3fb950;--red:#f85149;--mono:'SF Mono','Fira Code',monospace}
  body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{width:100%;max-width:400px;padding:0 24px}
  .logo{font-size:22px;font-weight:800;color:var(--text-bright);margin-bottom:4px;letter-spacing:-0.5px}
  .sub{font-size:13px;color:var(--text-dim);margin-bottom:32px}
  .form-group{margin-bottom:16px}
  label{display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-dim);margin-bottom:6px}
  input{width:100%;background:var(--bg-raised);border:1px solid var(--border);border-radius:8px;color:var(--text-bright);padding:10px 14px;font-size:14px;outline:none;transition:border-color .15s}
  input:focus{border-color:var(--blue)}
  .btn{width:100%;background:var(--blue);color:#fff;border:none;border-radius:8px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;transition:opacity .15s;margin-top:8px}
  .btn:hover{opacity:0.9}
  .btn:disabled{opacity:0.4;cursor:default}
  .error{color:var(--red);font-size:12px;margin-top:8px;display:none}
  .link{text-align:center;margin-top:20px;font-size:13px;color:var(--text-muted)}
  .link a{color:var(--blue);text-decoration:none}
  .link a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
  <div class="logo">Auto-Bot</div>
  <p class="sub">Sign in to your account</p>
  <form id="form" onsubmit="return handleLogin(event)">
    <div class="form-group">
      <label>Email</label>
      <input type="email" id="email" placeholder="you@example.com" required />
    </div>
    <div class="form-group">
      <label>Password</label>
      <input type="password" id="password" required />
    </div>
    <button class="btn" type="submit" id="btn">Sign In</button>
    <div class="error" id="error"></div>
  </form>
  <p class="link">Need an account? <a href="/register">Create organization</a></p>
</div>
<script>
var ROLE_REDIRECTS = {
  admin: '/admin/dashboard',
  judge: '/judge/dashboard',
  manager: '/manager',
  reviewer: '/review/dashboard',
  user: '/agent',
};

function handleLogin(e) {
  e.preventDefault();
  var btn = document.getElementById('btn');
  var err = document.getElementById('error');
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  err.style.display = 'none';

  fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: document.getElementById('email').value.trim(),
      password: document.getElementById('password').value,
    }),
  })
  .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
  .then(function(res) {
    if (!res.ok) {
      err.textContent = res.data.error || 'Invalid credentials';
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign In';
      return;
    }
    window.location.href = res.data.redirect || ROLE_REDIRECTS[res.data.role] || '/';
  })
  .catch(function() {
    err.textContent = 'Network error';
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign In';
  });

  return false;
}
</script>
</body>
</html>`;
}
