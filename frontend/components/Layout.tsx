/** Page layout shell — html head, HTMX, CSS, sidebar + main content area. */
import type { ComponentChildren } from "preact";
import type { User } from "../lib/auth.ts";
import { getTheme } from "../lib/theme.ts";
import { Sidebar } from "./Sidebar.tsx";

interface LayoutProps {
  title?: string;
  section?: string;
  user?: User;
  children: ComponentChildren;
  hideSidebar?: boolean;
  /** Current pathname — used by the Sidebar for exact-match active states.
   *  Pass `new URL(ctx.req.url).pathname` from the route. */
  pathname?: string;
}

export function Layout({ title, section, user, children, hideSidebar, pathname }: LayoutProps) {
  const theme = getTheme(section ?? "admin");
  const pageTitle = title ? `${title} — Auto-Bot` : "Auto-Bot";

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{pageTitle}</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/styles.css" />
        <script src="https://unpkg.com/htmx.org@2.0.4" crossorigin="anonymous"></script>
        <style dangerouslySetInnerHTML={{ __html: `:root { --accent: ${theme.accent}; --accent-bg: ${theme.accentBg}; }` }} />
      </head>
      <body hx-on--after-request="if(event.detail.xhr && event.detail.xhr.status===401) window.location='/login'">
        {!hideSidebar && user && <Sidebar user={user} section={section ?? ""} pathname={pathname} />}
        <main class={hideSidebar ? "main-full" : "main"}>
          {children}
        </main>
      </body>
    </html>
  );
}
