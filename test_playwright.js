const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER_CONSOLE:', msg.text()));
  page.on('pageerror', error => console.log('BROWSER_ERROR:', error.message));
  page.on('response', response => {
    if (response.url().includes('/api/')) {
      console.log('API_RESPONSE:', response.url(), response.status());
    }
  });

  await page.goto('http://localhost:5173');
  await page.fill('input[placeholder="Paste video URL here..."]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.click('button:has-text("Analyze")');
  
  console.log('Waiting for formats...');
  await page.waitForSelector('.format-card', { timeout: 30000 });
  
  console.log('Clicking Audio format...');
  await page.click('.format-category:has-text("Audio Only") .format-card');
  
  console.log('Clicking Download...');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(e => console.log('Download event timeout')),
    page.click('button:has-text("Download")')
  ]);
  
  if (download) {
    console.log('Download started! URL:', download.url());
  }
  
  await page.waitForTimeout(2000);
  const text = await page.content();
  if (text.includes('Download started in your browser')) {
    console.log('Toast found!');
  } else {
    console.log('Toast NOT found!');
  }
  
  await browser.close();
})();
