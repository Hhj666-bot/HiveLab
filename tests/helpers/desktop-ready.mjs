import {expect} from '@playwright/test';
/** Ordinary desktop flows enter the workspace; startup playback has its own smoke test. */
export async function enterWorkspace(page){
  const splash=page.locator('#hivelab-startup');
  if(await splash.isVisible())await page.keyboard.press('Escape');
  await expect(splash).toBeHidden({timeout:15000});
  await expandSidebar(page);
}
/** The app opens with its sidebar folded, and these flows use the labels inside it. */
export async function expandSidebar(page){
  await expect(page.locator('#root')).not.toHaveClass(/startup-(stage|entering)/,{timeout:6000});
  const expand=page.getByRole('button',{name:'展开侧栏',exact:true});
  if(await expand.count())await expand.click();
}
/** A connection's settings mount only while its card in 连接与版本 is open. */
export async function openConnection(page,name){
  const head=page.locator('.connection-card-head').filter({has:page.getByText(name,{exact:true})}),region=page.getByRole('region',{name:name+' 的连接',exact:true});
  if(await head.getAttribute('aria-expanded')==='false')await head.click();
  await expect(region).toBeVisible();return region;
}
