/** Login page — regular HTML form POST (not HTMX) for proper cookie handling. */
import { define } from "../lib/define.ts";

export default define.page(function LoginPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Auto-Bot - Login</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body class="auth-body">
        <div class="auth-card">
          <div class="auth-logo">Auto-Bot</div>
          <p class="auth-sub">Sign in to your account</p>
          <form method="POST" action="/api/login">
            <div class="form-group">
              <label>Email</label>
              <input type="email" name="email" placeholder="you@example.com" required />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" name="password" required />
            </div>
            <button class="btn btn-primary btn-full" type="submit">Sign In</button>
          </form>
          <p class="auth-link">Need an account? <a href="/register">Create organization</a></p>
        </div>
      </body>
    </html>
  );
});
