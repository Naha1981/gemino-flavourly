import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiBudgetLabel } from './ai-budget.ts';

test('labels bounded budget',()=>assert.match(aiBudgetLabel({allowed:true,limit:100,used:25,remaining:75}),/75 AI turns/));
test('labels group as unlimited',()=>assert.equal(aiBudgetLabel({allowed:true,limit:null,used:0,remaining:null}),'Unlimited plan'));
