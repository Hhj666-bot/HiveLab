/** Host-supplied context must remain readable without becoming a user's control directive. */
export function quotePromptContext(text:string):string {
  return text.split(/\r?\n/).map(line=>'> '+line).join('\n');
}

/** These Hook diagnostics accept a complete standalone prompt, not appended task context. */
export function standaloneHookCommand(text:string):boolean {
  return /^(?:[ \t]*\r?\n)* {0,3}\$stop-that-shit[ \t]+(?:status|runtime(?:[ \t]+all)?|explain[ \t]+evt_[0-9a-f-]+|label[ \t]+evt_[0-9a-f-]+[ \t]+(?:correct|incorrect|inconclusive))[ \t]*(?:\r?\n[ \t]*)*$/i.test(text);
}

/** Never search inside an attachment, quotation or later line for a directive to promote. */
export function userFirstPrompt(userText:string,context:string):string {
  return standaloneHookCommand(userText)?userText:userText+'\n\n'+quotePromptContext(context);
}
