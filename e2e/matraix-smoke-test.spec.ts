import { test, expect, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PERSONAS_DIR = path.join(__dirname, '..', 'personas');
const SCENARIOS_DIR = path.join(__dirname, '..', 'scenarios');
const EVIDENCE_DIR = path.join(__dirname, '..', 'evidence');
const REPORTS_DIR = path.join(__dirname, '..', 'reports');

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function getPersonas(): any[] {
  return fs.readdirSync(PERSONAS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => loadJson(path.join(PERSONAS_DIR, f)));
}

function getScenario(id: string): any {
  const files = fs.readdirSync(SCENARIOS_DIR).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const scenario = loadJson(path.join(SCENARIOS_DIR, f));
    if (scenario.scenario_id === id) return scenario;
  }
  throw new Error(`Scenario ${id} not found`);
}

const BASE_URL = process.env.SYNTHETIC_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';

test.describe('MatrAIx Synthetic QA', () => {
  test.setTimeout(120000);

  test.beforeEach(() => {
    if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  });

  test.describe('Sign-Up Flow Smoke Test (10 personas)', () => {
    const personas = getPersonas();
    const scenario = getScenario('user_signs_up_and_onboards');

    for (const persona of personas) {
      test(`${persona.name} - ${scenario.name}`, async ({ page }) => {
        const errors: string[] = [];
        const screenshots: string[] = [];

        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(msg.text());
        });

        page.on('response', (response) => {
          if (response.status() >= 500) {
            errors.push(`${response.url()} - ${response.status()}`);
          }
        });

        page.on('requestfailed', (request) => {
          errors.push(`${request.url()} - failed`);
        });

        const steps: any[] = [];
        const maxSteps = scenario.max_steps || 25;

        await page.goto(`${BASE_URL}${scenario.target_url}`);
        await page.waitForTimeout(2000);

        for (let step = 1; step <= maxSteps; step++) {
          const screenshotPath = path.join(EVIDENCE_DIR, `${persona.persona_id}-step-${step}.png`);
          await page.screenshot({ path: screenshotPath });
          screenshots.push(path.basename(screenshotPath));

          const url = page.url();
          const title = await page.title();

          let actionTaken = false;

          const visibleInputs = await page.locator('input:visible, textarea:visible').all();
          const visibleButtons = await page.locator('button:visible, [role="button"]:visible').all();
          const clerkForm = await page.locator('.cl-rootBox, .cl-signUp-root, form').count();

          if (step === 1) {
            await page.waitForTimeout(2000);
            actionTaken = true;
          } else if (step === 2 && clerkForm > 0) {
            actionTaken = true;
          } else if (visibleInputs.length > 0 && step < 5) {
            const firstInput = visibleInputs[0];
            const inputType = await firstInput.getAttribute('type');
            const placeholder = await firstInput.getAttribute('placeholder') || '';
            const name = await firstInput.getAttribute('name') || '';

            if (inputType === 'email' || name.toLowerCase().includes('email') || placeholder.toLowerCase().includes('email')) {
              await firstInput.fill(`test-${persona.persona_id}@example.com`);
              actionTaken = true;
            } else if (inputType === 'password' || name.toLowerCase().includes('password') || placeholder.toLowerCase().includes('password')) {
              await firstInput.fill('TestPassword123!');
              actionTaken = true;
            } else if (inputType === 'text' && step === 3) {
              await firstInput.fill(`Test ${persona.name}`);
              actionTaken = true;
            }
          } else if (visibleButtons.length > 0 && step >= 4) {
            const submitBtn = visibleButtons.find(async (btn) => {
              const text = await btn.innerText();
              return text.toLowerCase().includes('sign up') || text.toLowerCase().includes('continue') || text.toLowerCase().includes('submit');
            });
            if (submitBtn) {
              await submitBtn.click();
              actionTaken = true;
            } else if (visibleButtons.length > 0) {
              await visibleButtons[0].click();
              actionTaken = true;
            }
          }

          steps.push({
            step,
            action: actionTaken ? 'interacted' : 'waited',
            url,
            title,
            timestamp: new Date().toISOString(),
          });

          await page.waitForTimeout(2000);

          const currentUrl = page.url();
          if (currentUrl.includes('/onboarding') || currentUrl.includes('/dashboard')) {
            break;
          }
          if (currentUrl === 'about:blank') {
            break;
          }
        }

        const finalUrl = page.url();
        const success = finalUrl.includes('/onboarding') || finalUrl.includes('/dashboard');

        const report = {
          persona_id: persona.persona_id,
          scenario_id: scenario.scenario_id,
          success,
          steps,
          evidence: {
            screenshots,
            console_errors: errors,
            final_url: finalUrl,
          },
          timestamp: new Date().toISOString(),
        };

        const reportPath = path.join(REPORTS_DIR, `${persona.persona_id}-${scenario.scenario_id}-report.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        if (!success) {
          test.info().annotations.push({ type: 'failure', description: `Final URL: ${finalUrl} | Errors: ${errors.join(', ')}`);
        }

        expect(success).toBe(true);
      });
    }
  });

  test.describe('Landing Page Engagement Smoke Test', () => {
    const personas = getPersonas();
    const scenario = getScenario('landing_page_engagement');

    for (const persona of personas) {
      test(`${persona.name} - ${scenario.name}`, async ({ page }) => {
        const errors: string[] = [];
        const screenshots: string[] = [];

        page.on('console', (msg) => {
          if (msg.type() === 'error') errors.push(msg.text());
        });

        await page.goto(`${BASE_URL}${scenario.target_url}`);
        await page.waitForTimeout(2000);

        const screenshotPath = path.join(EVIDENCE_DIR, `${persona.persona_id}-landing-step-1.png`);
        await page.screenshot({ path: screenshotPath });
        screenshots.push(path.basename(screenshotPath));

        const cta = page.locator('button:has-text("Get Started"), button:has-text("Sign Up"), [href*="sign-up"]').first();
        if (await cta.count() > 0) {
          await cta.click();
          await page.waitForTimeout(2000);
        }

        const finalUrl = page.url();
        const success = finalUrl.includes('/sign-up') || finalUrl.includes('/sign-in');

        const report = {
          persona_id: persona.persona_id,
          scenario_id: scenario.scenario_id,
          success,
          evidence: { screenshots, console_errors: errors, final_url: finalUrl },
          timestamp: new Date().toISOString(),
        };

        const reportPath = path.join(REPORTS_DIR, `${persona.persona_id}-${scenario.scenario_id}-report.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        expect(success).toBe(true);
      });
    }
  });
});
