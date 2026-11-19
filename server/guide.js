// Design guidance served to agents: short instructions with every MCP
// session, and the full guide through the get_design_guide tool.

const INSTRUCTIONS = `Verso is a live design canvas open in the user's browser. You design mobile (393×852, iPhone) or web screens as HTML + Tailwind CSS v4, and the user watches them appear.

Workflow:
1. list_projects, then open_project, or create_project for a new idea. This opens the canvas in the browser.
2. Call get_design_guide once per session before your first write_html.
3. For each screen: create_screen, then write_html. Reuse the same theme block on every screen.
4. Check your work with get_screenshot, then refine with surgical tools (set_text, set_class, set_style, replace_node_html). Rewrite a whole screen only for structural changes.
5. When the user says "this", "the selected element" or mentions their notes, call get_selection first.

Images: search_images for real photos, add_image for local files or images you generated. Never use emoji as image placeholders.`

const DESIGN_GUIDE = `# Verso design guide

You are designing production-quality app screens. They should look like polished, shipping products (think Airbnb, Revolut, Spotify), never wireframes.

## The canvas
- Each screen is an iframe. Mobile screens are 393×852 (iPhone 16); web screens are 1440 wide. Set \`platform\` on write_html.
- The renderer preloads Tailwind CSS v4 (browser build), Iconify (\`<iconify-icon>\`) and Google Fonts preconnect.
- Write a body fragment only: no \`<html>\`, \`<head>\` or \`<body>\` tags. Use \`w-full\`, not \`max-w-md\`: the iframe is the viewport.
- Every element gets a \`data-ps-id\` (like \`ps-24\`) after rendering. Use get_tree or get_selection to find ids for surgical edits.

## Theme block (start every screen with it)
Begin every write_html with a Google Fonts \`<link>\` and a \`<style type="text/tailwindcss">\` block that defines the design tokens. Pick a palette that fits the product; do not default to blue. After the first screen, copy the same block verbatim to every new screen so the app stays consistent.

\`\`\`html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style type="text/tailwindcss">
  @theme inline {
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    --color-primary: var(--primary);
    --color-primary-foreground: var(--primary-foreground);
    --color-secondary: var(--secondary);
    --color-secondary-foreground: var(--secondary-foreground);
    --color-muted: var(--muted);
    --color-muted-foreground: var(--muted-foreground);
    --color-accent: var(--accent);
    --color-accent-foreground: var(--accent-foreground);
    --color-destructive: var(--destructive);
    --color-card: var(--card);
    --color-card-foreground: var(--card-foreground);
    --color-border: var(--border);
    --color-input: var(--input);
    --color-ring: var(--ring);
    --font-sans: var(--font-sans);
    --font-heading: var(--font-heading);
    --radius-sm: calc(var(--radius) - 4px);
    --radius-md: calc(var(--radius) - 2px);
    --radius-lg: var(--radius);
    --radius-xl: calc(var(--radius) + 4px);
  }
  :root {
    --background: #FFFFFF;
    --foreground: #1A1C1E;
    --primary: #FF6B35;
    --primary-foreground: #FFFFFF;
    --secondary: #F5F7F9;
    --secondary-foreground: #1A1C1E;
    --muted: #F5F7F9;
    --muted-foreground: #8A9198;
    --accent: #FFF0F0;
    --accent-foreground: #C81E1E;
    --destructive: #EF4444;
    --card: #FFFFFF;
    --card-foreground: #1A1C1E;
    --border: #F0F2F5;
    --input: #F5F7F9;
    --ring: #FF6B35;
    --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
    --font-heading: "Plus Jakarta Sans", system-ui, sans-serif;
    --radius: 1rem;
  }
</style>
\`\`\`

For dark themes, invert the surfaces: \`--background: #0A0A0A; --foreground: #FAFAFA; --card: #1C1C1E; --border: #2C2C2E\`. Pass \`accentColor\`, \`theme\`, \`fontFamily\` and \`iconLibrary\` on write_html so the project settings match.

## Mobile screen skeleton
\`\`\`html
<div class="flex flex-col min-h-screen bg-background text-foreground font-sans w-full relative overflow-hidden pb-24">
  <!-- Status bar -->
  <div class="flex justify-between items-center px-6 pt-3 pb-2 text-xs font-semibold">
    <span>9:41</span>
    <div class="flex items-center gap-1.5">
      <iconify-icon icon="ph:cell-signal-full-fill" class="size-4"></iconify-icon>
      <iconify-icon icon="ph:wifi-high-bold" class="size-4"></iconify-icon>
      <iconify-icon icon="solar:battery-charge-linear" class="size-4"></iconify-icon>
    </div>
  </div>
  <!-- Header, scrollable content … -->
  <!-- Tab bar -->
  <nav class="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-md border-t border-border/50 px-6 pt-2 pb-8 z-50">
    <div class="flex justify-between items-center">
      <button class="flex flex-col items-center gap-1 text-primary">
        <iconify-icon icon="solar:home-2-bold" class="size-6"></iconify-icon>
        <span class="text-[10px] font-semibold">Home</span>
      </button>
      <!-- more tabs use text-muted-foreground and *-linear icons -->
    </div>
  </nav>
</div>
\`\`\`

## Icons
Iconify with the Solar set works well: \`<iconify-icon icon="solar:heart-linear" class="size-5"></iconify-icon>\`. Use \`-bold\` for active or selected states and \`-linear\` for inactive ones. Other good sets: lucide, ph (Phosphor), tabler. Do not mix filled and outline icons in the same context.

## Images
- Call search_images for real photos (products, food, places, people). Embed the returned \`url\` in \`<img src>\` with \`object-cover\`, a clear aspect ratio and rounded corners.
- If you generated an image, or the user gave you one as a local file, call add_image and use the returned \`/files/...\` URL.
- For people's avatars, initials in a colored circle look clean: \`<div class="size-10 rounded-full bg-indigo-500 text-white flex items-center justify-center text-sm font-semibold">SA</div>\`.
- Never use emoji as image placeholders or invent photo URLs. Made-up URLs break.

## Common patterns
- Search bar: \`rounded-2xl bg-input border border-border/50 px-4 py-3\` with a magnifier icon.
- Card: \`bg-card rounded-[20px] p-3 border border-border/60 shadow-sm\`.
- Horizontal list: \`flex overflow-x-auto gap-4 px-6\` with \`style="scrollbar-width:none"\`.
- List row: \`flex items-center gap-3 px-6 py-3 border-b border-border/50\`.
- Badge: \`text-[10px] font-bold px-2 py-1 rounded-full\`.
- Bottom sheet: \`fixed bottom-0 bg-card rounded-t-3xl\` with a drag handle.

## Quality rules
1. Visual hierarchy: bold titles (text-2xl and up), semibold labels, medium secondary text, regular body.
2. Spacing: px-5 or px-6 screen padding, gap-3 or gap-4 between items, generous whitespace.
3. Subtle borders (\`border-border/50\`) and light shadows (\`shadow-sm\`); nothing harsh.
4. Touch targets at least 44px (h-11). Use \`truncate\` for text in tight spaces.
5. \`backdrop-blur-md\` for tab bars, sheets and overlays.
6. Realistic content: real names, prices, dates. Never "Lorem ipsum" or "User Name".
7. Add \`pb-24\` to the main container when there is a fixed tab bar.
8. Never show scrollbars.

## Editing
- Small change (text, color, size, one icon)? Use set_text, set_class, set_style or replace_node_html with the element's \`data-ps-id\`. They leave the rest of the screen untouched.
- If you must use write_html on an existing screen, start from get_screen_html and change only what was asked.
- Asked for a new kind of screen (login, profile, checkout…) while the active screen has content? create_screen first; never overwrite existing work.
- Always write a specific \`changeDescription\` ("Add bottom tab bar with 4 tabs"). It appears in the user's version history and activity feed.

## Project memory
The project keeps a \`designPrompt\`: a written brief of the app (concept, palette with hex codes, typography, screens). Read it with get_design_settings and keep it current by passing \`designPrompt\` to write_html or set_design_settings. The user may edit it, so build on their changes.

## Prototyping
When the user asks for a clickable prototype, call auto_prototype to get every screen's element tree, then set_links to connect buttons, tabs and cards to their target screens.
`

module.exports = { INSTRUCTIONS, DESIGN_GUIDE }
