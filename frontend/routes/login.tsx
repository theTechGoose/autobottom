/** Login page — email + password form, posts to /api/login. */
import { define } from "../lib/define.ts";
import type { State } from "../lib/auth.ts";

export default define.page(function LoginPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Auto-Bot - Login</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4" crossorigin="anonymous"></script>
      </head>
      <body class="auth-body">
        <div class="auth-card">
          <div class="auth-logo">Auto-Bot</div>
          <p class="auth-sub">Sign in to your account</p>
          <form
            hx-post="/api/login"
            hx-target="#error"
            hx-swap="innerHTML"
            hx-indicator="#btn"
          >
            <div class="form-group">
              <label>Email</label>
              <input type="email" name="email" placeholder="you@example.com" required />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" name="password" required />
            </div>
            <button class="btn btn-primary btn-full" type="submit" id="btn">Sign In</button>
            <div id="error" class="auth-error"></div>
          </form>
          <p class="auth-link">Need an account? <a href="/register">Create organization</a></p>
        </div>
      </body>
    </html>
  );
});
