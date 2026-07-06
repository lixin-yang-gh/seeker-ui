import { useState, useEffect } from "react";

const RELEASES_URL = "https://github.com/lixin-yang-gh/seeker-ui/releases";
const GITHUB_URL   = "https://github.com/lixin-yang-gh/seeker-ui";

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:        "#08080e",
  bg2:       "#0d0d18",
  bg3:       "#131322",
  fg:        "#edeef5",
  fgMuted:   "#9090b0",
  fgDim:     "#3e3e58",
  orange:    "#f97316",
  orangeGlow:"rgba(249,115,22,0.32)",
  orangeDim: "rgba(249,115,22,0.12)",
  blue:      "#4f8ef7",
  blueDim:   "rgba(79,142,247,0.12)",
  blueGlow:  "rgba(79,142,247,0.28)",
  border:    "rgba(255,255,255,0.07)",
};

// ── Shared helpers ─────────────────────────────────────────────────────────────
function Mono({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{ fontFamily: "'JetBrains Mono', monospace", ...style }}>
      {children}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "'JetBrains Mono', monospace", fontSize: "0.68rem",
      color: C.orange, textTransform: "uppercase" as const, letterSpacing: "0.1em",
      marginBottom: "0.9rem",
    }}>{children}</div>
  );
}

function H2({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <h2 style={{
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "clamp(1.75rem, 3.5vw, 2.75rem)",
      fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.12,
      color: C.fg, maxWidth: center ? "none" : 620,
      margin: center ? "0 auto 1.1rem" : "0 0 1.1rem",
      textAlign: center ? "center" : "left",
    }}>{children}</h2>
  );
}

function Intro({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <p style={{
      color: C.fgMuted, fontSize: "1rem", lineHeight: 1.75,
      maxWidth: 500, marginBottom: "3rem",
      margin: center ? "0 auto 3rem" : "0 0 3rem",
      textAlign: center ? "center" : "left",
    }}>{children}</p>
  );
}

// ── NAV ───────────────────────────────────────────────────────────────────────
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 5vw", height: 62,
      background: scrolled ? "rgba(8,8,14,0.94)" : "rgba(8,8,14,0.6)",
      backdropFilter: "blur(14px)",
      borderBottom: `1px solid ${C.border}`,
      transition: "background 0.3s",
    }}>
      <Mono style={{ fontSize: "1rem", fontWeight: 700, color: C.fg, letterSpacing: "-0.02em" }}>
        seeker<span style={{ color: C.orange }}>_</span>ui
      </Mono>

      <div style={{ display: "flex", alignItems: "center", gap: "2rem" }}>
        {(["#why","#features","#privacy"] as const).map((href, i) => (
          <NavLink key={href} href={href}>{["Why Seeker","Features","Privacy"][i]}</NavLink>
        ))}
        <a
          href={RELEASES_URL} target="_blank" rel="noopener"
          style={{
            background: C.orange, color: "#fff", border: "none",
            borderRadius: 6, padding: "0.48rem 1.15rem",
            fontFamily: "'Figtree', sans-serif", fontSize: "0.86rem", fontWeight: 600,
            textDecoration: "none",
            boxShadow: `0 0 18px ${C.orangeGlow}`,
          }}
        >Download Free</a>
      </div>
    </nav>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [h, setH] = useState(false);
  return (
    <a href={href}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ color: h ? C.fg : C.fgMuted, textDecoration: "none",
        fontSize: "0.86rem", fontWeight: 500, transition: "color 0.18s" }}
    >{children}</a>
  );
}

