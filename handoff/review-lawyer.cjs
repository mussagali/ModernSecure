const { chromium } = require(`${process.env.TEMP}/modernsecure-review/node_modules/playwright`);
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
 const context = await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:1});
 const page = await context.newPage();
 fs.mkdirSync('.impeccable/review/lawyer',{recursive:true});
 await page.goto('http://localhost:3000/login',{waitUntil:'networkidle',timeout:120000});
 const account=JSON.parse(fs.readFileSync('handoff/accounts.json','utf8')).accounts.lawyer;
 await page.locator('#email').fill(account.email);
 await page.locator('#password').fill(account.password);
 await page.locator('button[type=submit]').click();
 await page.waitForURL('**/staff',{timeout:90000});
 for(const route of ['','cases','clients','review','tasks','calendar','inbox','payments']) {
   await page.goto(`http://localhost:3000/staff${route?'/'+route:''}`,{waitUntil:'networkidle',timeout:120000});
   await page.screenshot({path:`.impeccable/review/lawyer/${route||'home'}-desktop.png`,fullPage:true});
   console.log(route||'home',new URL(page.url()).pathname,'heading',await page.locator('h1').allTextContents(),'overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'alerts',await page.locator('[role=alert]').allTextContents());
 }
 await page.setViewportSize({width:390,height:844});
 for(const route of ['','calendar','tasks']) {
   await page.goto(`http://localhost:3000/staff${route?'/'+route:''}`,{waitUntil:'networkidle',timeout:120000});
   await page.screenshot({path:`.impeccable/review/lawyer/${route||'home'}-mobile.png`,fullPage:true});
   console.log('mobile',route||'home','overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
 }
 } finally { await browser.close(); }
})().catch(e=>{console.error(e.message);process.exit(1)});
