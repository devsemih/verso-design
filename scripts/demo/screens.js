// Screens the scripted "agent" writes during the README demo: a made-up
// budgeting app. Plain Tailwind + Iconify, like a real agent would write.

const THEME = `<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style type="text/tailwindcss">
  @theme inline {
    --color-background: var(--background);
    --color-foreground: var(--foreground);
    --color-primary: var(--primary);
    --color-primary-foreground: var(--primary-foreground);
    --color-muted: var(--muted);
    --color-muted-foreground: var(--muted-foreground);
    --color-card: var(--card);
    --color-border: var(--border);
    --font-sans: var(--font-sans);
  }
  :root {
    --background: #F4F3F8;
    --foreground: #15131F;
    --primary: #6D5BFF;
    --primary-foreground: #FFFFFF;
    --muted: #ECEAF3;
    --muted-foreground: #8B879C;
    --card: #FFFFFF;
    --border: #E7E5EF;
    --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
  }
</style>`

const STATUS = `<div class="flex justify-between items-center px-7 pt-3.5 pb-1 text-[13px] font-bold">
    <span>9:41</span>
    <div class="flex items-center gap-1.5">
      <iconify-icon icon="ph:cell-signal-full-fill" class="size-4"></iconify-icon>
      <iconify-icon icon="ph:wifi-high-bold" class="size-4"></iconify-icon>
      <iconify-icon icon="solar:battery-full-linear" class="size-5"></iconify-icon>
    </div>
  </div>`

function tabBar(active) {
  const tabs = [
    ['Home', 'solar:home-2'],
    ['Insights', 'solar:chart-2'],
    ['Card', 'solar:card'],
    ['Profile', 'solar:user'],
  ]
  return `<nav class="fixed bottom-0 left-0 right-0 bg-card/90 backdrop-blur-md border-t border-border px-8 pt-2.5 pb-8 z-50">
    <div class="flex justify-between items-center">
      ${tabs.map(([name, icon]) => name === active
        ? `<button class="flex flex-col items-center gap-1 text-primary"><iconify-icon icon="${icon}-bold" class="size-6"></iconify-icon><span class="text-[10px] font-bold">${name}</span></button>`
        : `<button class="flex flex-col items-center gap-1 text-muted-foreground"><iconify-icon icon="${icon}-linear" class="size-6"></iconify-icon><span class="text-[10px] font-semibold">${name}</span></button>`).join('\n      ')}
    </div>
    <div class="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-foreground/80 rounded-full"></div>
  </nav>`
}