// ── HERO ──────────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "120px 5vw 80px", textAlign: "center", position: "relative", overflow: "hidden",
    }}>
      {/* dual-colour radial glow */}
      <div style={{
        position: "absolute", top: "-15%", left: "35%",
        width: 640, height: 520, pointerEvents: "none",
        background: `radial-gradient(ellipse, ${C.blueDim} 0%, transparent 68%)`,
      }} />
      <div style={{
        position: "absolute", top: "-10%", left: "55%",
        width: 480, height: 400, pointerEvents: "none",
        background: `radial-gradient(ellipse, ${C.orangeDim} 0%, transparent 68%)`,
      }} />

      <div style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "0.32rem 0.85rem",
        background: C.orangeDim, border: `1px solid rgba(249,115,22,0.28)`,
        borderRadius: 999, fontSize: "0.72rem", fontWeight: 600,
        color: C.orange, letterSpacing: "0.06em", textTransform: "uppercase",
        marginBottom: "2rem",
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: C.orange,
          animation: "spulse 2s ease-in-out infinite",
        }} />
        v0.9.0 — Free &amp; Open Source
      </div>

      <h1 style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "clamp(2.5rem, 6vw, 4.75rem)",
        fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.08,
        color: C.fg, maxWidth: 840, marginBottom: "1.4rem",
      }}>
        AI assistance<br />
        without the{" "}
        <span style={{
          color: C.orange,
          textShadow: `0 0 32px ${C.orangeGlow}`,
        }}>command line</span>
      </h1>

      <p style={{
        fontSize: "clamp(1rem, 1.8vw, 1.15rem)", color: C.fgMuted,
        maxWidth: 530, marginBottom: "2.5rem", lineHeight: 1.78,
      }}>
        Seeker UI puts a full AI-powered workspace at your fingertips —
        pick files, write prompts, and review results through a clean
        visual interface. No terminal. No syntax. Just results.
      </p>

      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", justifyContent: "center", marginBottom: "4rem" }}>
        <a href={RELEASES_URL} target="_blank" rel="noopener"
          style={{
            background: C.orange, color: "#fff",
            borderRadius: 7, padding: "0.88rem 2.1rem",
            fontFamily: "'Figtree', sans-serif", fontSize: "1rem", fontWeight: 700,
            textDecoration: "none",
            boxShadow: `0 0 28px ${C.orangeGlow}`,
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
          }}>
          ⬇ Download Free
        </a>
        <a href={GITHUB_URL} target="_blank" rel="noopener"
          style={{
            background: "transparent", color: C.fgMuted,
            border: `1px solid ${C.border}`,
            borderRadius: 7, padding: "0.88rem 2.1rem",
            fontFamily: "'Figtree', sans-serif", fontSize: "1rem", fontWeight: 600,
            textDecoration: "none",
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
          }}>
          View on GitHub ↗
        </a>
      </div>

      <AppMockup />
    </section>
  );
}

function AppMockup() {
  return (
    <div style={{
      width: "100%", maxWidth: 880,
      border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
      boxShadow: `0 48px 120px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)`,
    }}>
      <div style={{
        background: "#181830", padding: "11px 16px",
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: `1px solid ${C.border}`,
      }}>
        <Dot c="#ff5f57" /><Dot c="#febc2e" /><Dot c="#28c840" />
        <Mono style={{ fontSize: "0.7rem", color: C.fgDim, margin: "0 auto" }}>
          Seeker UI — my-project
        </Mono>
      </div>
      <div style={{ background: C.bg2, display: "grid", gridTemplateColumns: "196px 1fr", minHeight: 360 }}>
        {/* sidebar */}
        <div style={{ background: C.bg3, borderRight: `1px solid ${C.border}`, padding: "14px 0" }}>
          <Mono style={{ fontSize: "0.58rem", color: C.fgDim, textTransform: "uppercase",
            letterSpacing: "0.1em", padding: "0 14px", display: "block", marginBottom: 10 }}>
            Project Files
          </Mono>
          {[
            { name: "README.md",       on: true  },
            { name: "src/main.py",     on: true  },
            { name: "utils/parser.py", on: true  },
            { name: "tests/test.py",   on: false },
            { name: "config.yaml",     on: false },
          ].map(f => (
            <div key={f.name} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 14px", fontSize: "0.74rem",
              color: f.on ? C.blue : C.fgDim,
              background: f.on ? C.blueDim : "transparent",
            }}>
              <span style={{
                width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                background: f.on ? C.blue : "transparent",
                border: f.on ? "none" : `1.5px solid ${C.fgDim}`,
              }} />
              {f.name}
            </div>
          ))}
        </div>
        {/* main */}
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <Mono style={{ fontSize: "0.58rem", color: C.fgDim, textTransform: "uppercase",
              letterSpacing: "0.1em", display: "block", marginBottom: 7 }}>
              Task / Prompt
            </Mono>
            <div style={{
              background: C.bg3, border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "10px 13px",
              fontSize: "0.76rem", color: C.fgMuted, lineHeight: 1.55,
            }}>
              Refactor the parser to handle empty inputs and add docstrings
              to all public functions.
            </div>
          </div>
          <div>
            <Mono style={{ fontSize: "0.6rem", color: C.orange, display: "block", marginBottom: 7 }}>
              ✦ AI Response
            </Mono>
            <div style={{
              background: C.orangeDim, border: `1px solid rgba(249,115,22,0.22)`,
              borderRadius: 6, padding: "10px 13px",
              fontSize: "0.76rem", color: "#fbbf7a", lineHeight: 1.55,
            }}>
              {"I've identified 3 functions without docstrings and 2 edge cases. Here are the proposed changes — review each block before applying."}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <MockBtn orange>Apply Changes</MockBtn>
              <MockBtn>Skip</MockBtn>
              <MockBtn>Copy</MockBtn>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span style={{ width: 12, height: 12, borderRadius: "50%", background: c, display: "inline-block" }} />;
}
function MockBtn({ children, orange }: { children: React.ReactNode; orange?: boolean }) {
  return (
    <span style={{
      padding: "5px 12px", borderRadius: 5, fontSize: "0.7rem", fontWeight: 600, cursor: "default",
      background: orange ? C.orange : C.bg3,
      color: orange ? "#fff" : C.fgMuted,
      border: orange ? "none" : `1px solid ${C.border}`,
    }}>{children}</span>
  );
}

