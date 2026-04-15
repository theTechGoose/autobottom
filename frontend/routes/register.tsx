/** Register page — org name, email, password form, posts to /api/register. */
import { define } from "../lib/define.ts";
import type { State } from "../lib/auth.ts";

export default define.page(function RegisterPage() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Auto-Bot - Register</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4" crossorigin="anonymous"></script>
      </head>
      <body class="auth-body">
        <div class="auth-card">
          <div class="auth-logo">Auto-Bot</div>
          <p class="auth-sub">Create your organization</p>
          <form
            hx-post="/api/register"
            hx-target="#error"
            hx-swap="innerHTML"
            hx-indicator="#btn"
          >
            <div class="form-group">
              <label>Organization Name</label>
              <input type="text" name="orgName" placeholder="My Company" required />
            </div>
            <div class="form-group">
              <label>Admin Email</label>
              <input type="email" name="email" placeholder="admin@example.com" required />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" name="password" placeholder="Min 6 characters" minlength={6} required />
            </div>
            <button class="btn btn-primary btn-full" type="submit" id="btn">Create Organization</button>
            <div id="error" class="auth-error"></div>
          </form>
          <p class="auth-link">Already have an account? <a href="/login">Sign in</a></p>
        </div>
      </body>
    </html>
  );
});
