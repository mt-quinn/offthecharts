import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Bungee, Space_Grotesk } from "next/font/google";

const display = Bungee({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

const body = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Off the Charts",
  description: "Daily word-association game",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // Hard-lock the page scale as much as the browser allows.
                // 1) Block pinch-zoom and double-tap zoom gestures.
                document.addEventListener('gesturestart', function (e) {
                  e.preventDefault();
                }, { passive: false });
                document.addEventListener('gesturechange', function (e) {
                  e.preventDefault();
                }, { passive: false });
                document.addEventListener('gestureend', function (e) {
                  e.preventDefault();
                }, { passive: false });

                var lastTouchEnd = 0;
                document.addEventListener('touchend', function (e) {
                  var now = Date.now();
                  if (now - lastTouchEnd <= 300) {
                    e.preventDefault();
                  }
                  lastTouchEnd = now;
                }, { passive: false });

                // 2) Use the VisualViewport API to actively neutralize any zoom
                // scale that the browser applies (including on input focus).
                function normalizeViewport() {
                  if (!window.visualViewport) {
                    window.scrollTo(0, 0);
                    return;
                  }

                  var vv = window.visualViewport;
                  var scale = vv.scale || 1;
                  var offsetX = vv.offsetLeft || 0;
                  var offsetY = vv.offsetTop || 0;
                  var docEl = document.documentElement;

                  if (scale !== 1 || offsetX !== 0 || offsetY !== 0) {
                    // Counteract the browser's zoom by applying the inverse
                    // transform to the entire document. This keeps the apparent
                    // scale and position of the game stable even when the
                    // keyboard opens, inputs focus, or the user pinches.
                    docEl.style.transformOrigin = 'top left';
                    docEl.style.transform =
                      'translate(' + offsetX + 'px,' + offsetY + 'px) scale(' + (1 / scale) + ')';
                  } else {
                    docEl.style.transform = '';
                    docEl.style.transformOrigin = '';
                  }

                  // Also make sure we stay pinned to the top-left of the page.
                  window.scrollTo(0, 0);
                }

                document.addEventListener('focusin', function (e) {
                  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                    setTimeout(normalizeViewport, 0);
                  }
                });

                if (window.visualViewport) {
                  var vv = window.visualViewport;
                  vv.addEventListener('resize', normalizeViewport);
                  vv.addEventListener('scroll', normalizeViewport);
                  normalizeViewport();
                }

                window.addEventListener('orientationchange', function () {
                  setTimeout(normalizeViewport, 0);
                });
              })();
            `,
          }}
        />
      </head>
      <body className="min-h-screen flex items-stretch justify-center">
        <div className="flex w-full max-w-md mx-auto px-3 py-4 sm:max-w-lg sm:px-4">
          <div className="relative flex-1 rounded-3xl bg-otc-surface/90 shadow-otc-card border border-white/10 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 opacity-30 mix-blend-screen bg-[radial-gradient(circle_at_10%_0%,#ffbf69_0,#ff5fa200_60%),radial-gradient(circle_at_90%_100%,#5cf2ff_0,#5cf2ff00_55%)]" />
            <main className="relative pointer-events-auto h-full w-full flex flex-col">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