// ── VS CLI ────────────────────────────────────────────────────────────────────
function VsSection() {
  return (
    <section id="why" style={{
      padding: "100px 5vw", background: C.bg2,
      borderTop: `1px solid ${C.border}`,
    }}>
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <Label>Why Seeker UI</Label>
        <H2>Built for humans,<br />not <span style={{ color: C.orange }}>terminals</span></H2>
        <Intro>
          Most AI tools are built around typing commands and pasting code snippets.
          Seeker UI is built around the way people actually think — visually,
          in context, with files at hand.
        </Intro>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
        }}>
          <VsCol bad title="CLI-Based AI Tools" items={[
            "Paste walls of code and hope the context limit holds",
            "Copy file contents manually, one file at a time",
            "Memorize flags and API parameters just to send a request",
            "Apply AI suggestions by hunting through files yourself",
            "No visual overview of your prompt before sending",
          ]} />
          <VsCol title="Seeker UI" items={[
            "Tick the files you want — context is assembled automatically",
            "Structured editor keeps system role, task, and files clearly separated",
            "Choose a model from a dropdown and click Run — nothing more",
            "Review AI-proposed changes in-app and apply with one button",
            "Files, prompt, and response visible in a single workspace",
          ]} />
        </div>
      </div>
    </section>
  );
}

function VsCol({ title, items, bad }: { title: string; items: string[]; bad?: boolean }) {
  return (
    <div style={{
      padding: "2.4rem",
      background: bad ? "rgba(255,255,255,0.015)" : C.orangeDim,
      borderLeft: bad ? "none" : `1px solid rgba(249,115,22,0.2)`,
    }}>
      <Mono style={{
        fontSize: "0.64rem", letterSpacing: "0.09em", textTransform: "uppercase",
        color: bad ? C.fgDim : C.orange, display: "block", marginBottom: "1.6rem",
      }}>
        {bad ? "✗  " : "✓  "}{title}
      </Mono>
      {items.map(t => (
        <div key={t} style={{
          display: "flex", gap: "0.75rem", marginBottom: "1rem",
          fontSize: "0.87rem", lineHeight: 1.6,
          color: bad ? C.fgDim : C.fg,
        }}>
          <span style={{ flexShrink: 0, color: bad ? C.fgDim : C.orange }}>{bad ? "✗" : "✓"}</span>
          {t}
        </div>
      ))}
    </div>
  );
}

