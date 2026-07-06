// Screenshot the schedule (in ?view=image mode) to a PNG for the VRChat Quad.
// The site renders the live schedule; we grab just the .wrap element on the dark
// gradient. Runs in GitHub Actions (see .github/workflows/render.yml) or locally.
//
//   SITE_URL  page to shoot (default: the live site in image mode)
//   OUT       output path      (default: schedule.png)
import { chromium } from 'playwright';

const URL = process.env.SITE_URL
  || 'https://darkhager.github.io/Vrchat-Thai-World-Directory/?view=image';
const OUT = process.env.OUT || 'schedule.png';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 2000 } });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.day-row', { timeout: 30000 });   // schedule rendered
  await page.evaluate(async () => { await document.fonts.ready; }); // Kanit loaded
  await page.waitForTimeout(1200);                               // live override + settle
  const el = await page.$('.wrap');
  await el.screenshot({ path: OUT });
  console.log('wrote ' + OUT);
} finally {
  await browser.close();
}
