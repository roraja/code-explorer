# Code Explorer — UI/UX Design

> **Version:** 1.0
> **Date:** 2026-03-28
> **Status:** Draft

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Sidebar Layout Design](#2-sidebar-layout-design)
3. [Interaction Design](#3-interaction-design)
4. [States & Transitions](#4-states--transitions)
5. [Color & Icon System](#5-color--icon-system)
6. [Responsive Design](#6-responsive-design)
7. [Accessibility](#7-accessibility)
8. [Settings UI](#8-settings-ui)
9. [Wireframes](#9-wireframes)

---

## 1. Design Principles

### 1.1 Core Principles

| Principle | Description |
|-----------|-------------|
| **Native Feel** | Look and behave like a built-in VS Code panel. Use VS Code theme colors, fonts, and interaction patterns. Never feel like a foreign embedded app. |
| **Progressive Disclosure** | Show summary first (overview, counts), expand for details. Don't overwhelm with information on first render. |
| **Speed Perception** | Show cached data instantly (<100ms). Use skeleton loaders for pending analysis. Show partial results (static) while AI analysis runs. |
| **Keyboard-First** | All actions reachable via keyboard. Focus management follows VS Code patterns. |
| **Minimal Distraction** | Don't interrupt the developer's flow. Hover cards are subtle. Tab opens are non-blocking. Background analysis is silent. |
| **Information Density** | Maximize useful information in limited sidebar width. Use compact tables, collapsible sections, and smart truncation. |

### 1.2 VS Code Integration Guidelines

- Use `var(--vscode-*)` CSS variables exclusively — never hardcode colors
- Use Codicon icons (VS Code's icon font) — never custom icons for standard actions
- Follow VS Code's spacing conventions (8px grid)
- Match VS Code's panel header style (bold title, action buttons top-right)
- Use VS Code's selection highlight, focus ring, and hover styles

---

## 2. Sidebar Layout Design

### 2.1 Overall Structure

```
┌─────────────────────────────────────┐
│ CODE EXPLORER              ⚙️  🔄  │  ← Panel Header
├─────────────────────────────────────┤
│ ◀ [UserCtrl] [getUser] [User] × ▶ │  ← Tab Bar (scrollable)
├─────────────────────────────────────┤
│                                     │
│  $(symbol-class) UserController     │  ← Symbol Header
│  src/controllers/UserController.ts  │     (icon + name + path)
│                                     │
│  ▼ Overview                         │  ← Section (collapsible)
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  Handles user-related HTTP end-     │
│  points. Extends BaseController     │
│  and provides CRUD operations...    │
│                                     │
│  ▼ Call Stacks (5)                  │  ← Section with count badge
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  1. app.ts:42                       │
│     └─ routes/user.ts:15            │
│        └─ UserController.getUser()  │
│  2. app.ts:42                       │
│     └─ routes/user.ts:23            │
│        └─ UserController.create..   │
│                                     │
│  ▼ Usage (12 references)            │  ← Section
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  📄 routes/user.ts                  │     Grouped by file
│    :8  new UserController(svc)      │
│    :15 controller.getUser           │
│  📄 test/user.test.ts               │
│    :12 new UserController(mock)     │
│                                     │
│  ▶ Data Flow                        │  ← Collapsed section
│  ▶ Relationships                    │  ← Collapsed section
│                                     │
│ ─────────────────────────────────── │
│  ✓ Analyzed 2h ago  ·  mai-claude   │  ← Status Bar
└─────────────────────────────────────┘
```

### 2.2 Component Breakdown

**Panel Header:**
- Title: "CODE EXPLORER" (matches VS Code panel naming)
- Action buttons (right-aligned):
  - ⚙️ Settings (opens VS Code settings filtered to `codeExplorer`)
  - 🔄 Refresh (re-analyze current tab's symbol)

**Tab Bar:**
- Horizontal scrollable tab strip
- Each tab: icon + short name + close button (×)
- Active tab highlighted with bottom border (accent color)
- Overflow: left/right scroll arrows appear when tabs exceed width
- Maximum visible: as many as fit; scroll for overflow

**Symbol Header:**
- Codicon for symbol kind + symbol name (bold, large)
- File path below (smaller, clickable → navigate to source)
- Container info if applicable (e.g., "in class UserController")

**Sections:**
- Each section has: toggle arrow (▼/▶) + title + optional count badge
- Sections are independently collapsible
- Default state: Overview + Call Stacks expanded, others collapsed
- Thin separator line between header and content

**Status Bar (bottom):**
- Analysis freshness: "Analyzed 2h ago" / "Analyzing..."
- LLM provider badge: "mai-claude" / "static only"
- Staleness warning (if applicable)

---

## 3. Interaction Design

### 3.1 Hover Card (In Editor)

When the user hovers over a symbol in the editor:

```
┌────────────────────────────────────┐
│ $(symbol-class) UserController     │
│ class · 12 usages · 5 call stacks │
│                                    │
│ Handles user-related HTTP endp...  │
│                                    │
│ [Explore in Code Explorer →]       │
└────────────────────────────────────┘
```

**Behavior:**
- Appears after VS Code's default hover delay (~300ms)
- Shows only if symbol is recognized (has VS Code symbol info)
- Summary line if cached, otherwise just kind + name
- "Explore" link opens/focuses tab in sidebar
- Does NOT appear for keywords, operators, or non-symbol tokens

### 3.2 Click → Open Tab

**Trigger:** Right-click → "Explore in Code Explorer" OR `Ctrl+Shift+E` with cursor on symbol

**Flow:**
1. Resolve symbol under cursor
2. Check if tab already exists → focus it
3. If new tab: create tab, show loading state
4. Fetch analysis (cache or fresh)
5. Render analysis in tab
6. Auto-focus sidebar if not visible

### 3.3 Tab Behavior

| Action | Behavior |
|--------|----------|
| Click symbol | Open new tab (or focus existing) |
| Click tab | Switch to that tab |
| × button | Close tab |
| Right-click tab | Context menu: Close, Close Others, Close All |
| Many tabs | Horizontal scroll with ◀ ▶ arrow buttons |
| Auto-focus | Most recently opened tab is always active |
| Duplicate | Clicking same symbol → focuses existing tab (no duplicate) |

### 3.4 Navigation

| UI Element | Click Action |
|-----------|-------------|
| File path in Symbol Header | Open file in editor |
| Usage reference (file:line) | Navigate to that line in editor |
| Call stack node | Navigate to that location in editor |
| Relationship target | Open Code Explorer tab for that symbol |
| Data flow entry | Navigate to that line in editor |

### 3.5 Section Expand/Collapse

- Click section header → toggle
- Smooth height animation (200ms ease-in-out)
- Arrow rotates: ▶ → ▼
- State persisted per tab (not globally)

---

## 4. States & Transitions

### 4.1 Empty State

When no tabs are open (extension just activated, or all tabs closed):

```
┌─────────────────────────────────────┐
│ CODE EXPLORER              ⚙️      │
├─────────────────────────────────────┤
│                                     │
│                                     │
│         $(search) Click on any      │
│         symbol in the editor        │
│         to explore it               │
│                                     │
│         Or right-click →            │
│         "Explore in Code Explorer"  │
│                                     │
│         Shortcut: Ctrl+Shift+E      │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

### 4.2 Loading State

When analysis is in progress:

```
┌─────────────────────────────────────┐
│ CODE EXPLORER              ⚙️  🔄  │
├─────────────────────────────────────┤
│ [UserController]                    │
├─────────────────────────────────────┤
│                                     │
│  $(symbol-class) UserController     │
│  src/controllers/UserController.ts  │
│                                     │
│  ▼ Overview                         │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░ │  ← Skeleton loader
│  ████████████████░░░░░░░░░░░░░░░░ │
│  ████████████░░░░░░░░░░░░░░░░░░░░ │
│                                     │
│  ▼ Call Stacks                      │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│  ████████████████░░░░░░░░░░░░░░░░ │
│  ████████░░░░░░░░░░░░░░░░░░░░░░░░ │
│                                     │
│ ─────────────────────────────────── │
│  $(loading~spin) Analyzing with AI  │
│  Static analysis complete           │
└─────────────────────────────────────┘
```

**Loading Stages:**
1. "Resolving symbol..." (instant)
2. "Running static analysis..." (1-2s)
3. "Analyzing with AI..." (5-30s)
4. Done → render results

If static analysis completes first, show those results immediately while AI continues.

### 4.3 Error State

```
┌─────────────────────────────────────┐
│ CODE EXPLORER              ⚙️  🔄  │
├─────────────────────────────────────┤
│ [UserController]                    │
├─────────────────────────────────────┤
│                                     │
│  $(symbol-class) UserController     │
│  src/controllers/UserController.ts  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │ $(error) Analysis Failed      │  │
│  │                               │  │
│  │ AI provider not available.    │  │
│  │ Showing static analysis only. │  │
│  │                               │  │
│  │ [Configure Provider] [Retry]  │  │
│  └───────────────────────────────┘  │
│                                     │
│  ▼ Usage (5 references)            │  ← Static results still shown
│  ...                                │
│                                     │
└─────────────────────────────────────┘
```

### 4.4 Stale Data State

```
┌─────────────────────────────────────┐
│ CODE EXPLORER              ⚙️  🔄  │
├─────────────────────────────────────┤
│ [UserController]                    │
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ $(warning) Source has changed  │  │  ← Yellow warning banner
│  │ since last analysis           │  │
│  │ [Refresh Analysis]            │  │
│  └───────────────────────────────┘  │
│                                     │
│  $(symbol-class) UserController     │
│  ... (stale data still shown) ...   │
│                                     │
└─────────────────────────────────────┘
```

### 4.5 State Transition Diagram

```mermaid
statediagram-v2
    [*] --> Empty: Extension activated
    Empty --> Loading: Symbol clicked
    Loading --> Ready: Analysis complete
    Loading --> PartialReady: Static done, AI pending
    PartialReady --> Ready: AI complete
    PartialReady --> ErrorPartial: AI failed
    Loading --> Error: All analysis failed
    Ready --> Stale: Source file changed
    Stale --> Loading: Refresh clicked
    Error --> Loading: Retry clicked
    ErrorPartial --> Loading: Retry clicked
    Ready --> Empty: Tab closed (last tab)
    Stale --> Empty: Tab closed (last tab)
```

---

## 5. Color & Icon System

### 5.1 Theme Integration

All colors use VS Code CSS variables:

| Element | CSS Variable |
|---------|-------------|
| Background | `var(--vscode-sideBar-background)` |
| Text | `var(--vscode-sideBar-foreground)` |
| Active tab indicator | `var(--vscode-focusBorder)` |
| Tab background | `var(--vscode-tab-activeBackground)` |
| Section header | `var(--vscode-sideBarSectionHeader-foreground)` |
| Section border | `var(--vscode-sideBarSectionHeader-border)` |
| Link | `var(--vscode-textLink-foreground)` |
| Link hover | `var(--vscode-textLink-activeForeground)` |
| Warning banner bg | `var(--vscode-inputValidation-warningBackground)` |
| Warning banner border | `var(--vscode-inputValidation-warningBorder)` |
| Error banner bg | `var(--vscode-inputValidation-errorBackground)` |
| Error banner border | `var(--vscode-inputValidation-errorBorder)` |
| Skeleton loader | `var(--vscode-editorWidget-background)` |
| Code background | `var(--vscode-textCodeBlock-background)` |
| Badge background | `var(--vscode-badge-background)` |
| Badge foreground | `var(--vscode-badge-foreground)` |

### 5.2 Symbol Kind Icons (Codicons)

| Kind | Codicon | CSS Class |
|------|---------|-----------|
| Class | $(symbol-class) | `.codicon-symbol-class` |
| Function | $(symbol-function) | `.codicon-symbol-function` |
| Method | $(symbol-method) | `.codicon-symbol-method` |
| Variable | $(symbol-variable) | `.codicon-symbol-variable` |
| Interface | $(symbol-interface) | `.codicon-symbol-interface` |
| Type | $(symbol-type-parameter) | `.codicon-symbol-type-parameter` |
| Enum | $(symbol-enum) | `.codicon-symbol-enum` |
| Property | $(symbol-property) | `.codicon-symbol-property` |
| Unknown | $(symbol-misc) | `.codicon-symbol-misc` |

### 5.3 Status Indicators

| Status | Icon | Color Variable |
|--------|------|---------------|
| Fresh | $(check) | `var(--vscode-testing-iconPassed)` (green) |
| Stale | $(warning) | `var(--vscode-testing-iconQueued)` (yellow) |
| Error | $(error) | `var(--vscode-testing-iconFailed)` (red) |
| Loading | $(loading~spin) | `var(--vscode-foreground)` |
| Not analyzed | $(circle-outline) | `var(--vscode-disabledForeground)` |

---

## 6. Responsive Design

### 6.1 Width Adaptations

| Sidebar Width | Adaptation |
|---------------|-----------|
| <250px | Single-column layout, all sections full-width, no table formatting |
| 250-350px | Standard layout (as designed), tables use scrolling |
| 350-500px | Comfortable layout, tables fit well |
| >500px | Extra padding, wider code blocks |

### 6.2 Text Handling

- **Symbol names:** Truncate with ellipsis if too long, full name in tooltip
- **File paths:** Truncate from the left (show `...controllers/UserController.ts`)
- **Context lines:** Horizontal scroll for long code lines
- **Table cells:** Fixed max-width, overflow hidden with tooltip

### 6.3 Section Content Limits

- **Call Stacks:** Show first 5, "Show N more..." link to expand
- **Usage:** Show first 10, "Show N more..." link to expand
- **Data Flow:** Show all (typically <10 entries)
- **Relationships:** Show all (typically <20 entries)

---

## 7. Accessibility

### 7.1 Keyboard Navigation

| Key | Action |
|-----|--------|
| `Tab` | Move focus between sections, buttons, links |
| `Shift+Tab` | Reverse focus |
| `Enter` | Activate focused element (expand section, navigate to source) |
| `Escape` | Close current tab |
| `Ctrl+W` | Close current tab |
| `Ctrl+Tab` | Switch to next tab |
| `Ctrl+Shift+Tab` | Switch to previous tab |
| `↑ / ↓` | Navigate within lists (usages, call stacks) |
| `Space` | Toggle section expand/collapse |

### 7.2 ARIA Labels

```html
<div role="tablist" aria-label="Code Explorer tabs">
  <button role="tab" aria-selected="true" aria-controls="panel-1">
    UserController
  </button>
  <button role="tab" aria-selected="false" aria-controls="panel-2">
    getUser
  </button>
</div>

<div role="tabpanel" id="panel-1" aria-labelledby="tab-1">
  <section aria-label="Overview">
    <button aria-expanded="true" aria-controls="overview-content">
      Overview
    </button>
    <div id="overview-content" role="region">
      ...
    </div>
  </section>
</div>
```

### 7.3 Screen Reader Support

- All interactive elements have descriptive labels
- Status changes announced via `aria-live="polite"` regions
- Analysis completion: "Analysis complete for UserController. 12 usages, 5 call stacks found."
- Staleness warning: "Warning: source code has changed since last analysis."

### 7.4 High Contrast Theme

- All borders visible (minimum 1px solid)
- No color-only indicators (always include text or icon)
- Focus ring always visible (2px solid, high contrast color)
- Text meets WCAG AA contrast ratio (4.5:1)

---

## 8. Settings UI

### 8.1 Configuration Options

Settings are accessed via VS Code Settings UI (filtered to `codeExplorer`):

| Setting | Type | Default | UI Control |
|---------|------|---------|-----------|
| LLM Provider | dropdown | `mai-claude` | Select: mai-claude / copilot-cli / none |
| Auto-Analyze on Save | checkbox | `false` | Toggle |
| Cache TTL (hours) | number | `168` | Number input |
| Max Concurrent Analyses | number | `3` | Number input (1-10) |
| Analysis Depth | dropdown | `standard` | Select: shallow / standard / deep |
| Periodic Analysis (min) | number | `0` | Number input (0 = off) |
| Open on Click | checkbox | `false` | Toggle |
| Show Hover Cards | checkbox | `true` | Toggle |
| Max Call Stack Depth | number | `5` | Number input (1-20) |
| Exclude Patterns | string[] | `["**/node_modules/**"]` | Multi-line text |

### 8.2 Quick Settings Access

The ⚙️ button in the sidebar header opens VS Code Settings filtered to `@ext:code-explorer` — showing only Code Explorer settings.

---

## 9. Wireframes

### 9.1 Full Populated View

```
╔═════════════════════════════════════╗
║ CODE EXPLORER              [⚙] [↻]║
╠═════════════════════════════════════╣
║ [◈ UserCtrl ×] [ƒ getUser ×]      ║
║ ━━━━━━━━━━━━━━                     ║
╠═════════════════════════════════════╣
║                                     ║
║  ◈ UserController                   ║
║  src/controllers/UserController.ts  ║
║                                     ║
║  ▼ Overview ─────────────────────── ║
║  │ Handles user-related HTTP end-   ║
║  │ points for the REST API.         ║
║  │ Extends BaseController and       ║
║  │ provides CRUD operations for     ║
║  │ user resources.                  ║
║                                     ║
║  ▼ Call Stacks (5) ─────────────── ║
║  │                                  ║
║  │ 1. HTTP GET /api/users/:id       ║
║  │    app.ts:42                     ║
║  │    └─ routes/user.ts:15          ║
║  │       └─ UserController.get()    ║
║  │                                  ║
║  │ 2. HTTP POST /api/users          ║
║  │    app.ts:42                     ║
║  │    └─ auth.ts:8                  ║
║  │       └─ routes/user.ts:23       ║
║  │          └─ UserController...    ║
║  │                                  ║
║  │ + Show 3 more...                 ║
║                                     ║
║  ▼ Usage (12 references) ───────── ║
║  │                                  ║
║  │ 📄 routes/user.ts                ║
║  │  :8   new UserController(svc)    ║
║  │  :15  controller.getUser         ║
║  │  :23  controller.createUser      ║
║  │                                  ║
║  │ 📄 routes/admin.ts               ║
║  │  :12  new UserController(adm)    ║
║  │                                  ║
║  │ 📄 test/user.test.ts             ║
║  │  :12  new UserController(mck)    ║
║  │  :45  expect(controller)...      ║
║  │                                  ║
║  │ + Show 5 more...                 ║
║                                     ║
║  ▶ Data Flow ────────────────────── ║
║                                     ║
║  ▶ Relationships ────────────────── ║
║                                     ║
║ ════════════════════════════════════ ║
║  ✓ Analyzed 2h ago · mai-claude     ║
╚═════════════════════════════════════╝
```

### 9.2 Variable Explorer Tab

```
╔═════════════════════════════════════╗
║ CODE EXPLORER              [⚙] [↻]║
╠═════════════════════════════════════╣
║ [◈ UserCtrl] [⊡ userCache ×]      ║
║               ━━━━━━━━━━━━━━       ║
╠═════════════════════════════════════╣
║                                     ║
║  ⊡ userCache                        ║
║  src/controllers/UserController.ts  ║
║  in class UserController            ║
║                                     ║
║  ▼ Overview ─────────────────────── ║
║  │ In-memory LRU cache for user     ║
║  │ objects. Declared as private      ║
║  │ Map<string, User> with max 100   ║
║  │ entries.                         ║
║                                     ║
║  ▼ Lifecycle ────────────────────── ║
║  │                                  ║
║  │ ┌──────┐                        ║
║  │ │CREATE│ L:18 Map<string, User>  ║
║  │ └──┬───┘                        ║
║  │    │                             ║
║  │ ┌──▼──┐                         ║
║  │ │ READ│ L:35 this.userCache.get  ║
║  │ └──┬──┘                         ║
║  │    │                             ║
║  │ ┌──▼─────┐                      ║
║  │ │MODIFIED│ L:42 .set(id, user)  ║
║  │ └──┬─────┘                      ║
║  │    │                             ║
║  │ ┌──▼─────┐                      ║
║  │ │MODIFIED│ L:78 .delete(id)     ║
║  │ └────────┘                      ║
║                                     ║
║  ▼ Usage (4 references) ────────── ║
║  │ :18  private userCache = new..  ║
║  │ :35  const cached = this.use..  ║
║  │ :42  this.userCache.set(id,..)  ║
║  │ :78  this.userCache.delete(id)  ║
║                                     ║
║ ════════════════════════════════════ ║
║  ✓ Analyzed 1h ago · mai-claude     ║
╚═════════════════════════════════════╝
```

### 9.3 Multiple Tabs with Overflow

```
╔═════════════════════════════════════╗
║ CODE EXPLORER              [⚙] [↻]║
╠═════════════════════════════════════╣
║ ◀ [UserCtrl] [getUser] [User] ... ▶║
║                         ━━━━━━     ║
╠═════════════════════════════════════╣
║  (content for active "User" tab)    ║
╚═════════════════════════════════════╝
```

### 9.4 Context Menu on Tab

```
┌─────────────────┐
│ Close            │
│ Close Others     │
│ Close All        │
│ ─────────────── │
│ Refresh Analysis │
│ Copy Symbol Name │
└─────────────────┘
```

### 9.5 Context Menu in Editor

```
┌──────────────────────────────────┐
│ Go to Definition          F12    │
│ Go to Type Definition            │
│ Find All References   Shift+F12  │
│ ──────────────────────────────── │
│ $(search) Explore in Code Explorer  Ctrl+Shift+E │
│ ──────────────────────────────── │
│ Rename Symbol             F2     │
│ ...                              │
└──────────────────────────────────┘
```

---

*End of UI/UX Design Document*
