"use client";
import Link from "next/link";
import { useState, useEffect, useRef, ReactNode, FC } from "react";
import { useUser } from "@clerk/nextjs";

// ─── Design Tokens ───────────────────────────────────────────────
const C = {
  primary:    "#7F77DD",
  primaryDark:"#534AB7",
  primaryLight:"#a09ae8",
  primaryBg:  "#EEEDFE",
  primaryMid: "#c9c6f5",
  heading:    "#3C3489",
  ink:        "#18181b",
  inkMid:     "#27272a",
  muted:      "#71717a",
  subtle:     "#a1a1aa",
  border:     "#e4e4e7",
  borderMid:  "#d4d4d8",
  surface:    "#ffffff",
  surfaceAlt: "#fafafa",
  bg:         "#f9f9fb",
  passText:   "#1D9E75",
  passBg:     "#E1F5EE",
  failText:   "#D85A30",
  failBg:     "#FAECE7",
  neon:       "#7F77DD",
} as const;

// ─── Hooks ────────────────────────────────────────────────────────
function useInView(threshold = 0.12): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) setInView(true); },
      { threshold }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  //@ts-ignore
  return [ref, inView];
}

function useScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    const fn = () => setY(window.scrollY);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);
  return y;
}

function useCounter(target: number, active: boolean): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    const dur = 1600, fps = 60, steps = (dur / 1000) * fps;
    let i = 0;
    const id = setInterval(() => {
      i++;
      const ease = 1 - Math.pow(1 - i / steps, 3);
      setVal(Math.round(target * ease));
      if (i >= steps) { setVal(target); clearInterval(id); }
    }, 1000 / fps);
    return () => clearInterval(id);
  }, [active, target]);
  return val;
}

// ─── Components ───────────────────────────────────────────────────

interface GlowCardProps {
  children: ReactNode;
  accent?: string;
  style?: React.CSSProperties;
  className?: string;
}

interface BadgeProps { children: ReactNode }
const GreenBadge: FC<BadgeProps> = ({ children }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 7,
    padding: "5px 13px 5px 10px", borderRadius: 999,
    background: C.primaryBg, border: `1px solid ${C.primaryMid}`,
    fontSize: 12, fontFamily: "'Geist', sans-serif", fontWeight: 500,
    color: C.primaryDark, letterSpacing: "0.01em",
    position: "relative", overflow: "hidden",
  }}>
    <span style={{
      position: "absolute", top: 0, left: "-100%", width: "55%", height: "100%",
      background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
      animation: "shimmer 2.8s infinite",
    }} />
    {children}
  </span>
);

interface MagicButtonProps {
  children: ReactNode;
  primary?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
}
const MagicButton: FC<MagicButtonProps> = ({ children, primary = true, onClick, style = {} }) => {
  const [hov, setHov] = useState(false);
  return primary ? (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'Geist', sans-serif", fontWeight: 500, fontSize: 14,
        padding: "11px 24px", borderRadius: 8, border: "none", cursor: "pointer",
        background: C.primaryDark,
        color: "#fff",
        boxShadow: hov
          ? `0 0 0 1px ${C.primary}44, 0 0 20px ${C.primary}55, 0 0 40px ${C.primary}22`
          : `0 0 12px ${C.primary}33`,
        transform: hov ? "translateY(-1px)" : "none",
        transition: "all 0.2s ease",
        letterSpacing: "0.01em",
        ...style,
      }}
    >{children}</button>
  ) : (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: "'Geist', sans-serif", fontWeight: 500, fontSize: 14,
        padding: "10px 22px", borderRadius: 8, cursor: "pointer",
        background: hov ? C.primaryBg : C.surface,
        color: C.inkMid, border: `1px solid ${hov ? C.primaryMid : C.border}`,
        transform: hov ? "translateY(-1px)" : "none",
        transition: "all 0.2s ease",
        letterSpacing: "0.01em",
        ...style,
      }}
    >{children}</button>
  );
};

