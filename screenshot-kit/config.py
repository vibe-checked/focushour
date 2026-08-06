# Per-app settings for the App Store screenshot kit. Edit this file only.
# Run from this folder:  python3 compose.py

APP_NAME    = "Focus Hour"
TAGLINE     = "A quiet Pomodoro timer"
TITLE_SIZE  = 104
ICON        = "../assets/icon.png"

RAW_DIR     = "raw"
OUT_DIR     = "../app-store-screenshots"

# Brand — sampled from the app icon (near-black bg, ember red->orange ring).
BG_STOPS      = [(46, 35, 38), (22, 20, 26)]   # gradient top->bottom
ACCENT        = (199, 80, 80)                   # c75050
HEADLINE_BOLD = (232, 169, 127)                 # e8a97f
SUBTITLE      = (206, 213, 224)
WATERMARK     = (199, 80, 80)

# Hero (screens 1+2)
HERO_SHOT = "home.png"
HERO_SW   = 1125
HERO_TILT = -20
HERO_PX   = 1050
HERO_SPILL = 120
BULLETS = [
    "The real Pomodoro cycle — short + long breaks",
    "Streaks, a focus heatmap & gentle nudges",
    "Five calming color themes",
    "No ads, no accounts, no tracking",
]

PANEL_SW = 1150

# Feature panels (screens 3+):  (label, headline, raw_filename, "low"|"high", subtitle)
PANELS = [
    ("cycle",   "The *real* Pomodoro cycle",   "timer.png",    "low",  "Short breaks between sessions, then a longer reset"),
    ("themes",  "Make it *yours*",             "settings.png", "high", "Five calming color themes to match your focus"),
    ("streak",  "Built-in *momentum*",         "home.png",     "low",  "A streak counter and a focus heatmap keep you going"),
    ("quiet",   "Stays *out* of your way",     "timer.png",    "high", "A gentle nudge if you drift — never a guilt trip"),
    ("private", "*Nothing* leaves your phone", "settings.png", "low",  "No accounts, no analytics, no ads — ever"),
    ("simple",  "Open it. *Focus*.",           "home.png",     "high", "One tap starts a session — that's the whole app"),
]
