import { forwardRef } from "react";
import type { CurrentLocation } from "../../hooks/useSpeedrun";
import type {
  ExternalImage,
  ExternalItem,
  ExternalSection,
  ExternalSubject,
  Section,
} from "../../lib/speedrunApi";

// ---------------------------------------------------------------------------
// Static fallback content. The live lab-facts are fetched at runtime from
// /api/content/lab-facts; this guarantees the Stage always renders stations
// even before the fetch resolves (or if the backend is unreachable).
// ---------------------------------------------------------------------------

interface WorkFact {
  id: string;
  title: string;
  category: string;
  year: string;
}
interface CareerFact {
  year: string;
  title: string;
  company: string;
}
interface SkillFact {
  name: string;
}

const FALLBACK_WORKS: WorkFact[] = [
  { id: "beyond-design", title: "Beyond Design", category: "Design Systems", year: "2025" },
  { id: "design-library", title: "Design Library Organisation", category: "UX Strategy", year: "2024" },
  { id: "bookscreening", title: "Book Screening", category: "Product Design", year: "2023" },
  { id: "imo", title: "IMO — Investment Management Online", category: "Product Design", year: "2022" },
  { id: "key4-si", title: "key4 Smart Investing", category: "Product Design", year: "2021" },
  { id: "myway", title: "My Way", category: "Product Design", year: "2020" },
  { id: "uds", title: "Universal Design System", category: "Design Systems", year: "2019" },
];

const FALLBACK_CAREER: CareerFact[] = [
  { year: "1995", title: "Freelance Screen Designer", company: "Various" },
  { year: "1996", title: "Interaction Design Director", company: "Eclat AG" },
  { year: "2000", title: "Media & Interaction Designer", company: "MetaDesign, SF" },
  { year: "2001", title: "Senior Interaction Designer", company: "NOSE, Zürich" },
  { year: "2008", title: "Principal Experience Designer", company: "Namics AG" },
  { year: "2019", title: "Design Lead Design Systems", company: "UBS" },
  { year: "2024", title: "Design Lead Save, Protect & Growth", company: "UBS" },
];

const FALLBACK_SKILLS: SkillFact[] = [
  { name: "UX Research" },
  { name: "Design Systems" },
  { name: "Prototyping" },
  { name: "Visual Design" },
  { name: "Workshop Facilitation" },
  { name: "AI for Design" },
];

// ---------------------------------------------------------------------------
// Station model derived from a section + optional item.
// ---------------------------------------------------------------------------

export interface StationLocation {
  section: Section;
  item: string | null;
}

function stationKey(loc: StationLocation): string {
  return `${loc.section}:${loc.item ?? ""}`;
}

type StationVisualState = "hidden" | "inactive" | "visited" | "active";

const MAX_URL_WORKS = 7;
const MAX_URL_SKILLS = 6;
const MAX_URL_CAREER = 7;

// ---------------------------------------------------------------------------
// Props — discriminated union. `mode` defaults to "claus" so existing callers
// don't change, but once `mode="url"` the subject/sections/sourceUrl props
// are required.
// ---------------------------------------------------------------------------

interface StageBaseProps {
  currentLocation: CurrentLocation;
  visited: StationLocation[];
  /** Compact (mobile) density: smaller fonts + tighter grid gaps. */
  compact?: boolean;
}

interface ClausStageProps extends StageBaseProps {
  mode?: "claus";
  works: WorkFact[];
  career: CareerFact[];
  skills: SkillFact[];
}

interface UrlStageProps extends StageBaseProps {
  mode: "url";
  subject: ExternalSubject;
  sections: ExternalSection[];
  sourceUrl: string;
}

type StageProps = ClausStageProps | UrlStageProps;

const BASE_BORDER = "color-mix(in srgb, var(--color-text-secondary) 25%, transparent)";

/**
 * Claus' work (or an external URL's content) rendered as a navigable 2D
 * landscape of stations. Each station carries `data-section` / `data-item`
 * attributes so VirtualCursor + Marginalia can measure its position via
 * getBoundingClientRect.
 *
 * Progressive reveal: stations start `hidden` and reveal when the agent
 * visits their section. Hidden stations stay in the layout (opacity 0,
 * pointer-events none) so getBoundingClientRect still reports real geometry.
 *
 * Visual state per station:
 *  - hidden:   invisible (opacity 0, scale 0.85, no pointer events)
 *  - inactive: dimmed
 *  - visited:  subtly highlighted
 *  - active:   full glow + scale (currentLocation match)
 *
 * All colors come from CSS variables; none are hardcoded.
 */