const HOME = `${THEME}
<div class="flex flex-col min-h-screen bg-background text-foreground font-sans w-full relative overflow-hidden pb-28">
  ${STATUS}
  <header class="flex items-center justify-between px-6 pt-4">
    <div class="flex items-center gap-3">
      <div class="size-11 rounded-full bg-[#FFDCCB] text-[#B4532A] flex items-center justify-center font-bold text-sm">EK</div>
      <div>
        <p class="text-xs text-muted-foreground font-medium">Good morning</p>
        <p class="font-bold text-[17px] leading-tight">Ece Kaya</p>
      </div>
    </div>
    <button class="size-11 rounded-full bg-card border border-border flex items-center justify-center relative">
      <iconify-icon icon="solar:bell-linear" class="size-5"></iconify-icon>
      <span class="absolute top-2.5 right-3 size-2 rounded-full bg-[#FF5C5C] ring-2 ring-card"></span>
    </button>
  </header>

  <section class="mx-5 mt-5 rounded-[28px] p-5 text-white bg-linear-to-br from-[#7B6BFF] via-[#5B48F2] to-[#3A2BC4] shadow-[0_20px_40px_-18px_rgba(91,72,242,0.7)] relative overflow-hidden">
    <div class="absolute -right-10 -top-14 size-44 rounded-full bg-white/10"></div>
    <div class="absolute right-16 -bottom-20 size-40 rounded-full bg-white/5"></div>
    <div class="flex items-center justify-between relative">
      <p class="text-sm text-white/75 font-medium">Total balance</p>
      <span class="text-[11px] font-bold bg-white/15 px-2.5 py-1 rounded-full flex items-center gap-1"><iconify-icon icon="solar:arrow-right-up-linear" class="size-3"></iconify-icon>2.4%</span>
    </div>
    <p class="text-[40px] font-extrabold tracking-tight mt-1 relative">$12,480<span class="text-white/55 text-2xl">.50</span></p>
    <div class="grid grid-cols-2 gap-2.5 mt-4 relative">
      <button class="h-11 rounded-2xl bg-white text-[#3A2BC4] font-bold text-sm flex items-center justify-center gap-1.5"><iconify-icon icon="solar:add-circle-bold" class="size-5"></iconify-icon>Add money</button>
      <button class="h-11 rounded-2xl bg-white/15 font-bold text-sm flex items-center justify-center gap-1.5"><iconify-icon icon="solar:plain-bold" class="size-5"></iconify-icon>Send</button>
    </div>
  </section>

  <section class="grid grid-cols-4 gap-3 px-6 mt-5">
    <div class="flex flex-col items-center gap-1.5"><div class="size-14 rounded-2xl bg-[#FFF1D6] text-[#D98A00] flex items-center justify-center"><iconify-icon icon="solar:bill-list-bold" class="size-6"></iconify-icon></div><span class="text-[11px] font-semibold">Bills</span></div>
    <div class="flex flex-col items-center gap-1.5"><div class="size-14 rounded-2xl bg-[#DDF6EA] text-[#14935A] flex items-center justify-center"><iconify-icon icon="solar:safe-square-bold" class="size-6"></iconify-icon></div><span class="text-[11px] font-semibold">Savings</span></div>
    <div class="flex flex-col items-center gap-1.5"><div class="size-14 rounded-2xl bg-[#E6E2FF] text-[#5B48F2] flex items-center justify-center"><iconify-icon icon="solar:card-bold" class="size-6"></iconify-icon></div><span class="text-[11px] font-semibold">Cards</span></div>
    <div class="flex flex-col items-center gap-1.5"><div class="size-14 rounded-2xl bg-[#FFE3E6] text-[#E2445C] flex items-center justify-center"><iconify-icon icon="solar:widget-bold" class="size-6"></iconify-icon></div><span class="text-[11px] font-semibold">More</span></div>
  </section>

  <section class="mx-5 mt-5 bg-card rounded-[24px] p-4 border border-border">
    <div class="flex items-center justify-between">
      <div>
        <p class="text-xs text-muted-foreground font-medium">Spent this month</p>
        <p class="text-2xl font-extrabold tracking-tight">$2,340</p>
      </div>
      <span class="text-xs font-semibold text-muted-foreground bg-muted px-3 py-1.5 rounded-full">November</span>
    </div>
    <div class="flex items-end gap-2.5 h-20 mt-3">
      <div class="flex-1 rounded-lg bg-muted h-[45%]"></div>
      <div class="flex-1 rounded-lg bg-muted h-[70%]"></div>
      <div class="flex-1 rounded-lg bg-muted h-[38%]"></div>
      <div class="flex-1 rounded-lg bg-muted h-[85%]"></div>
      <div class="flex-1 rounded-lg bg-muted h-[55%]"></div>
      <div class="flex-1 rounded-lg bg-muted h-[30%]"></div>
      <div class="flex-1 rounded-lg bg-primary h-full"></div>
    </div>
    <div class="flex justify-between text-[10px] text-muted-foreground font-semibold mt-1.5 px-2">
      <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span class="text-primary">S</span>
    </div>
  </section>

  <section class="px-6 mt-5">
    <div class="flex items-center justify-between mb-2">
      <h2 class="font-bold">Recent</h2>
      <span class="text-xs font-semibold text-primary">See all</span>
    </div>
    <div class="flex items-center gap-3 py-2.5">
      <div class="size-11 rounded-2xl bg-[#FFF1D6] text-[#B86E00] flex items-center justify-center"><iconify-icon icon="solar:cup-hot-bold" class="size-5"></iconify-icon></div>
      <div class="flex-1"><p class="font-semibold text-sm">Blue Bottle Coffee</p><p class="text-xs text-muted-foreground">Today, 8:12</p></div>
      <p class="font-bold text-sm">−$6.40</p>
    </div>
  </section>
  ${tabBar('Home')}
</div>`