// ─── Terminal Animation ────────────────────────────────────────────
const TERM_LINES: { delay: number; color: string; text: string }[] = [
  { delay: 0, color: "#7c7a9e", text: "$ scriptless connect --repo github.com/acme/checkout-app" },
  { delay: 700, color: C.primary, text: "✦ Cloning repository..." },
  { delay: 1400, color: "#c4c2e8", text: "  → 3 routes detected  ·  42 components mapped" },
  { delay: 2100, color: C.primary, text: "✦ Generating test cases with AI..." },
  { delay: 2800, color: "#c4c2e8", text: "  → 214 test scenarios synthesized" },
  { delay: 3500, color: C.primary, text: "✦ Launching Browserbase cloud runner..." },
  { delay: 4200, color: "#c4c2e8", text: "  → Running 214 tests across 6 browsers" },
  { delay: 5000, color: C.passText, text: "✓ 211 passed  ·  3 failed  ·  done in 38s" },
];

const TerminalMockup: FC = () => {
  const [visible, setVisible] = useState(0);
  const [started, setStarted] = useState(false);
  const [ref, inView] = useInView(0.3);

  useEffect(() => {
    if (!inView || started) return;
    setStarted(true);
    TERM_LINES.forEach(({ delay }, i) => {
      setTimeout(() => setVisible(v => Math.max(v, i + 1)), delay);
    });
  }, [inView, started]);

  return (
    <div ref={ref} style={{
      background: "#0d0b1e", borderRadius: 12, overflow: "hidden", position: "relative",
      border: `1px solid ${C.primary}44`,
      boxShadow: `0 0 0 1px ${C.primary}22, 0 0 32px ${C.primary}22, 0 8px 32px rgba(0,0,0,0.3)`,
    }}>
      {/* scan line */}
      <div style={{ position: "absolute", left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${C.primary}55, transparent)`, animation: "scan-line 4s linear infinite", zIndex: 2, pointerEvents: "none" }} />
      {/* Title bar */}
      <div style={{
        padding: "10px 14px", background: "#0a0818",
        display: "flex", alignItems: "center", gap: 7,
        borderBottom: `1px solid ${C.primary}22`,
      }}>
        {["#ff5f57", "#febc2e", "#28c840"].map(c => (
          <span key={c} style={{ width: 11, height: 11, borderRadius: "50%", background: c, display: "inline-block" }} />
        ))}
        <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11, color: "#7c7a9e", marginLeft: 8 }}>
          scriptless — zsh
        </span>
      </div>
      {/* Lines */}
      <div style={{ padding: "1.25rem 1.5rem", minHeight: 220 }}>
        {TERM_LINES.slice(0, visible).map((l, i) => (
          <div key={i} style={{
            fontFamily: "'Geist Mono', monospace", fontSize: 12.5,
            color: l.color, marginBottom: 5, lineHeight: 1.65,
            animation: "fadeUpLine 0.3s ease",
          }}>
            {l.text}
          </div>
        ))}
        {visible < TERM_LINES.length && (
          <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 13, color: C.primary, animation: "blink 1s steps(1) infinite" }}>▋</span>
        )}
      </div>
    </div>
  );
};

// ─── Pipeline Diagram ─────────────────────────────────────────────
const PIPELINE: { icon: string; label: string; sub: string }[] = [
  { icon: "⬡", label: "GitHub Repo", sub: "Connect & clone" },
  { icon: "✦", label: "AI Analysis", sub: "Map routes + flows" },
  { icon: "⚙", label: "Test Generation", sub: "214 scenarios" },
  { icon: "☁", label: "Browserbase", sub: "Cloud execution" },
  { icon: "✓", label: "Results", sub: "Report + video" },
];


// ─── Dot Grid Background ──────────────────────────────────────────
const DotGrid: FC = () => (
  <div style={{
    position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
    backgroundImage: `radial-gradient(circle, ${C.primary}55 1px, transparent 1px)`,
    backgroundSize: "32px 32px",
    maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 0%, transparent 100%)",
    animation: "grid-pulse 4s ease-in-out infinite",
  }} />
);

// ─── Orbs ─────────────────────────────────────────────────────────
const Orbs: FC = () => (
  <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
    <div style={{ position: "absolute", top: "-10%", right: "-8%", width: 600, height: 600, borderRadius: "50%", background: `radial-gradient(circle, ${C.primary}22 0%, transparent 65%)`, filter: "blur(1px)" }} />
    <div style={{ position: "absolute", top: "35%", left: "-8%", width: 420, height: 420, borderRadius: "50%", background: `radial-gradient(circle, ${C.primaryDark}18 0%, transparent 65%)`, filter: "blur(1px)" }} />
    <div style={{ position: "absolute", bottom: "5%", right: "18%", width: 300, height: 300, borderRadius: "50%", background: `radial-gradient(circle, ${C.primary}14 0%, transparent 65%)` }} />
    <div style={{ position: "absolute", top: "20%", left: "40%", width: 2, height: 2, borderRadius: "50%", background: C.primary, boxShadow: `0 0 60px 30px ${C.primary}22` }} />
  </div>
);

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════
const AutoTestLanding: FC = () => {
  const { isSignedIn, isLoaded } = useUser();
  const scrollY = useScrollY();
  const [heroRef, heroIn] = useInView(0.05);
  const scrolled = scrollY > 30;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const accountHref = isLoaded && isSignedIn ? "/workspace" : "/sign-in";
  const accountLabel = isLoaded ? (isSignedIn ? "Workspace" : "Sign in") : "...";

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 432) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const anim = (inView: boolean, delay = 0, from = "translateY(20px)"): React.CSSProperties => ({
    opacity: inView ? 1 : 0,
    transform: inView ? "none" : from,
    transition: `opacity 0.65s ease ${delay}s, transform 0.65s ease ${delay}s`,
  });

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes shimmer    { 0%{left:-100%} 100%{left:200%} }
        @keyframes fadeUpLine { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        @keyframes blink      { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes marquee    { from{transform:translateX(0)} to{transform:translateX(-50%)} }
        @keyframes float      { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes grid-pulse { 0%,100%{opacity:0.35} 50%{opacity:0.6} }
        @keyframes scan-line  { 0%{top:-2px;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:100%;opacity:0} }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::selection { background: #EEEDFE; color: #3C3489; }
        html { scroll-behavior: smooth; }

        .landing-nav-inner {
          max-width: 1200px;
          margin: 0 auto;
          height: 60px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 2rem;
          position: relative;
        }

        .landing-nav-actions {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .landing-nav-link {
          font-family: 'Geist', sans-serif;
          font-size: 13px;
          color: ${C.muted};
          text-decoration: none;
          padding: 6px 12px;
          border-radius: 8px;
          transition: background 0.2s ease, color 0.2s ease;
        }

        .landing-nav-link:hover {
          background: ${C.primaryBg};
          color: ${C.primaryDark};
        }

        .landing-nav-hamburger {
          display: none;
          border: 1px solid ${C.border};
          background: ${C.surface};
          color: ${C.ink};
          border-radius: 8px;
          width: 36px;
          height: 36px;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          cursor: pointer;
        }

        @media (max-width: 432px) {
          .landing-nav-inner {
            padding: 0 0.85rem;
          }
          .landing-nav-hamburger {
            display: inline-flex;
          }
          .landing-nav-actions {
            position: absolute;
            top: 56px;
            right: 0.85rem;
            left: 0.85rem;
            padding: 10px;
            border: 1px solid ${C.border};
            border-radius: 12px;
            background: rgba(255,255,255,0.96);
            backdrop-filter: blur(12px);
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
            box-shadow: 0 12px 26px rgba(0,0,0,0.08);
            display: none;
          }
          .landing-nav-actions.open {
            display: flex;
          }
          .landing-nav-link {
            padding: 10px 12px;
            text-align: center;
            border: 1px solid ${C.border};
          }
          .landing-nav-actions .magic-mobile-btn {
            width: 100%;
          }
        }
      `}</style>

      <div style={{ fontFamily: "'Geist', sans-serif", background: C.bg, color: C.ink, minHeight: "100vh" }}>

        {/* ── NAV ── */}
        <header style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
          background: scrolled ? "rgba(249,249,251,0.9)" : "transparent",
          backdropFilter: scrolled ? "blur(20px) saturate(180%)" : "none",
          borderBottom: scrolled ? `1px solid ${C.border}` : "none",
          transition: "all 0.4s ease",
        }}>
          <div className="landing-nav-inner">
            {/* Logo */}
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontFamily: "'Geist', sans-serif", fontWeight: 500, fontSize: 15, letterSpacing: "-0.01em", color: C.ink }}>Scriptless.ai</span>
              <span style={{
                fontFamily: "'Geist Mono', monospace", fontSize: 10, fontWeight: 500,
                color: C.primaryDark, background: C.primaryBg, border: `1px solid ${C.primaryMid}`,
                borderRadius: 5, padding: "2px 6px", letterSpacing: "0.04em",
              }}>beta</span>
            </div>

            <button
              className="landing-nav-hamburger"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              aria-label="Toggle navigation menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? "\u2715" : "\u2630"}
            </button>

            {/* CTA */}
            <div className={`landing-nav-actions ${mobileMenuOpen ? "open" : ""}`}>
              <Link href={accountHref} className="landing-nav-link" onClick={() => setMobileMenuOpen(false)}>
                {accountLabel}
              </Link>
              <MagicButton
                onClick={() => {
                  setMobileMenuOpen(false);
                  window.location.href = "/workspace";
                }}
                style={mobileMenuOpen ? { width: "100%" } : {}}
              >
                <span className="magic-mobile-btn">Connect GitHub {"->"}</span>
              </MagicButton>
            </div>
          </div>
        </header>

        {/* ── HERO ── */}
        <section ref={heroRef} style={{ minHeight: "100vh", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", padding: "7rem 2rem 4rem", position: "relative", overflow: "hidden" }}>
          <DotGrid />
          <Orbs />

          <div style={{ position: "relative", zIndex: 1, maxWidth: 820, margin: "0 auto" }}>
            {/* Badge */}
            <div style={{ marginBottom: 24, ...anim(heroIn, 0) }}>
              <GreenBadge>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.primary, display: "inline-block", animation: "blink 1.6s infinite" }} />
                Powered by Featherless & Speechmatics
              </GreenBadge>
            </div>

            {/* H1 */}
            <h1 style={{
              fontFamily: "'Geist', sans-serif", fontWeight: 500,
              fontSize: "clamp(2.8rem, 7vw, 6rem)",
              lineHeight: 1.04, letterSpacing: "-0.03em",
              color: C.ink, marginBottom: "1.4rem",
              ...anim(heroIn, 0.1),
            }}>
              Connect repo.<br />
              <span style={{
                background: `linear-gradient(135deg, ${C.heading} 0%, ${C.primary} 55%, ${C.primaryLight} 100%)`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
                filter: `drop-shadow(0 0 32px ${C.primary}44)`,
              }}>AI tests it.</span>
            </h1>

            {/* Sub */}
            <p style={{
              fontSize: "clamp(1rem, 1.8vw, 1.2rem)", color: C.muted, lineHeight: 1.7,
              maxWidth: 560, margin: "0 auto 2.5rem",
              ...anim(heroIn, 0.2),
            }}>
              Connect your GitHub repository, let our AI generate a complete test suite, and watch Browserbase execute them across real cloud browsers — all in minutes.
            </p>

            {/* CTAs */}
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: "3rem", ...anim(heroIn, 0.3) }}>
              <Link href={'/workspace'}>
                <MagicButton>⬡ Connect GitHub repo →</MagicButton>
              </Link>
              <MagicButton primary={false}>▶ Watch 2-min demo</MagicButton>
            </div>

            {/* Trust chips */}
            <div style={{ display: "flex", gap: 20, justifyContent: "center", flexWrap: "wrap", ...anim(heroIn, 0.4) }}>
              {["No credit card required", "Works with any Next.js / React app", "Browserbase cloud included"].map(t => (
                <span key={t} style={{ fontFamily: "'Geist', sans-serif", fontSize: 12.5, color: C.subtle, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: C.passText, fontWeight: 500 }}>✓</span> {t}
                </span>
              ))}
            </div>
          </div>

          {/* Terminal */}
          <div style={{
            maxWidth: 700, width: "100%", margin: "4rem auto 0",
            position: "relative", zIndex: 1,
            animation: heroIn ? "float 5s ease-in-out infinite" : "none",
            ...anim(heroIn, 0.55),
          }}>
            <div style={{ position: "absolute", inset: -8, borderRadius: 18, background: `radial-gradient(ellipse, ${C.primary}33 0%, transparent 70%)`, filter: "blur(16px)", zIndex: -1 }} />
            <TerminalMockup />
          </div>
        </section>

        
        {/* ── FOOTER ── */}
        <footer style={{ borderTop: `1px solid ${C.border}`, padding: "2.5rem 2rem", background: C.surface }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "'Geist', sans-serif", fontWeight: 500, fontSize: 14, color: C.ink }}>Scriptless.ai</span>
            </div>
            <span style={{ fontFamily: "'Geist', sans-serif", fontSize: 13, color: C.subtle }}>
              © {new Date().getFullYear()} Scriptless.ai. All rights reserved.
            </span>
          </div>
        </footer>
      </div>
    </>
  );
};

export default AutoTestLanding;
