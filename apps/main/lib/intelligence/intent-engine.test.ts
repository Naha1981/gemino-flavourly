import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreIntent } from './intent-engine.ts';

test('booking has a high-confidence next action',()=>{
 const result=scoreIntent('Can I book a table for 4 tonight?');
 assert.equal(result.intent,'booking');
 assert.ok(result.score>=90);
});
test('safety complaint routes to human',()=>{
 assert.equal(scoreIntent('I need a refund and want to speak to a manager').intent,'complaint');
});