// ── FEATURES ──────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: "📂", title: "File Explorer",        desc: "Browse your project, tick the files you need, and they are woven into your prompt automatically. Subfolder navigation and live preview included." },
  { icon: "✏️", title: "Structured Prompts",   desc: "Separate sections for system role, task description, known issues, and file context — write once, reuse across sessions without reformatting." },
  { icon: "⚡", title: "One-Click Inference",  desc: "Choose a model, set temperature with a slider, and hit Run. No API boilerplate, no terminal — ready to go in seconds." },
  { icon: "🔍", title: "Review Before Applying", desc: "AI-proposed file edits appear as readable blocks. Approve, skip, or copy each one — you remain in control of every change." },
  { icon: "📋", title: "Clipboard Workflow",   desc: "Copy your assembled prompt to any AI service and paste the response back in. Works with every provider, not just one." },
  { icon: "🛡️", title: "Data Redaction",       desc: "Built-in secret masking and custom substring redaction prevents sensitive strings from slipping into your prompts." },
];

function FeaturesSection() {
  return (
    <section id="features" style={{ padding: "100px 5vw" }}>
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <Label>What You Get</Label>
        <H2>Everything in one<br /><span style={{ color: C.blue }}>visual workspace</span></H2>
        <Intro>Seeker UI was designed so you spend time on your work, not on wrangling tooling.</Intro>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1px", background: C.border,
          border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden",
        }}>
          {FEATURES.map(f => <FeatureCard key={f.title} {...f} />)}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  const [h, setH] = useState(false);
  return (
    <div
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: h ? C.bg3 : C.bg2, padding: "2.1rem 1.9rem", transition: "background 0.2s" }}
    >
      <div style={{
        width: 40, height: 40, background: C.blueDim,
        border: `1px solid rgba(79,142,247,0.22)`,
        borderRadius: 8, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: "1.05rem", marginBottom: "1.1rem",
      }}>{icon}</div>
      <Mono style={{ fontSize: "0.86rem", fontWeight: 600, color: C.fg,
        display: "block", marginBottom: "0.55rem", letterSpacing: "-0.02em" }}>
        {title}
      </Mono>
      <p style={{ fontSize: "0.84rem", color: C.fgMuted, lineHeight: 1.65, margin: 0 }}>{desc}</p>
    </div>
  );
}

// ── PRIVACY ───────────────────────────────────────────────────────────────────
function PrivacySection() {
  return (
    <section id="privacy" style={{
      padding: "100px 5vw", textAlign: "center",
      background: C.bg2, borderTop: `1px solid ${C.border}`,
    }}>
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <Label>Privacy</Label>
        <H2 center>Your files stay<br /><span style={{ color: C.blue }}>on your machine</span></H2>
        <div style={{
          maxWidth: 640, margin: "0 auto",
          background: C.bg, border: `1px solid ${C.border}`,
          borderRadius: 16, padding: "3rem",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
            width: 240, height: 1,
            background: `linear-gradient(90deg, transparent, ${C.orange}, transparent)`,
          }} />
          <div style={{ fontSize: "1.8rem", marginBottom: "1.3rem" }}>🔒</div>
          <p style={{ color: C.fgMuted, fontSize: "0.97rem", lineHeight: 1.78, marginBottom: "0.9rem" }}>
            Seeker UI is <strong style={{ color: C.fg }}>local-first</strong>. Your API keys,
            project files, and prompt history are stored only on your own device —
            never uploaded to any server.
          </p>
          <p style={{ color: C.fgMuted, fontSize: "0.97rem", lineHeight: 1.78, margin: 0 }}>
            There is no telemetry, no analytics, and no tracking of any kind.
            What you work on is your business alone.
          </p>
        </div>
      </div>
    </section>
  );
}

