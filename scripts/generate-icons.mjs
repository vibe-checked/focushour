// Generates the app icon + splash mark from a single vector design.
// Run with: node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'assets');

const BG = '#16151a';
const FOCUS = '#c75050';
const ACCENT = '#e8a97f';

// A partial dial ring — the same "in-progress focus session" motif as the
// in-app DialRing — swept clockwise from 12 o'clock, with a small dot at the
// leading tip standing in for a clock hand.
function ringMark({ size, cx, cy, radius, stroke, fraction, includeDot = true }) {
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * fraction;
  const gap = circumference - dash;
  const angle = fraction * 360 - 90; // leading-tip angle, 0deg = 3 o'clock
  const tipX = cx + radius * Math.cos((angle * Math.PI) / 180);
  const tipY = cy + radius * Math.sin((angle * Math.PI) / 180);
  const dotR = stroke * 0.62;

  return `
    <defs>
      <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${FOCUS}"/>
        <stop offset="100%" stop-color="${ACCENT}"/>
      </linearGradient>
    </defs>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
      stroke="rgba(255,255,255,0.08)" stroke-width="${stroke}"/>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
      stroke="url(#ring)" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${dash} ${gap}"
      transform="rotate(-90 ${cx} ${cy})"/>
    ${includeDot ? `<circle cx="${tipX}" cy="${tipY}" r="${dotR}" fill="${ACCENT}"/>` : ''}
  `;
}

async function renderPng(svg, size, outFile, { flatten = false } = {}) {
  let img = sharp(Buffer.from(svg)).resize(size, size);
  if (flatten) img = img.flatten({ background: BG });
  await img.png().toFile(path.join(OUT, outFile));
  console.log('wrote', outFile, `${size}x${size}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const S = 1024;

  // --- iOS app icon: opaque, dark bg, ring at ~72% progress ---
  const iconSvg = `
    <svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${S}" height="${S}" fill="${BG}"/>
      ${ringMark({ size: S, cx: S / 2, cy: S / 2, radius: 340, stroke: 88, fraction: 0.72 })}
    </svg>
  `;
  await renderPng(iconSvg, S, 'icon.png', { flatten: true });

  // --- splash mark: transparent, composited over backgroundColor at runtime ---
  const splashSvg = `
    <svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
      ${ringMark({ size: S, cx: S / 2, cy: S / 2, radius: 340, stroke: 88, fraction: 0.72 })}
    </svg>
  `;
  await renderPng(splashSvg, S, 'splash-icon.png');

  // --- Android adaptive icon (safe zone ~66% of canvas) ---
  const androidFgSvg = `
    <svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
      ${ringMark({ size: S, cx: S / 2, cy: S / 2, radius: 230, stroke: 60, fraction: 0.72 })}
    </svg>
  `;
  await renderPng(androidFgSvg, S, 'android-icon-foreground.png');

  const androidBgSvg = `
    <svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${S}" height="${S}" fill="${BG}"/>
    </svg>
  `;
  await renderPng(androidBgSvg, S, 'android-icon-background.png');

  // --- Android themed monochrome icon: single flat fill, no gradient ---
  const androidMonoSvg = `
    <svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${S / 2}" cy="${S / 2}" r="230" fill="none"
        stroke="#ffffff" stroke-width="60" stroke-linecap="round"
        stroke-dasharray="${2 * Math.PI * 230 * 0.72} ${2 * Math.PI * 230 * 0.28}"
        transform="rotate(-90 ${S / 2} ${S / 2})"/>
    </svg>
  `;
  await renderPng(androidMonoSvg, S, 'android-icon-monochrome.png');

  // --- favicon (web preview only) ---
  const faviconSvg = `
    <svg width="196" height="196" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${S}" height="${S}" fill="${BG}"/>
      ${ringMark({ size: S, cx: S / 2, cy: S / 2, radius: 340, stroke: 96, fraction: 0.72, includeDot: false })}
    </svg>
  `;
  await renderPng(faviconSvg, 196, 'favicon.png', { flatten: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
