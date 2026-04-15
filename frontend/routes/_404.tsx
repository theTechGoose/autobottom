/** Custom 404 page. */
export default function NotFound() {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>404 — Auto-Bot</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body class="auth-body">
        <div class="auth-card" style="text-align:center;">
          <div style="font-size:64px;opacity:0.3;margin-bottom:16px;">404</div>
          <div class="auth-logo">Page Not Found</div>
          <p class="auth-sub" style="margin-bottom:24px;">The page you're looking for doesn't exist.</p>
          <a href="/" class="btn btn-primary">Go Home</a>
        </div>
      </body>
    </html>
  );
}
