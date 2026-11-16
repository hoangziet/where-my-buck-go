"""Generate a high-definition product demo walkthrough video for Where My Buck Go.

Uses PIL for frame rendering and FFmpeg for video compilation.
Output: demo/where-my-buck-go-demo.mp4 (1080p, 30fps)
"""

import os
import shutil
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WIDTH = 1920
HEIGHT = 1080
BRAND_GREEN = (31, 107, 68)       # #1F6B44
BRAND_LIGHT = (248, 250, 248)     # Off-white / parchment
TEXT_DARK = (17, 24, 39)          # #111827
TEXT_MUTED = (100, 116, 139)      # #64748B
ACCENT_GREEN = (46, 158, 102)     # #2E9E66
WHITE = (255, 255, 255)
CARD_BG = (255, 255, 255)
BORDER_COLOR = (226, 232, 240)

FONT_BOLD_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REGULAR_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_BOLD_PATH if bold else FONT_REGULAR_PATH
    return ImageFont.truetype(path, size)


def draw_header_bar(draw: ImageDraw.ImageDraw, title: str, category: str) -> None:
    # Top banner in slides
    draw.rectangle([(0, 0), (WIDTH, 110)], fill=WHITE)
    draw.line([(0, 110), (WIDTH, 110)], fill=BORDER_COLOR, width=2)
    
    # Brand tag
    draw.rounded_rectangle([(60, 28), (114, 82)], radius=12, fill=BRAND_GREEN)
    font_logo = get_font(32, bold=True)
    draw.text((76, 36), "$", font=font_logo, fill=WHITE)

    font_title = get_font(28, bold=True)
    draw.text((130, 38), "Where My Buck Go", font=font_title, fill=TEXT_DARK)

    # Category badge
    font_badge = get_font(20, bold=True)
    bbox = draw.textbbox((0, 0), category, font=font_badge)
    bw = bbox[2] - bbox[0] + 32
    badge_x = WIDTH - 60 - bw
    draw.rounded_rectangle([(badge_x, 32), (WIDTH - 60, 78)], radius=8, fill=(240, 253, 244))
    draw.rounded_rectangle([(badge_x, 32), (WIDTH - 60, 78)], radius=8, outline=ACCENT_GREEN, width=2)
    draw.text((badge_x + 16, 42), category, font=font_badge, fill=BRAND_GREEN)


def draw_footer_bar(draw: ImageDraw.ImageDraw, step: str, note: str) -> None:
    draw.rectangle([(0, HEIGHT - 80), (WIDTH, HEIGHT)], fill=WHITE)
    draw.line([(0, HEIGHT - 80), (WIDTH, HEIGHT - 80)], fill=BORDER_COLOR, width=2)
    font_step = get_font(22, bold=True)
    draw.text((60, HEIGHT - 54), step, font=font_step, fill=BRAND_GREEN)
    font_note = get_font(20, bold=False)
    draw.text((280, HEIGHT - 53), note, font=font_note, fill=TEXT_MUTED)


