const { chromium } = require(`${process.env.TEMP}/modernsecure-review/node_modules/playwright`);
const fs = require('node:fs');
(async () => {
 const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
 const page = await context.newPage();
 fs.mkdirSync('.impeccable/review',{recursive:true});
 await page.goto('http://localhost:3000/login',{waitUntil:'networkidle',timeout:120000});
 await page.screenshot({path:'.impeccable/review/login-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'.impeccable/review/login-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 const account=JSON.parse(fs.readFileSync('handoff/accounts.json','utf8')).accounts.client;
 await page.locator('#email').fill(account.email);
 await page.locator('#password').fill(account.password);
 await page.locator('button[type=submit]').click();
 await Promise.race([page.waitForURL('**/account**',{timeout:30000}),page.locator('.auth-feedback').waitFor({timeout:30000})]);
 console.log('auth status',new URL(page.url()).pathname,await page.locator('.auth-feedback').allTextContents());
 console.log('font',await page.locator('body').evaluate(el=>getComputedStyle(el).fontFamily));
 if(new URL(page.url()).pathname==='/login'){await browser.close();return;}
 await page.waitForLoadState('networkidle');
 await page.screenshot({path:'.impeccable/review/home-mobile.png',fullPage:true});
 console.log('home',await page.locator('h1').allTextContents());
 const cases=await page.locator('.account-case-link').evaluateAll(links=>links.map(a=>a.getAttribute('href')));
 for(const [name,path] of [['more','/account/more'],['documents',cases[0]?`${cases[0]}/documents`:'/account/select-case?section=documents'],['case',cases[0]||'/account/select-case'],...(cases[0]?[['messages',`${cases[0]}/messages`]]:[])]) {
   await page.goto(`http://localhost:3000${path}`,{waitUntil:'networkidle',timeout:120000});
   await page.screenshot({path:`.impeccable/review/${name}-mobile.png`,fullPage:true});
   console.log(name,'overflow',await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),'heading',await page.locator('h1').allTextContents());
 }
 await browser.close();
})().catch(e=>{console.error(e.message);process.exit(1)});
