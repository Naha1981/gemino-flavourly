import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyMessageRisk,
  decideApprovalAction,
  worstRiskLevel,
  type ApprovalRiskLevel,
} from './approval-classifier.ts';

describe('approval workflow — risk classification (GREEN/YELLOW/RED)', () => {
  test('a routine booking reply is GREEN and auto-sends', () => {
    const text = 'We would love to host you! To reserve, please share your date, time and party size.';
    assert.equal(classifyMessageRisk(text), 'green');
    const decision = decideApprovalAction(classifyMessageRisk(text));
    assert.deepEqual(decision, { outcome: 'auto_send' });
  });

  test('a menu / hours reply is GREEN', () => {
    const text = `📍 *Marble* Trading Hours: Mon - Sun 12:00 - 22:00\nWe look forward to welcoming you!`;
    assert.equal(classifyMessageRisk(text), 'green');
  });

  test('settling a loyalty balance is GREEN', () => {
    const text = '🌟 You have 250 loyalty points with Marble. Ask staff to redeem on your next visit!';
    assert.equal(classifyMessageRisk(text), 'green');
  });

  test('a promotional offer is YELLOW and requires approval', () => {
    const text = 'Enjoy 2-for-1 on mains this Tuesday only! Reply BOOK to reserve.';
    assert.equal(classifyMessageRisk(text), 'yellow');
    const decision = decideApprovalAction('yellow');
    assert.equal(decision.outcome, 'require_approval');
    if (decision.outcome === 'require_approval') {
      assert.equal(decision.riskLevel, 'yellow');
      assert.match(decision.reason, /Promotional|offer/i);
    }
  });

  test('a refund / money message is RED and held for owner control', () => {
    const text = 'We can issue a full refund for your deposit of R500.';
    assert.equal(classifyMessageRisk(text), 'red');
    const decision = decideApprovalAction('red');
    assert.equal(decision.outcome, 'require_approval');
    if (decision.outcome === 'require_approval') assert.equal(decision.riskLevel, 'red');
  });

  test("a complaint / legal escalation is RED", () => {
    const text = 'Please escalate to the manager immediately — this is a legal matter.';
    assert.equal(classifyMessageRisk(text), 'red');
  });

  test('an empty message is never auto-sent (treated as YELLOW)', () => {
    assert.equal(classifyMessageRisk(''), 'yellow');
    assert.equal(classifyMessageRisk('   '), 'yellow');
  });
});

describe('approval workflow — decision & aggregation', () => {
  test('GREEN is the only risk that auto-sends', () => {
    assert.equal(decideApprovalAction('green').outcome, 'auto_send');
  });

  test('worstRiskLevel is conservative', () => {
    const levels: ApprovalRiskLevel[] = ['green', 'yellow', 'green'];
    assert.equal(worstRiskLevel(levels), 'yellow');
    assert.equal(worstRiskLevel(['green', 'red']), 'red');
    assert.equal(worstRiskLevel(['green']), 'green');
  });
});