// ── DOWNLOAD CTA ──────────────────────────────────────────────────────────────
function DownloadCTA() {
  return (
    <section style={{
      padding: "100px 5vw", textAlign: "center",
      borderTop: `1px solid ${C.border}`,
      position: "relative", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: 700, height: 400, pointerEvents: "none",
        background: `radial-gradient(ellipse, ${C.orangeDim} 0%, transparent 68%)`,
      }} />
      <div style={{ maxWidth: 580, margin: "0 auto", position: "relative" }}>
        <Label>Get Started</Label>
        <H2 center>Free to download.<br /><span style={{ color: C.orange }}>Free to keep.</span></H2>
        <p style={{ color: C.fgMuted, fontSize: "1rem", lineHeight: 1.75, marginBottom: "2.5rem" }}>
          Pre-built installers for Windows and macOS are available on the GitHub releases page.
          Free for personal, non-commercial use.
        </p>

        <div style={{ display: "flex", justifyContent: "center", gap: "1rem", flexWrap: "wrap", marginBottom: "2.2rem" }}>
          <PlatformCard icon="🪟" label="Windows" sub="Windows 10 &amp; 11" />
          <PlatformCard icon="🍎" label="macOS"   sub="Monterey 12 and later" />
        </div>

        <p style={{ fontSize: "0.8rem", color: C.fgDim }}>
          Linux users can{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener"
            style={{ color: C.fgMuted, textDecoration: "underline", textUnderlineOffset: 3 }}>
            build from source on GitHub
          </a>.
        </p>
      </div>
    </section>
  );
}

function PlatformCard({ icon, label, sub }: { icon: string; label: string; sub: string }) {
  const [h, setH] = useState(false);
  return (
    <a
      href={RELEASES_URL} target="_blank" rel="noopener"
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: h ? C.orangeDim : C.bg2,
        border: h ? `1px solid rgba(249,115,22,0.4)` : `1px solid ${C.border}`,
        borderRadius: 12, padding: "1.8rem 2.2rem",
        textDecoration: "none", color: C.fg,
        minWidth: 200, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.65rem",
        transform: h ? "translateY(-3px)" : "none",
        boxShadow: h ? `0 16px 44px rgba(0,0,0,0.45)` : "none",
        transition: "all 0.2s",
      }}
    >
      <span style={{ fontSize: "2rem" }}>{icon}</span>
      <Mono style={{ fontSize: "0.84rem", fontWeight: 600, color: C.fg }}>{label}</Mono>
      <span style={{ fontSize: "0.74rem", color: C.fgMuted }}
        dangerouslySetInnerHTML={{ __html: sub }} />
      <span style={{ fontSize: "0.78rem", color: C.orange, fontWeight: 600, marginTop: 4 }}>
        Download on GitHub →
      </span>
    </a>
  );
}

// ── FOOTER ────────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer style={{
      padding: "2rem 5vw",
      borderTop: `1px solid ${C.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      flexWrap: "wrap", gap: "1rem",
    }}>
      <Mono style={{ fontSize: "0.88rem", fontWeight: 700, color: C.fgMuted }}>
        seeker<span style={{ color: C.orange }}>_</span>ui
      </Mono>
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        {[
          { label: "Why Seeker",  href: "#why"      },
          { label: "Features",    href: "#features"  },
          { label: "Privacy",     href: "#privacy"   },
          { label: "GitHub ↗",    href: GITHUB_URL   },
          { label: "Releases ↗",  href: RELEASES_URL },
        ].map(l => (
          <a key={l.label} href={l.href}
            target={l.href.startsWith("http") ? "_blank" : undefined}
            rel={l.href.startsWith("http") ? "noopener" : undefined}
            style={{ color: C.fgDim, fontSize: "0.78rem", textDecoration: "none" }}
            onMouseEnter={e => (e.currentTarget.style.color = C.fgMuted)}
            onMouseLeave={e => (e.currentTarget.style.color = C.fgDim)}
          >{l.label}</a>
        ))}
      </div>
      <span style={{ fontSize: "0.74rem", color: C.fgDim }}>
        Free for personal use &nbsp;·&nbsp; Open source
      </span>
    </footer>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <div style={{ background: C.bg, minHeight: "100vh", fontFamily: "'Figtree', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Figtree:wght@300;400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #3e3e58; border-radius: 3px; }
        html { scroll-behavior: smooth; }
        @keyframes spulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.35; transform: scale(0.72); }
        }
        @media (max-width: 900px) {
          .vs-inner { grid-template-columns: 1fr !important; }
          .feat-inner { grid-template-columns: 1fr 1fr !important; }
          nav a:not(:last-child):not(:first-child) { display: none; }
        }
        @media (max-width: 580px) {
          .feat-inner { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <Nav />
      <Hero />
      <VsSection />
      <FeaturesSection />
      <PrivacySection />
      <DownloadCTA />
      <Footer />
    </div>
  );
}
