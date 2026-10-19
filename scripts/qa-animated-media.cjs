'use strict';
// Test harness for a packaged app, always with a disposable profile.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
(async () => {
  const executablePath = process.argv[2];
  if (!executablePath || !path.isAbsolute(executablePath)) throw Error('Pass the absolute packaged executable path');
  const output = path.resolve('qa/results/shapes-media/native');
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'slide-studio-media-qa-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 45000 });
  try {
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('.save-indicator')).toHaveText('저장됨');
    const blank = path.join(output, 'blank.slide');
    await fs.writeFile(blank, JSON.stringify({ version:1,id:'native-media',name:'GIF MP4 WebM native QA',width:1280,height:720,theme:'studio',slides:[{id:'s1',background:'#FFFFFF',notes:'',transition:'none',elements:[]}]}));
    const results = [];
    for (const ext of ['gif','mp4','webm']) {
      await page.locator('input[accept*=".pptx"]').setInputFiles(blank);
      await expect(page.locator('.editable-slide .slide-element')).toHaveCount(0);
      const input = ext === 'gif' ? page.locator('input[accept="image/png,image/jpeg,image/gif,image/webp"]') : page.locator('input[accept*="video/mp4"]');
      await input.setInputFiles(path.resolve(`qa/results/shapes-media/animated.${ext}`));
      await expect(page.locator('.editable-slide .slide-element')).toHaveCount(1);
      await expect(page.locator('.save-indicator')).toHaveText('저장됨');
      await page.reload();
      await expect(page.locator('.editable-slide .slide-element')).toHaveCount(1);
      await page.getByRole('button',{name:'발표 모드',exact:true}).click();
      const media = page.locator(`.present-slide ${ext==='gif'?'img.element-image':'video'}`);
      await expect(media).toBeVisible();
      if(ext!=='gif') await expect.poll(()=>media.evaluate(v=>!v.paused&&v.currentTime>0)).toBe(true);
      const colors = new Set(); const times = [];
      for(let i=0;i<14;i++){
        const pixel = await sharp(await media.screenshot()).resize(1,1).raw().toBuffer();
        colors.add(pixel[0]>pixel[2]?'red':'blue');
        if(ext!=='gif') times.push(await media.evaluate(v=>v.currentTime));
        await page.waitForTimeout(100);
      }
      expect([...colors].sort()).toEqual(['blue','red']);
      if(ext!=='gif') expect(times.some((t,i)=>i&&t<times[i-1]-0.2)).toBe(true);
      await page.screenshot({path:path.join(output,`${ext}-presentation.png`)});
      await page.keyboard.press('Escape');
      await expect(page.locator('video')).toHaveCount(0);
      results.push({format:ext,autoSaveReload:true,animatedPixels:true,loop:ext==='gif'?'original GIF loop preserved':true,stoppedOnExit:true});
    }
    expect(errors).toEqual([]);
    await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({version:await app.evaluate(({app})=>app.getVersion()),executablePath,platform:process.platform,results,errors},null,2)+'\n');
    console.log(JSON.stringify(results));
  } finally { await app.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
