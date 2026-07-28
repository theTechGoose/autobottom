/** Page layout shell — html head, HTMX, CSS, sidebar + main content area. */
import type { ComponentChildren } from "preact";
import type { User, GameStateLite } from "../lib/auth.ts";
import { getTheme } from "../lib/theme.ts";
import { Sidebar, type SbDept } from "./Sidebar.tsx";
import ImpersonationBanner from "../islands/ImpersonationBanner.tsx";
import ModalController from "../islands/ModalController.tsx";
import EventToaster from "../islands/EventToaster.tsx";

interface LayoutProps {
  title?: string;
  section?: string;
  user?: User;
  children: ComponentChildren;
  hideSidebar?: boolean;
  /** Current pathname — used by the Sidebar for exact-match active states.
   *  Pass `new URL(ctx.req.url).pathname` from the route. */
  pathname?: string;
  /** Prefetched game-state for the current user (from middleware). When
   *  present, Sidebar renders equipped cosmetics on the avatar block. */
  gameState?: GameStateLite;
  /** Department cards that replace the sidebar nav (Operations Portal only). */
  depts?: SbDept[];
}

export function Layout({ title, section, user, children, hideSidebar, pathname, gameState, depts }: LayoutProps) {
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
      <body
        hx-on--after-request="if(event.detail.xhr && event.detail.xhr.status===401) window.location='/login'"
        data-user-email={user?.email ?? ""}
      >
        <ImpersonationBanner />
        <ModalController />
        {user && <EventToaster />}
        {!hideSidebar && user && <Sidebar user={user} section={section ?? ""} pathname={pathname} gameState={gameState} depts={depts} />}
        <main class={hideSidebar ? "main-full" : "main"}>
          {children}
        </main>
      </body>
    </html>
  );
}