def create_slide_1_hero() -> Image.Image:
    im = Image.new("RGB", (WIDTH, HEIGHT), color=BRAND_GREEN)
    draw = ImageDraw.Draw(im)

    # Decorative radial-like circles
    draw.ellipse([(WIDTH // 2 - 450, HEIGHT // 2 - 450), (WIDTH // 2 + 450, HEIGHT // 2 + 450)], outline=(39, 134, 85), width=3)
    draw.ellipse([(WIDTH // 2 - 350, HEIGHT // 2 - 350), (WIDTH // 2 + 350, HEIGHT // 2 + 350)], outline=(46, 158, 102), width=2)

    # Centered Logo Mark
    mark_box = [(WIDTH // 2 - 60, 200), (WIDTH // 2 + 60, 320)]
    draw.rounded_rectangle(mark_box, radius=28, fill=WHITE)
    font_mark = get_font(72, bold=True)
    draw.text((WIDTH // 2 - 25, 220), "$", font=font_mark, fill=BRAND_GREEN)

    # Main Title
    font_hero = get_font(56, bold=True)
    hero_text = "Where My Buck Go"
    bbox = draw.textbbox((0, 0), hero_text, font=font_hero)
    draw.text(((WIDTH - (bbox[2] - bbox[0])) // 2, 360), hero_text, font=font_hero, fill=WHITE)

    # Subtitle
    font_sub = get_font(28, bold=False)
    sub_text = "The Auditable AI Personal Finance Assistant"
    bbox2 = draw.textbbox((0, 0), sub_text, font=font_sub)
    draw.text(((WIDTH - (bbox2[2] - bbox2[0])) // 2, 440), sub_text, font=font_sub, fill=(220, 252, 231))

    # 4 Feature Pills
    features = [
        "Zero Blind Writes (Draft -> Confirm)",
        "100% Deterministic SQL Trace",
        "Sub-5ms Receipt Citations (ETag/304)",
        "Standalone iOS PWA Support",
    ]
    pill_w = 760
    start_y = 540
    font_pill = get_font(22, bold=True)
    for i, feat in enumerate(features):
        py = start_y + i * 70
        px = (WIDTH - pill_w) // 2
        draw.rounded_rectangle([(px, py), (px + pill_w, py + 52)], radius=12, fill=(24, 86, 54))
        draw.rounded_rectangle([(px, py), (px + pill_w, py + 52)], radius=12, outline=(60, 180, 120), width=1)
        draw.text((px + 36, py + 12), f"✓   {feat}", font=font_pill, fill=WHITE)

    # Footer note
    font_url = get_font(22, bold=False)
    url_text = "Live Production: https://d1498jatb9ljtb.cloudfront.net  •  Next.js 16  •  Flask  •  PostgreSQL  •  Gemini 2.5 Flash"
    bbox3 = draw.textbbox((0, 0), url_text, font=font_url)
    draw.text(((WIDTH - (bbox3[2] - bbox3[0])) // 2, 980), url_text, font=font_url, fill=(187, 247, 208))

    return im


def create_slide_2_intake() -> Image.Image:
    im = Image.new("RGB", (WIDTH, HEIGHT), color=BRAND_LIGHT)
    draw = ImageDraw.Draw(im)
    draw_header_bar(draw, "Intake & Receipt OCR", "1. SMART INTAKE & DRAFT CONFIRMATION")

    # Left: Receipt photo & prompt card
    # Load sample receipt
    receipt_path = Path("docs/assets/sample-receipt.png")
    if receipt_path.exists():
        rec_im = Image.open(receipt_path).convert("RGB")
        # Resize preserving aspect ratio to fit height ~680
        h = 680
        w = int(rec_im.width * (h / rec_im.height))
        rec_thumb = rec_im.resize((w, h), Image.Resampling.LANCZOS)
        # Put in card frame
        card_x = 100
        card_y = 170
        draw.rounded_rectangle([(card_x - 8, card_y - 8), (card_x + w + 8, card_y + h + 8)], radius=16, fill=WHITE, outline=BORDER_COLOR, width=2)
        im.paste(rec_thumb, (card_x, card_y))

    # Right: PWA Preview / Draft Card
    mobile_path = Path("docs/assets/pwa-mobile.png")
    if mobile_path.exists():
        mob_im = Image.open(mobile_path).convert("RGB")
        # crop to focus on draft preview card
        h = 680
        w = int(mob_im.width * (h / mob_im.height))
        mob_thumb = mob_im.resize((w, h), Image.Resampling.LANCZOS)
        card_x2 = 600
        card_y2 = 170
        draw.rounded_rectangle([(card_x2 - 8, card_y2 - 8), (card_x2 + w + 8, card_y2 + h + 8)], radius=16, fill=WHITE, outline=BORDER_COLOR, width=2)
        im.paste(mob_thumb, (card_x2, card_y2))

    # Explanation card on far right
    card_x3 = 1100
    card_y3 = 170
    card_w3 = 740
    card_h3 = 696
    draw.rounded_rectangle([(card_x3, card_y3), (card_x3 + card_w3, card_y3 + card_h3)], radius=16, fill=WHITE, outline=BORDER_COLOR, width=2)
    
    font_h2 = get_font(28, bold=True)
    draw.text((card_x3 + 40, card_y3 + 40), "Human-in-the-Loop Confirmation", font=font_h2, fill=TEXT_DARK)
    
    font_desc = get_font(20, bold=False)
    points = [
        ("Multimodal OCR", "Gemini 2.5 Flash Vision extracts merchant, total amount (96.600 VNĐ), and date/time from raw receipt photos."),
        ("Zero Blind Writes", "The assistant NEVER inserts records directly. It proposes an interactive draft preview card."),
        ("ClientClock Sync", "Dates and times ('sáng nay', 'hôm qua') resolve against the client's actual timezone (Asia/Ho_Chi_Minh)."),
        ("Idempotent Locking", "Draft confirmation acquires a PostgreSQL advisory transaction lock with an atomic idempotency key."),
    ]
    curr_y = card_y3 + 100
    for title, desc in points:
        draw.rounded_rectangle([(card_x3 + 40, curr_y), (card_x3 + card_w3 - 40, curr_y + 115)], radius=10, fill=(248, 250, 252))
        draw.text((card_x3 + 60, curr_y + 16), f"• {title}", font=get_font(22, bold=True), fill=BRAND_GREEN)
        # wrap desc
        draw.text((card_x3 + 60, curr_y + 50), desc[:70], font=font_desc, fill=TEXT_DARK)
        draw.text((card_x3 + 60, curr_y + 76), desc[70:], font=font_desc, fill=TEXT_DARK)
        curr_y += 135

    draw_footer_bar(draw, "Step 1 & 2", "Natural Language & Receipt Intake  ->  Draft Preview Card  ->  Confirm & Save")
    return im


def create_slide_3_trace() -> Image.Image:
    im = Image.new("RGB", (WIDTH, HEIGHT), color=BRAND_LIGHT)
    draw = ImageDraw.Draw(im)
    draw_header_bar(draw, "Governed Q&A & SQL Trace", "2. AUDITABLE BY CONSTRUCTION")

    # Screenshot of steps-sql
    sql_path = Path("docs/assets/steps-sql.png")
    if sql_path.exists():
        sql_im = Image.open(sql_path).convert("RGB")
        # Resize to fit nicely on the left / center
        w = 1200
        h = int(sql_im.height * (w / sql_im.width))
        if h > 720:
            h = 720
            w = int(sql_im.width * (h / sql_im.height))
        thumb = sql_im.resize((w, h), Image.Resampling.LANCZOS)
        card_x = 60
        card_y = 155
        draw.rounded_rectangle([(card_x - 6, card_y - 6), (card_x + w + 6, card_y + h + 6)], radius=14, fill=WHITE, outline=BORDER_COLOR, width=2)
        im.paste(thumb, (card_x, card_y))

    # Right side explanation
    rx = 1300
    ry = 155
    rw = 560
    rh = 732
    draw.rounded_rectangle([(rx, ry), (rx + rw, ry + rh)], radius=16, fill=WHITE, outline=BORDER_COLOR, width=2)

    draw.text((rx + 36, ry + 40), "Real-Time Query Audit", font=get_font(28, bold=True), fill=TEXT_DARK)

    notes = [
        ("Deterministic SQL", "All calculations come directly from PostgreSQL aggregates — never guessed by the model prose."),
        ("Parameter Table", "Inspect bound parameters (%s) in an interactive table (owner_id, date range, direction, category)."),
        ("Strict Owner Scoping", "STRUCTURAL ISOLATION: Every query injects owner_id = %(owner_id)s, guaranteeing multi-tenant safety."),
        ("Live Re-run Button", "Instantly refresh query analytics with one click whenever new transactions are saved."),
    ]
    cy = ry + 110
    for t, d in notes:
        draw.rounded_rectangle([(rx + 30, cy), (rx + rw - 30, cy + 125)], radius=10, fill=(240, 253, 244))
        draw.text((rx + 48, cy + 16), f"🔍 {t}", font=get_font(21, bold=True), fill=BRAND_GREEN)
        draw.text((rx + 48, cy + 52), d[:55], font=get_font(18, bold=False), fill=TEXT_DARK)
        draw.text((rx + 48, cy + 78), d[55:], font=get_font(18, bold=False), fill=TEXT_DARK)
        cy += 145

    draw_footer_bar(draw, "Step 3 & 4", "Inspect exact executed SQL  •  Uncensored parameters table  •  Grounded VND numbers")
    return im


def create_slide_4_citations() -> Image.Image:
    im = Image.new("RGB", (WIDTH, HEIGHT), color=BRAND_LIGHT)
    draw = ImageDraw.Draw(im)
    draw_header_bar(draw, "Ledger & Sub-5ms Citations", "3. IMMUTABLE LEDGER & INSTANT EVIDENCE")

    # Show transactions ledger and evidence modal
    tx_path = Path("docs/assets/transactions.png")
    ev_path = Path("docs/assets/evidence-modal.png")
    
    if tx_path.exists():
        tx_im = Image.open(tx_path).convert("RGB")
        w1 = 1000
        h1 = int(tx_im.height * (w1 / tx_im.width))
        t1 = tx_im.resize((w1, min(h1, 720)), Image.Resampling.LANCZOS)
        draw.rounded_rectangle([(54, 154), (54 + w1 + 12, 154 + t1.height + 12)], radius=14, fill=WHITE, outline=BORDER_COLOR, width=2)
        im.paste(t1, (60, 160))

    if ev_path.exists():
        ev_im = Image.open(ev_path).convert("RGB")
        w2 = 740
        h2 = int(ev_im.height * (w2 / ev_im.width))
        t2 = ev_im.resize((w2, min(h2, 420)), Image.Resampling.LANCZOS)
        ex = 1110
        ey = 160
        draw.rounded_rectangle([(ex - 6, ey - 6), (ex + w2 + 6, ey + t2.height + 6)], radius=14, fill=WHITE, outline=BORDER_COLOR, width=2)
        im.paste(t2, (ex, ey))

    # Architecture bullet below evidence preview
    bx = 1110
    by = 610
    bw = 752
    bh = 270
    draw.rounded_rectangle([(bx, by), (bx + bw, by + bh)], radius=14, fill=WHITE, outline=BORDER_COLOR, width=2)
    draw.text((bx + 30, by + 24), "High-Performance Evidence Pipeline", font=get_font(24, bold=True), fill=TEXT_DARK)
    
    bullets = [
        "Batch Pre-population: list_evidence_batch resolves all receipt thumbnails in a single DB query.",
        "SHA-256 ETag & Cache-Control: private, max-age=604800, immutable.",
        "HTTP 304 Revalidation: Subsequent views load in <2ms, skipping S3 round-trips entirely.",
        "Monospace VND Formatting: Right-aligned numbers (+ income green, - expense ink red).",
    ]
    for idx, b in enumerate(bullets):
        draw.text((bx + 30, by + 75 + idx * 44), f"⚡  {b}", font=get_font(18, bold=False), fill=TEXT_DARK)

    draw_footer_bar(draw, "Step 5 & 6", "Batch Evidence Hydration  •  Sub-5ms HTTP 304 Caching  •  Monospace Financial Table")
    return im


def create_slide_5_pwa() -> Image.Image:
    im = Image.new("RGB", (WIDTH, HEIGHT), color=BRAND_LIGHT)
    draw = ImageDraw.Draw(im)
    draw_header_bar(draw, "Dashboard & Standalone iOS PWA", "4. NATIVE MOBILE EXPERIENCE")

    land_path = Path("docs/assets/landing.png")
    mob_path = Path("docs/assets/pwa-mobile.png")

    if land_path.exists():
        l_im = Image.open(land_path).convert("RGB")
        w = 1160
        h = int(l_im.height * (w / l_im.width))
        t_land = l_im.resize((w, min(h, 720)), Image.Resampling.LANCZOS)
        draw.rounded_rectangle([(54, 154), (54 + w + 12, 154 + t_land.height + 12)], radius=14, fill=WHITE, outline=BORDER_COLOR, width=2)
        im.paste(t_land, (60, 160))

    if mob_path.exists():
        m_im = Image.open(mob_path).convert("RGB")
        mh = 720
        mw = int(m_im.width * (mh / m_im.height))
        t_mob = m_im.resize((mw, mh), Image.Resampling.LANCZOS)
        mx = 1350
        my = 160
        draw.rounded_rectangle([(mx - 6, my - 6), (mx + mw + 6, my + mh + 6)], radius=18, fill=WHITE, outline=BORDER_COLOR, width=2)
        im.paste(t_mob, (mx, my))

    draw_footer_bar(draw, "Step 7 & 8", "manifest.webmanifest  •  Dynamic Island safe-area insets  •  Full-screen mobile app")
    return im


def create_slide_6_outro() -> Image.Image:
    im = Image.new("RGB", (WIDTH, HEIGHT), color=BRAND_GREEN)
    draw = ImageDraw.Draw(im)

    # Decorative geometry
    draw.rounded_rectangle([(WIDTH // 2 - 480, 160), (WIDTH // 2 + 480, 880)], radius=24, fill=WHITE)

    # Wordmark
    mark_box = [(WIDTH // 2 - 50, 220), (WIDTH // 2 + 50, 320)]
    draw.rounded_rectangle(mark_box, radius=24, fill=BRAND_GREEN)
    font_mark = get_font(60, bold=True)
    draw.text((WIDTH // 2 - 20, 235), "$", font=font_mark, fill=WHITE)

    font_t = get_font(44, bold=True)
    title = "Where My Buck Go"
    bbox = draw.textbbox((0, 0), title, font=font_t)
    draw.text(((WIDTH - (bbox[2] - bbox[0])) // 2, 350), title, font=font_t, fill=TEXT_DARK)

    font_sub = get_font(24, bold=False)
    sub = "Production Ready  •  Auditable  •  Deterministic"
    bbox2 = draw.textbbox((0, 0), sub, font=font_sub)
    draw.text(((WIDTH - (bbox2[2] - bbox2[0])) // 2, 420), sub, font=font_sub, fill=TEXT_MUTED)

    # Key tech stack cards
    stack = [
        ("Frontend", "Next.js 16 (Turbopack) • React 19 • Tailwind CSS v4 • TypeScript strict"),
        ("Backend", "Python 3.14 • Flask API • Strict Typing (mypy 100%) • Alembic"),
        ("Database", "PostgreSQL 17 • Advisory Transaction Locks • Append-Only Ledger"),
        ("AI & Storage", "Google Gemini 2.5 Flash • AWS S3 / Cloudflare R2 Evidence Store"),
        ("Infrastructure", "AWS CloudFront CDN • Docker Compose • Zero-Downtime Deployments"),
    ]
    sy = 480
    for label, desc in stack:
        draw.rounded_rectangle([(WIDTH // 2 - 420, sy), (WIDTH // 2 + 420, sy + 64)], radius=10, fill=(248, 250, 252))
        draw.text((WIDTH // 2 - 390, sy + 18), label, font=get_font(20, bold=True), fill=BRAND_GREEN)
        draw.text((WIDTH // 2 - 230, sy + 20), desc, font=get_font(17, bold=False), fill=TEXT_DARK)
        sy += 74

    # Live URL banner
    draw.rounded_rectangle([(WIDTH // 2 - 420, 860 - 70), (WIDTH // 2 + 420, 860)], radius=12, fill=BRAND_GREEN)
    font_link = get_font(22, bold=True)
    link_text = "🌐  https://d1498jatb9ljtb.cloudfront.net"
    bbox3 = draw.textbbox((0, 0), link_text, font=font_link)
    draw.text(((WIDTH - (bbox3[2] - bbox3[0])) // 2, 860 - 52), link_text, font=font_link, fill=WHITE)

    return im


def main() -> None:
    demo_dir = Path("demo")
    frames_dir = demo_dir / "frames"
    videos_dir = demo_dir / "videos"
    demo_dir.mkdir(exist_ok=True)
    frames_dir.mkdir(exist_ok=True)
    videos_dir.mkdir(exist_ok=True)

    print("Generating demo slides...")
    slides = [
        ("01_hero.png", create_slide_1_hero()),
        ("02_intake.png", create_slide_2_intake()),
        ("03_trace.png", create_slide_3_trace()),
        ("04_citations.png", create_slide_4_citations()),
        ("05_pwa.png", create_slide_5_pwa()),
        ("06_outro.png", create_slide_6_outro()),
    ]

    for fname, img in slides:
        out_p = frames_dir / fname
        img.save(out_p, quality=95)
        print(f"  Wrote {out_p}")

    # Create concat script for ffmpeg
    # Duration per slide: 6 seconds (total 36s showcase)
    duration_per_slide = 6.0
    concat_txt = demo_dir / "slides.txt"
    with concat_txt.open("w") as f:
        for fname, _ in slides:
            f.write(f"file 'frames/{fname}'\n")
            f.write(f"duration {duration_per_slide}\n")
        # ffmpeg requires the last file to be specified once more without duration
        f.write(f"file 'frames/{slides[-1][0]}'\n")

    out_mp4 = demo_dir / "where-my-buck-go-demo.mp4"
    public_videos_dir = Path("frontend/public/videos")
    public_videos_dir.mkdir(parents=True, exist_ok=True)
    public_mp4 = public_videos_dir / "where-my-buck-go-demo.mp4"
    public_poster = public_videos_dir / "where-my-buck-go-demo.jpg"

    print("Encoding demo video with FFmpeg...")
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_txt),
        "-vf", "fps=30,format=yuv420p",
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-movflags", "+faststart",
        str(out_mp4),
    ]
    subprocess.run(cmd, check=True)
    print(f"Video created: {out_mp4} ({out_mp4.stat().st_size // 1024} KB)")

    # Copy to frontend public
    shutil.copyfile(out_mp4, public_mp4)
    # Save poster
    slides[0][1].save(public_poster, quality=92)
    print(f"Copied to {public_mp4} and created poster {public_poster}")


if __name__ == "__main__":
    main()
