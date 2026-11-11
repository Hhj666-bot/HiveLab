import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from '../../scripts/ui-test-server.mjs';
const server=await createServer({server:{host:'127.0.0.1',port:0},logLevel:'error'});await server.listen();
const browser=await chromium.launch({headless:true,...(process.env.HIVELAB_TEST_BROWSER?{executablePath:process.env.HIVELAB_TEST_BROWSER}:process.platform==='win32'?{channel:'msedge'}:{})});
try{
 const page=await browser.newPage({viewport:{width:1100,height:1000}}),base=server.resolvedUrls.local[0];await page.goto(base+'tests/ui/plugin-market-fixture.html');
 await expect(page.getByRole('heading',{name:'插件市场',exact:true})).toBeVisible();await expect(page.getByText('Memory fixture',{exact:true})).toBeVisible();
 await page.getByRole('searchbox',{name:'搜索市场插件'}).fill('Formatter');await page.getByRole('button',{name:'搜索',exact:true}).click();await expect(page.getByText('Memory fixture',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'读取原生安装预览'}).click();await expect(page.getByRole('heading',{name:'确认原生插件'})).toBeVisible({timeout:10000});
 assert.equal(await page.evaluate(()=>window.marketCalls.filter(c=>c.method==='nativePlugins.start').length),1);assert.equal(await page.evaluate(()=>window.marketCalls.find(c=>c.method==='nativePlugins.start').params.sourceKind),'catalog');
 await expect(page.getByRole('button',{name:'确认原生安装'})).toBeDisabled();
 await page.getByRole('button',{name:'插件市场',exact:true}).click();await page.getByText('检测插件 / Skill 来源的共享能力',{exact:true}).click();await page.getByRole('textbox',{name:'共享来源地址'}).fill('example/portable-workflow');await page.getByRole('button',{name:'读取来源并检测接口'}).click();
 await expect(page.getByRole('heading',{name:'共用能力检测'})).toBeVisible({timeout:10000});await page.getByRole('button',{name:'导入这些共享 Skill'}).click();await expect(page.getByRole('status').filter({hasText:'已导入 1 个'})).toBeVisible();
 await page.getByRole('button',{name:'共享接口',exact:true}).click();await page.getByText('添加 MCP 服务（stdio / Streamable HTTP）',{exact:true}).click();await page.getByRole('textbox',{name:'MCP 连接名称'}).fill('Generic MCP');
 await expect(page.getByRole('button',{name:'添加并测试连接'})).toBeDisabled();await page.getByRole('checkbox',{name:'信任新的 MCP 服务'}).check();await page.getByRole('button',{name:'添加并测试连接'}).click();await expect(page.getByText('1 个工具',{exact:true})).toBeVisible();
 await mkdir('outputs',{recursive:true});await page.screenshot({path:'outputs/plugin-market-ui-test.png',fullPage:true});console.log('Plugin market UI: search, native preview handoff, explicit trust, Skill import and generic MCP flow passed.');
}finally{await browser.close();await server.close();}

