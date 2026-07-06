import { useEffect, useState } from "react";
import { Menu, Xmark } from "iconoir-react";
import ApiKeyWidget from "./ApiKeyWidget";
import ThemeToggle from "./ThemeToggle";
import SoundToggle from "./SoundToggle";

const navLinks = [
  { to: "#boot", label: "Boot" },
  { to: "#oracle", label: "Oracle" },
  { to: "#observer", label: "Speedrun" },
  { to: "#sketch", label: "Sketch" },
  { to: "#quest", label: "Quest" },
];

function scrollToHash(href: string) {
  const el = document.querySelector(href);
  if (el) el.scrollIntoView({ behavior: "smooth" });
}

export default function Navigation() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleNavClick = (
    e: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    e.preventDefault();
    setMobileOpen(false);
    scrollToHash(href);
  };

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-bg/85 backdrop-blur-md border-b border-text-secondary/15"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 flex items-center justify-between h-16 lg:h-20">
          <a
            href="#boot"
            onClick={(e) => handleNavClick(e, "#boot")}
            className="font-display text-text-primary font-bold text-lg tracking-wider crt-glow"
          >
            CME.exe
          </a>

          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <a
                key={link.to}
                href={link.to}
                onClick={(e) => handleNavClick(e, link.to)}
                className="font-display text-xs uppercase tracking-[0.1em] text-text-secondary hover:text-text-primary transition-colors relative group"
              >
                {link.label}
                <span className="absolute -bottom-1 left-0 w-0 h-px bg-accent group-hover:w-full transition-all duration-300" />
              </a>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-5">
            <SoundToggle />
            <ThemeToggle />
            <ApiKeyWidget />
          </div>

          <button
            className="md:hidden text-text-primary p-2"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <Xmark width={22} height={22} /> : <Menu width={22} height={22} />}
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-bg/95 backdrop-blur-lg flex flex-col items-center justify-center gap-8 md:hidden">
          {navLinks.map((link) => (
            <a
              key={link.to}
              href={link.to}
              onClick={(e) => handleNavClick(e, link.to)}
              className="font-display text-2xl uppercase tracking-[0.1em] text-text-primary hover:text-accent transition-colors"
            >
              {link.label}
            </a>
          ))}
          <div className="flex flex-col items-center gap-6 mt-6">
            <ThemeToggle />
            <SoundToggle />
            <ApiKeyWidget />
          </div>
        </div>
      )}
    </>
  );
}