const INSIGHTS = `${THEME}
<div class="flex flex-col min-h-screen bg-background text-foreground font-sans w-full relative overflow-hidden pb-28">
  ${STATUS}
  <header class="flex items-center justify-between px-6 pt-4">
    <h1 class="text-[28px] font-extrabold tracking-tight">Insights</h1>
    <button class="size-11 rounded-full bg-card border border-border flex items-center justify-center"><iconify-icon icon="solar:calendar-linear" class="size-5"></iconify-icon></button>
  </header>

  <div class="mx-6 mt-4 p-1 bg-muted rounded-2xl grid grid-cols-3 text-sm font-semibold">
    <button class="h-9 rounded-xl text-muted-foreground">Week</button>
    <button class="h-9 rounded-xl bg-card shadow-sm">Month</button>
    <button class="h-9 rounded-xl text-muted-foreground">Year</button>
  </div>

  <section class="mx-5 mt-5 bg-card rounded-[28px] p-5 border border-border">
    <div class="flex items-center gap-5">
      <div class="relative size-36 shrink-0">
        <svg viewBox="0 0 36 36" class="size-36 -rotate-90">
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#ECEAF3" stroke-width="3.6"></circle>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#6D5BFF" stroke-width="3.6" stroke-dasharray="38 100" stroke-linecap="round"></circle>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#FFB020" stroke-width="3.6" stroke-dasharray="24 100" stroke-dashoffset="-41" stroke-linecap="round"></circle>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#22C38E" stroke-width="3.6" stroke-dasharray="18 100" stroke-dashoffset="-68" stroke-linecap="round"></circle>
          <circle cx="18" cy="18" r="15.9" fill="none" stroke="#FF6B81" stroke-width="3.6" stroke-dasharray="10 100" stroke-dashoffset="-89" stroke-linecap="round"></circle>
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <p class="text-[11px] text-muted-foreground font-semibold">Spent</p>
          <p class="text-xl font-extrabold tracking-tight">$2,340</p>
        </div>
      </div>
      <div class="flex-1 space-y-2.5 text-sm">
        <div class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-[#6D5BFF]"></span><span class="flex-1 font-medium">Housing</span><span class="font-bold">38%</span></div>
        <div class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-[#FFB020]"></span><span class="flex-1 font-medium">Food</span><span class="font-bold">24%</span></div>
        <div class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-[#22C38E]"></span><span class="flex-1 font-medium">Travel</span><span class="font-bold">18%</span></div>
        <div class="flex items-center gap-2"><span class="size-2.5 rounded-full bg-[#FF6B81]"></span><span class="flex-1 font-medium">Fun</span><span class="font-bold">10%</span></div>
      </div>
    </div>
  </section>

  <section class="px-6 mt-6 space-y-4">
    <h2 class="font-bold">Budgets</h2>
    <div class="bg-card rounded-[22px] p-4 border border-border">
      <div class="flex items-center gap-3">
        <div class="size-11 rounded-2xl bg-[#FFF1D6] text-[#D98A00] flex items-center justify-center"><iconify-icon icon="solar:cart-large-2-bold" class="size-5"></iconify-icon></div>
        <div class="flex-1"><p class="font-semibold text-sm">Groceries</p><p class="text-xs text-muted-foreground">$420 of $600</p></div>
        <p class="text-xs font-bold text-[#D98A00]">70%</p>
      </div>
      <div class="h-2 rounded-full bg-muted mt-3"><div class="h-2 rounded-full bg-[#FFB020] w-[70%]"></div></div>
    </div>
    <div class="bg-card rounded-[22px] p-4 border border-border">
      <div class="flex items-center gap-3">
        <div class="size-11 rounded-2xl bg-[#DDF6EA] text-[#14935A] flex items-center justify-center"><iconify-icon icon="solar:map-point-bold" class="size-5"></iconify-icon></div>
        <div class="flex-1"><p class="font-semibold text-sm">Weekend trip</p><p class="text-xs text-muted-foreground">$310 of $800</p></div>
        <p class="text-xs font-bold text-[#14935A]">39%</p>
      </div>
      <div class="h-2 rounded-full bg-muted mt-3"><div class="h-2 rounded-full bg-[#22C38E] w-[39%]"></div></div>
    </div>
  </section>
  ${tabBar('Insights')}
</div>`