const Stage = forwardRef<HTMLDivElement, StageProps>(function Stage(props, ref) {
  const { currentLocation, visited, compact = false } = props;

  const visitedSet = new Set(visited.map(stationKey));
  const activeKey = stationKey(currentLocation);
  // Sections the agent has reached at least once (+ the current one). Used to
  // reveal whole sections on first contact so siblings light up together.
  const revealedSections = new Set<Section>();
  revealedSections.add("hero");
  revealedSections.add(currentLocation.section);
  for (const v of visited) revealedSections.add(v.section);

  const reduced = prefersReducedMotion();

  const isVisited = (loc: StationLocation) => visitedSet.has(stationKey(loc));
  const isActive = (loc: StationLocation) => stationKey(loc) === activeKey;

  function visualState(loc: StationLocation, section: Section): StationVisualState {
    if (!revealedSections.has(section)) return "hidden";
    if (isActive(loc)) return "active";
    if (isVisited(loc)) return "visited";
    return "inactive";
  }

  function stationStyle(loc: StationLocation, section: Section): React.CSSProperties {
    switch (visualState(loc, section)) {
      case "active":
        return {
          opacity: 1,
          transform: reduced ? undefined : "scale(1.05)",
          borderColor: "var(--color-accent)",
          boxShadow: `0 0 calc(14px * var(--glow-strength)) var(--color-accent)`,
          color: "var(--color-text-primary)",
        };
      case "visited":
        return {
          opacity: 0.7,
          borderColor: "color-mix(in srgb, var(--color-accent) 40%, transparent)",
        };
      case "inactive":
        return { opacity: 0.4 };
      case "hidden":
        return {
          opacity: 0,
          transform: reduced ? undefined : "scale(0.85)",
          pointerEvents: "none",
        };
    }
  }

  // ---- URL-mode data resolution ------------------------------------------
  if (props.mode === "url") {
    const subject = props.subject;
    const urlSections = props.sections;
    const findUrlSection = (id: string): ExternalSection | undefined =>
      urlSections.find((s) => s.id === id);

    const heroLoc: StationLocation = { section: "hero", item: null };
    const aboutSection = findUrlSection("about");
    const aboutItem = aboutSection?.items?.[0];
    const aboutLoc: StationLocation = { section: "about", item: null };
    const worksItems = (findUrlSection("works")?.items ?? []).slice(0, MAX_URL_WORKS);
    const skillsItems = (findUrlSection("skills")?.items ?? []).slice(0, MAX_URL_SKILLS);
    const careerItems = (findUrlSection("career")?.items ?? []).slice(0, MAX_URL_CAREER);
    const heroName = subject.name || props.sourceUrl;
    const heroRole =
      subject.role || findUrlSection("hero")?.items?.[0]?.title || null;
    const heroLocation = subject.location || null;
    const kindOrder: Record<ExternalImage["kind"], number> = { avatar: 0, logo: 1, header: 2 };
    const asciiImages = (subject.images || [])
      .filter((img): img is ExternalImage & { ascii: string } => !!img.ascii)
      .sort((a, b) => (kindOrder[a.kind] ?? 99) - (kindOrder[b.kind] ?? 99))
      .slice(0, 3);

    return (
      <StageShell ref={ref} compact={compact} sourceUrl={props.sourceUrl}>
        {/* Hero + About (left column, top) */}
        <div className="flex flex-col gap-4 md:row-span-1 md:col-span-1">
          <div
            data-section="hero"
            data-item=""
            className="speedrun-station rounded-sm border p-4 md:p-5 flex flex-col justify-center"
            style={{ borderColor: BASE_BORDER, ...stationStyle(heroLoc, "hero") }}
          >
            <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary">
              // hero
            </p>
            {asciiImages.length > 0 && (
              <div className="flex flex-col gap-1.5 mt-1 mb-1">
                {asciiImages.map((img, i) => (
                  <div key={i}>
                    <pre className="stage-ascii">{img.ascii}</pre>
                    <p className="font-display text-[0.5rem] uppercase tracking-[0.15em] text-text-secondary/60">
                      {img.alt || img.kind}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <p className="font-display text-lg md:text-xl leading-tight crt-glow mt-1 break-words">
              {heroName || "UNKNOWN"}
            </p>
            {heroRole && (
              <p className="font-display text-xs text-text-secondary mt-0.5 break-words">
                {heroRole}
              </p>
            )}
            {heroLocation && (
              <p className="font-display text-[0.6rem] text-text-secondary/70 mt-0.5">
                {heroLocation}
              </p>
            )}
          </div>

          <div
            data-section="about"
            data-item=""
            className="speedrun-station rounded-sm border p-3 md:p-4"
            style={{ borderColor: BASE_BORDER, ...stationStyle(aboutLoc, "about") }}
          >
            <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary">
              // about
            </p>
            <p className="text-xs md:text-sm text-text-secondary mt-1 leading-snug break-words">
              {aboutItem?.description || aboutItem?.title || "(nothing found)"}
            </p>
          </div>
        </div>

        {/* Works (top-right) */}
        <div className="md:col-span-1 md:row-span-2">
          <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary mb-2">
            // {findUrlSection("works")?.title || "works"}
          </p>
          {worksItems.length === 0 ? (
            <EmptyHint />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-2 md:gap-3">
              {worksItems.map((it) => (
                <UrlWorkCard
                  key={it.id}
                  item={it}
                  stationStyle={stationStyle}
                />
              ))}
            </div>
          )}
        </div>

        {/* Career (left-bottom) — omitted entirely when absent in URL mode */}
        {careerItems.length > 0 && (
          <div className="md:col-span-1 md:row-span-1">
            <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary mb-2">
              // {findUrlSection("career")?.title || "career"}
            </p>
            <div className="flex flex-col gap-1.5">
              {careerItems.map((it) => {
                const loc: StationLocation = { section: "career", item: it.id };
                return (
                  <div
                    key={it.id}
                    data-section="career"
                    data-item={it.id}
                    className="speedrun-station rounded-sm border px-2 py-1 flex items-center gap-2"
                    style={{
                      borderColor: BASE_BORDER,
                      ...stationStyle(loc, "career"),
                    }}
                  >
                    <span className="font-display text-[0.65rem] md:text-xs leading-tight truncate">
                      {it.title}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Skills (bottom, full width) */}
        <div className="md:col-span-2 md:row-span-1">
          <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary mb-2">
            // {findUrlSection("skills")?.title || "skills"}
          </p>
          {skillsItems.length === 0 ? (
            <EmptyHint />
          ) : (
            <div className="flex flex-wrap gap-2">
              {skillsItems.map((it) => {
                const loc: StationLocation = { section: "skills", item: it.id };
                return (
                  <div
                    key={it.id}
                    data-section="skills"
                    data-item={it.id}
                    className="speedrun-station rounded-full border px-3 py-1"
                    style={{
                      borderColor: BASE_BORDER,
                      ...stationStyle(loc, "skills"),
                    }}
                  >
                    <span className="font-display text-[0.65rem] md:text-xs">
                      {it.title}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </StageShell>
    );
  }

  // ---- Claus mode --------------------------------------------------------
  const { works, career, skills } = props;
  const heroLoc: StationLocation = { section: "hero", item: null };
  const aboutLoc: StationLocation = { section: "about", item: null };

  return (
    <StageShell ref={ref} compact={compact}>
      {/* Hero + About (left column, top) */}
      <div className="flex flex-col gap-4 md:row-span-1 md:col-span-1">
        <div
          data-section="hero"
          data-item=""
          className="speedrun-station rounded-sm border p-4 md:p-5 flex flex-col justify-center"
          style={{ borderColor: BASE_BORDER, ...stationStyle(heroLoc, "hero") }}
        >
          <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary">
            // hero
          </p>
          <p className="font-display text-lg md:text-xl leading-tight crt-glow mt-1">
            CLAUS MEDVESEK
          </p>
          <p className="font-display text-xs text-text-secondary mt-0.5">
            Head of Design · Zürich
          </p>
        </div>

        <div
          data-section="about"
          data-item=""
          className="speedrun-station rounded-sm border p-3 md:p-4"
          style={{ borderColor: BASE_BORDER, ...stationStyle(aboutLoc, "about") }}
        >
          <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary">
            // about
          </p>
          <p className="text-xs md:text-sm text-text-secondary mt-1 leading-snug">
            Senior UX/UI designer building design systems & investment
            products for global banks.
          </p>
        </div>
      </div>

      {/* Works (top-right) */}
      <div className="md:col-span-1 md:row-span-2">
        <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary mb-2">
          // works
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-2 md:gap-3">
          {works.map((w) => {
            const loc: StationLocation = { section: "works", item: w.id };
            return (
              <div
                key={w.id}
                data-section="works"
                data-item={w.id}
                className="speedrun-station rounded-sm border p-2 md:p-3 flex flex-col"
                style={{ borderColor: BASE_BORDER, ...stationStyle(loc, "works") }}
              >
                <p className="font-display text-[0.6rem] text-text-secondary/80">
                  {w.year}
                </p>
                <p className="font-display text-[0.7rem] md:text-xs leading-tight mt-0.5 line-clamp-2">
                  {w.title}
                </p>
                <p className="text-[0.55rem] md:text-[0.6rem] text-text-secondary/70 mt-1 line-clamp-1">
                  {w.category}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Career (left-bottom) */}
      <div className="md:col-span-1 md:row-span-1">
        <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary mb-2">
          // career
        </p>
        <div className="flex flex-col gap-1.5">
          {career.map((c, idx) => {
            const itemId = `career-${idx}`;
            const loc: StationLocation = { section: "career", item: itemId };
            return (
              <div
                key={itemId}
                data-section="career"
                data-item={itemId}
                className="speedrun-station rounded-sm border px-2 py-1 flex items-center gap-2"
                style={{ borderColor: BASE_BORDER, ...stationStyle(loc, "career") }}
              >
                <span className="font-display text-[0.6rem] text-text-secondary/80 w-9 shrink-0">
                  {c.year}
                </span>
                <span className="font-display text-[0.65rem] md:text-xs leading-tight truncate">
                  {c.title}
                </span>
                <span className="text-[0.55rem] text-text-secondary/60 truncate hidden sm:inline">
                  {c.company}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Skills (bottom, full width) */}
      <div className="md:col-span-2 md:row-span-1">
        <p className="font-display text-[0.6rem] uppercase tracking-[0.25em] text-text-secondary mb-2">
          // skills
        </p>
        <div className="flex flex-wrap gap-2">
          {skills.map((s, idx) => {
            const itemId = `skill-${idx}`;
            const loc: StationLocation = { section: "skills", item: itemId };
            return (
              <div
                key={itemId}
                data-section="skills"
                data-item={itemId}
                className="speedrun-station rounded-full border px-3 py-1"
                style={{ borderColor: BASE_BORDER, ...stationStyle(loc, "skills") }}
              >
                <span className="font-display text-[0.65rem] md:text-xs">
                  {s.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </StageShell>
  );
});

// ---------------------------------------------------------------------------
// StageShell — outer container (grid scaffolding, optional URL badge). The
// forwarded ref points at the scrollable root so VirtualCursor + Marginalia
// can query it.
// ---------------------------------------------------------------------------

const StageShell = forwardRef<
  HTMLDivElement,
  {
    children: React.ReactNode;
    compact?: boolean;
    sourceUrl?: string;
  }
>(function StageShell({ children, compact = false, sourceUrl }, ref) {
  return (
    <div
      ref={ref}
      className="relative w-full h-full overflow-hidden"
      style={{ minHeight: "100%" }}
    >
      {/* Grid scaffolding lines (subtle) */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in srgb, var(--color-text-secondary) 8%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--color-text-secondary) 8%, transparent) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {sourceUrl && (
        <div
          className="absolute top-2 right-2 z-30 max-w-[60%] font-display text-[0.55rem] uppercase tracking-[0.15em] px-2 py-0.5 border truncate"
          style={{
            borderColor:
              "color-mix(in srgb, var(--color-accent-secondary) 50%, transparent)",
            color: "var(--color-accent-secondary)",
            backgroundColor: "color-mix(in srgb, var(--color-bg) 70%, transparent)",
          }}
          title={sourceUrl}
        >
          URL: {sourceUrl}
        </div>
      )}

      <div
        className="relative z-10 grid h-full p-4 md:gap-6 md:p-6 grid-cols-1 md:grid-cols-[1fr_2fr] md:grid-rows-[auto_1fr_auto]"
        style={{ gap: compact ? "0.5rem" : undefined }}
      >
        {children}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// URL-mode station cards
// ---------------------------------------------------------------------------

function UrlWorkCard({
  item,
  stationStyle,
}: {
  item: ExternalItem;
  stationStyle: (loc: StationLocation, section: Section) => React.CSSProperties;
}) {
  const loc: StationLocation = { section: "works", item: item.id };
  return (
    <div
      data-section="works"
      data-item={item.id}
      className="speedrun-station rounded-sm border p-2 md:p-3 flex flex-col"
      style={{ borderColor: BASE_BORDER, ...stationStyle(loc, "works") }}
    >
      <p className="font-display text-[0.7rem] md:text-xs leading-tight line-clamp-2">
        {item.title}
      </p>
      {item.description && (
        <p className="text-[0.55rem] md:text-[0.6rem] text-text-secondary/70 mt-1 line-clamp-1">
          {item.description}
        </p>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <p className="font-display text-[0.6rem] uppercase tracking-[0.15em] text-text-secondary/40 italic">
      (nothing extracted)
    </p>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default Stage;

export {
  FALLBACK_WORKS,
  FALLBACK_CAREER,
  FALLBACK_SKILLS,
  type WorkFact,
  type CareerFact,
  type SkillFact,
};
