import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLAUDE_MODEL_CATALOG,claudeCatalogSettings,claudeModelOptions,inheritedEffortUnsupported} from '../src/backend/adapters/claude-models';

const lineup=[
 {value:'default',resolvedModel:'claude-opus-5-5',displayName:'Default (recommended)',description:'Use the default model',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
 {value:'opus',resolvedModel:'claude-opus-5-5',displayName:'Opus',description:'Opus 5.5',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
 {value:'fable',resolvedModel:'claude-fable-5-1',displayName:'Fable',description:'Fable 5.1',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
 {value:'sonnet',resolvedModel:'claude-sonnet-5-5',displayName:'Sonnet',description:'Sonnet 5.5',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
 {value:'haiku',resolvedModel:'claude-haiku-5-5',displayName:'Haiku',description:'Haiku 5.5',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
];

test('The catalog is passed to Claude Code as /model picker rows, IDs only',()=>{
 const settings=JSON.parse(claudeCatalogSettings(['claude-opus-4-6','opus[1m]']));
 assert.deepEqual(settings,{modelPicker:{options:[{model:'claude-opus-4-6'},{model:'opus[1m]'}]}});
 assert.ok(CLAUDE_MODEL_CATALOG.length>0&&CLAUDE_MODEL_CATALOG.every(id=>/^[a-z0-9][a-z0-9.\-[\]]*$/.test(id)));
 assert.equal(new Set(CLAUDE_MODEL_CATALOG).size,CLAUDE_MODEL_CATALOG.length);
});

test('Catalog rows keep the names and effort levels Claude Code reported, after its lineup and without repeats',()=>{
 // Shapes recorded from Claude Code 2.1.314 initialize with --settings modelPicker.
 const reported=[...lineup,
  {value:'claude-opus-4-6',resolvedModel:'claude-opus-4-6',displayName:'Opus 4.6',description:'Custom model (claude-opus-4-6)',supportsEffort:true,supportedEffortLevels:['low','medium','high','max']},
  {value:'claude-sonnet-4-5',resolvedModel:'claude-sonnet-4-5',displayName:'Sonnet 4.5',description:'Custom model (claude-sonnet-4-5)'},
  // Not recognised by this CLI: it comes back named after its own ID.
  {value:'claude-sonnet-3-7',resolvedModel:'claude-sonnet-3-7',displayName:'claude-sonnet-3-7',description:'Custom model (claude-sonnet-3-7)',supportsEffort:true,supportedEffortLevels:['low']},
  // Same model as the lineup's Opus row.
  {value:'claude-opus-5-5',resolvedModel:'claude-opus-5-5',displayName:'Opus 5.5',description:'Custom model (claude-opus-5-5)',supportsEffort:true,supportedEffortLevels:['low']},
  // Visible but not selectable.
  {value:'claude-opus-4-5',resolvedModel:'claude-opus-4-5',displayName:'Opus 4.5',description:'Disabled by your organization',disabled:true},
 ];
 const options=claudeModelOptions(reported,['claude-opus-4-6','claude-sonnet-4-5','claude-sonnet-3-7','claude-opus-5-5','claude-opus-4-5']);
 assert.deepEqual(options.map(option=>option.id),['default','opus','fable','sonnet','haiku','claude-opus-4-6','claude-sonnet-4-5']);
 const opus46=options.find(option=>option.id==='claude-opus-4-6')!;
 assert.equal(opus46.label,'Opus 4.6');assert.equal(opus46.group,'catalog');assert.equal(opus46.description,'claude-opus-4-6');
 assert.deepEqual(opus46.efforts,['low','medium','high','max']);assert.equal(opus46.effortSource,'reported');
 const sonnet45=options.find(option=>option.id==='claude-sonnet-4-5')!;
 assert.deepEqual(sonnet45.efforts,[]);assert.equal(sonnet45.effortSource,'unreported');
 assert.ok(options.slice(0,5).every(option=>option.group===undefined));
 assert.equal(options.find(option=>option.isDefault)?.id,'default');
});

test('Without a catalog the CLI rows pass through unchanged',()=>{
 assert.deepEqual(claudeModelOptions(lineup).map(option=>option.id),['default','opus','fable','sonnet','haiku']);
 assert.deepEqual(claudeModelOptions('not a list'),[]);
});

test('A dated lineup row covers the undated catalog row for the same model',()=>{
 // Claude Code 2.1.292: the haiku alias resolves to a dated ID, and the account rows are catalog IDs.
 const reported=[
  {value:'haiku',resolvedModel:'claude-haiku-4-5-20251001',displayName:'Haiku 4.5',description:'Fastest for quick answers'},
  {value:'claude-sonnet-5',resolvedModel:'claude-sonnet-5',displayName:'Sonnet 5',description:'Efficient for routine tasks',supportsEffort:true,supportedEffortLevels:['low']},
  {value:'claude-haiku-4-5',resolvedModel:'claude-haiku-4-5',displayName:'Haiku 4.5',description:'Custom model (claude-haiku-4-5)'},
 ];
 const options=claudeModelOptions(reported,['claude-sonnet-5','claude-haiku-4-5']);
 assert.deepEqual(options.map(option=>option.id),['haiku','claude-sonnet-5']);
 assert.equal(options[1].group,'catalog');
});

test('An inherited thinking level gives way to a model chosen more specifically',()=>{
 const sonnet45={id:'claude-sonnet-4-5',label:'Sonnet 4.5',efforts:[]},opus45={id:'claude-opus-4-5',label:'Opus 4.5',efforts:['low','medium','high']};
 const picked={modelSource:'session',effortSource:'member'} as const;
 assert.equal(inheritedEffortUnsupported('high',sonnet45,picked),true);
 assert.equal(inheritedEffortUnsupported('max',opus45,{modelSource:'session',effortSource:'project'}),true);
 assert.equal(inheritedEffortUnsupported('high',sonnet45,{modelSource:'project',effortSource:'member'}),true);
 assert.equal(inheritedEffortUnsupported('high',sonnet45,{modelSource:'member',effortSource:'executor'}),true);
 assert.equal(inheritedEffortUnsupported('high',opus45,picked),false);
 assert.equal(inheritedEffortUnsupported(undefined,sonnet45,picked),false);
 // Chosen together, with no model chosen, or for a model the CLI did not list: the existing check still stops the turn.
 assert.equal(inheritedEffortUnsupported('high',sonnet45,{modelSource:'session',effortSource:'session'}),false);
 assert.equal(inheritedEffortUnsupported('high',sonnet45,{modelSource:'member',effortSource:'member'}),false);
 assert.equal(inheritedEffortUnsupported('high',sonnet45,{modelSource:'default',effortSource:'member'}),false);
 assert.equal(inheritedEffortUnsupported('high',sonnet45,{} as never),false);
 assert.equal(inheritedEffortUnsupported('high',undefined,picked),false);
 assert.equal(inheritedEffortUnsupported('high',sonnet45,undefined),false);
});