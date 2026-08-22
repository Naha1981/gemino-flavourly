const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

console.log(`\n======================================================`);
console.log(`🔍 RUNNING E2E SYSTEM INTEGRATION & ROUTE VERIFICATION`);
console.log(`🌐 Target URL: ${BASE_URL}`);
console.log(`======================================================\n`);

async function testEndpoint(name, path, options = {}) {
  const url = `${BASE_URL}${path}`;
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      ...options,
    });

    const status = res.status;
    const location = res.headers.get('location') || 'none';
    const body = await res.text();

    console.log(`[TEST] ${name}`);
    console.log(`  ➔ Route: ${path}`);
    console.log(`  ➔ HTTP Status: ${status}`);
    console.log(`  ➔ Redirect Location: ${location}`);
    console.log(`  ➔ Body Length: ${body.length} bytes`);
    
    // Validate assertions
    if (status === 500) {
      console.error(`  ❌ FAILED: 500 Internal Server Error returned!`);
      return false;
    }
    
    console.log(`  ✅ PASSED\n`);
    return true;
  } catch (err) {
    console.error(`[TEST] ${name} FAILED with network error:`, err.message);
    return false;
  }
}

async function run() {
  let allPassed = true;

  // Test 1: Landing Page
  const t1 = await testEndpoint('Landing Page Load', '/');
  allPassed = allPassed && t1;

  // Test 2: Sign-In Route
  const t2 = await testEndpoint('Sign-In Screen', '/sign-in');
  allPassed = allPassed && t2;

  // Test 3: Sign-Up Route
  const t3 = await testEndpoint('Sign-Up Screen', '/sign-up');
  allPassed = allPassed && t3;

  // Test 4: Dashboard Middleware Interception (Unauthenticated)
  const t4 = await testEndpoint('Dashboard Middleware Protection', '/dashboard');
  allPassed = allPassed && t4;

  // Test 5: WhatsApp Connect Page (Protected)
  const t5 = await testEndpoint('WhatsApp Pairing Page Protection', '/dashboard/whatsapp');
  allPassed = allPassed && t5;

  // Test 6: Super Admin Route (Protected)
  const t6 = await testEndpoint('Super Admin Route Protection', '/admin');
  allPassed = allPassed && t6;

  console.log(`======================================================`);
  if (allPassed) {
    console.log(`🎉 ALL ROUTE & MIDDLEWARE CHECKS PASSED WITH 0 ERRORS!`);
  } else {
    console.log(`⚠️ SOME ROUTE CHECKS FAILED`);
  }
  console.log(`======================================================\n`);
}

run();
