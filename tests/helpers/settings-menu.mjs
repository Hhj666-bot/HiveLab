/** Opens every closed group of the settings menu, and the folds of the page on show. */
export async function unfoldSettings(page){
 await page.locator('.settings-nav-group,.settings-fold').first().waitFor({state:'attached'});
 await page.locator('.settings-nav-group,.settings-fold').evaluateAll(nodes=>{for(const node of nodes)node.open=true;});
}