const CARD = `${THEME}
<div class="flex flex-col min-h-screen bg-background text-foreground font-sans w-full relative overflow-hidden pb-28">
  ${STATUS}
  <header class="flex items-center justify-between px-6 pt-4">
    <h1 class="text-[28px] font-extrabold tracking-tight">My card</h1>
    <button class="h-10 px-4 rounded-full bg-card border border-border flex items-center gap-1.5 text-sm font-semibold"><iconify-icon icon="solar:add-circle-linear" class="size-4"></iconify-icon>New</button>
  </header>

  <section class="mx-6 mt-5 aspect-[1.6] rounded-[26px] p-5 text-white bg-[#15131F] relative overflow-hidden shadow-[0_24px_40px_-20px_rgba(21,19,31,0.8)]">
    <div class="absolute -right-16 -top-16 size-56 rounded-full bg-linear-to-br from-[#7B6BFF] to-[#FF6B81] opacity-80 blur-sm"></div>
    <div class="absolute -left-10 -bottom-24 size-48 rounded-full bg-[#6D5BFF]/40"></div>
    <div class="relative flex flex-col h-full">
      <div class="flex items-center justify-between">
        <p class="font-extrabold text-lg tracking-tight">pocket</p>
        <div class="w-10 h-7 rounded-md bg-linear-to-br from-[#F5D58A] to-[#C9A24D] border border-white/20"></div>
      </div>
      <p class="mt-auto font-semibold tracking-[0.2em] text-[15px]">•••• •••• •••• 4821</p>
      <div class="flex items-end justify-between mt-2">
        <div><p class="text-[10px] text-white/55 font-semibold uppercase tracking-wider">Card holder</p><p class="text-sm font-bold">Ece Kaya</p></div>
        <p class="text-sm font-bold">09/29</p>
      </div>
    </div>
  </section>

  <section class="mx-5 mt-6 bg-card rounded-[24px] border border-border divide-y divide-border">
    <div class="flex items-center gap-3 p-4">
      <div class="size-10 rounded-xl bg-[#E6E2FF] text-[#5B48F2] flex items-center justify-center"><iconify-icon icon="solar:snowflake-bold" class="size-5"></iconify-icon></div>
      <p class="flex-1 font-semibold text-sm">Freeze card</p>
      <div class="w-12 h-7 rounded-full bg-muted p-0.5"><div class="size-6 rounded-full bg-white shadow"></div></div>
    </div>
    <div class="flex items-center gap-3 p-4">
      <div class="size-10 rounded-xl bg-[#DDF6EA] text-[#14935A] flex items-center justify-center"><iconify-icon icon="solar:global-bold" class="size-5"></iconify-icon></div>
      <p class="flex-1 font-semibold text-sm">Online payments</p>
      <div class="w-12 h-7 rounded-full bg-primary p-0.5 flex justify-end"><div class="size-6 rounded-full bg-white shadow"></div></div>
    </div>
    <div class="p-4">
      <div class="flex items-center justify-between text-sm"><p class="font-semibold">Monthly limit</p><p class="font-bold">$1,800 <span class="text-muted-foreground font-medium">/ $3,000</span></p></div>
      <div class="h-2 rounded-full bg-muted mt-3"><div class="h-2 rounded-full bg-primary w-[60%]"></div></div>
    </div>
  </section>
  ${tabBar('Card')}
</div>`

// The note in the demo asks for a warmer balance card; this is the agent's fix.
const WARM_CARD_CLASS = 'mx-5 mt-5 rounded-[28px] p-5 text-white bg-linear-to-br from-[#FF9A5A] via-[#FF6B6B] to-[#E0457B] shadow-[0_20px_40px_-18px_rgba(255,107,107,0.75)] relative overflow-hidden'

const DESIGN_PROMPT = 'Pocket: a friendly personal budgeting app. Soft lavender background #F4F3F8, violet primary #6D5BFF, Plus Jakarta Sans, big bold numbers, rounded nested cards. Screens: Home (balance card, quick actions, spending chart, recent activity), Insights (category donut, budgets), Card (card visual, controls, limit).'

module.exports = { HOME, INSIGHTS, CARD, WARM_CARD_CLASS, DESIGN_PROMPT }
