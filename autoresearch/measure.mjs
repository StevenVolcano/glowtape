// Measure placeholder candidates: node autoresearch/measure.mjs "text" ... → px at 17px italic
import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const font = "italic 17px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
for (const t of process.argv.slice(2)) console.log(Math.ceil(await p.evaluate(([t, f]) => { const c = document.createElement('canvas').getContext('2d'); c.font = f; return c.measureText(t).width; }, [t, font])), t);
await b.close();
