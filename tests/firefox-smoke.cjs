// Real Firefox smoke test. Uses only synthetic data in a disposable profile.
// Run with Node 24: node tests/firefox-smoke.cjs <geckodriver.exe> <Firefox zip>
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

async function main() {
  const executable = process.argv[2];
  const archive = process.argv[3];
  assert.ok(executable && archive, 'Provide the geckodriver executable and Firefox extension ZIP');
  const fixture = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Pariet synthetic test page</title><h1>Synthetic research page</h1>');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${fixture.address().port}`;
  const reserve = http.createServer();
  await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const driver = spawn(executable, ['--port', String(port), '--allow-system-access'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  driver.stdout.on('data', data => { logs += data; });
  driver.stderr.on('data', data => { logs += data; });
  let session;
  async function command(method, route, data) {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(45000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(`${route}: ${JSON.stringify(result.value)}`);
    return result.value;
  }
  const api = (method, route, data) => command(method, `/session/${session}${route}`, data);
  const execute = (script, ...args) => api('POST', '/execute/sync', { script, args });
  const executeAsync = (script, ...args) => api('POST', '/execute/async', { script, args });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const navigate = url => api('POST', '/url', { url });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await command('GET', '/status'); break; }
      catch (error) { if (attempt > 100 || driver.exitCode !== null) throw error; await pause(100); }
    }
    const result = await command('POST', '/session', { capabilities: { alwaysMatch: {
      browserName: 'firefox', 'moz:firefoxOptions': { binary: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', args: ['-headless'] }
    } } });
    session = result.sessionId;
    console.log('Firefox:', result.capabilities.browserVersion, 'temporary profile:', result.capabilities['moz:profile']);
    await api('POST', '/timeouts', { script: 15000, pageLoad: 30000, implicit: 0 });
    const addon = await api('POST', '/moz/addon/install', { addon: fs.readFileSync(archive).toString('base64'), temporary: true, allowPrivateBrowsing: true });
    console.log('Temporarily loaded:', addon);
    await api('POST', '/moz/context', { context: 'chrome' });
    const uuid = await execute("return JSON.parse(Services.prefs.getStringPref('extensions.webextensions.uuids'))[arguments[0]]", addon);
    await api('POST', '/moz/context', { context: 'content' });
    assert.ok(uuid, 'Extension UUID must exist');
    const popup = `moz-extension://${uuid}/popup.html`;
    const dashboard = `moz-extension://${uuid}/dashboard/index.html`;
    await navigate(popup);
    console.log('Popup:', await execute('return {title:document.title, text:document.body.innerText, browser:typeof browser, chrome:typeof chrome}'));
    const message = request => executeAsync(`const done = arguments[arguments.length - 1];
      browser.runtime.sendMessage(arguments[0]).then(done, error => done({testError:String(error)}));`, request);
    const checked = [];
    const passed = label => { checked.push(label); console.log('PASS:', label); };
    async function until(check, label) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const value = await check();
        if (value) return value;
        await pause(100);
      }
      throw new Error(`Timed out: ${label}`);
    }
    const unwrap = response => { assert.equal(response.ok, true, JSON.stringify(response)); return response.data; };
    const stored = () => executeAsync(`const done=arguments[arguments.length-1];
      const opening=indexedDB.open('pariet'); opening.onerror=()=>done({error:String(opening.error)});
      opening.onsuccess=()=>{ const db=opening.result;
        const names=['sessions','events','pageVisits','searchQueries','positions'];
        const tx=db.transaction(names,'readonly'), result={};
        for(const name of names){ const request=tx.objectStore(name).getAll();request.onsuccess=()=>{result[name]=request.result;}; }
        tx.oncomplete=()=>{db.close();done(result);};tx.onerror=()=>{db.close();done({error:String(tx.error)});};
      };`);
    const switchTo = handle => api('POST', '/window', { handle });
    const control = await api('GET', '/window');
    const newTab = async (url, type = 'tab') => {
      const created = await api('POST', '/window/new', { type });
      await switchTo(created.handle);
      await navigate(url);
      return created.handle;
    };
    assert.equal((await message({ type: 'GET_STATE' })).sessionState.isActive, false);
    assert.deepEqual(unwrap(await message({ type: 'LIST_SESSIONS' })), []);
    const existing = await newTab(`${origin}/preexisting`);
    await switchTo(control);
    // Exercise the popup's actual button handler, rather than constructing session state.
    await execute("document.getElementById('session-title').value='Synthetic Firefox smoke test';document.getElementById('start-btn').click();");
    const active = await until(async () => {
      const response = await message({ type: 'GET_STATE' });
      return response.sessionState?.isActive && response.sessionState;
    }, 'start research from popup');
    const researchId = active.sessionId;
    await switchTo(existing);
    await pause(250);
    await switchTo(control);
    assert.deepEqual(unwrap(await message({ type: 'GET_PAGES', sessionId: researchId })), []);
    assert.deepEqual((await stored()).events, []);
    passed('Untouched pre-existing tabs are not recorded');

    await switchTo(existing);
    await navigate(`${origin}/preexisting-navigated?q=first`);
    await switchTo(control);
    await until(async () => unwrap(await message({ type: 'GET_PAGES', sessionId: researchId })).length === 1, 'eligible navigation');
    passed('Pre-existing tab records after actual navigation');

    const researchTab = await newTab(`${origin}/study?q=science&access_token=TEST_SECRET#TEST_FRAGMENT`);
    await switchTo(control);
    await until(async () => unwrap(await message({ type: 'GET_PAGES', sessionId: researchId })).some(page => page.url === `${origin}/study?q=science`), 'redacted research page');
    const snapshot = await stored();
    assert.equal(JSON.stringify(snapshot).includes('TEST_SECRET'), false);
    assert.equal(JSON.stringify(snapshot).includes('TEST_FRAGMENT'), false);
    passed('Real browser events persist redacted URLs and URL-based IDs');

    const otherWindow = await newTab(`${origin}/other-window-private`, 'window');
    await pause(250);
    await switchTo(control);
    assert.equal(JSON.stringify(await stored()).includes('other-window-private'), false);
    passed('Second-window browsing leaves no raw events or pages');

    // The temporary add-on is explicitly allowed in private browsing, so the
    // test exercises Pariet's own incognito guards rather than Firefox isolation.
    const privateWindow = await executeAsync(`const done=arguments[arguments.length-1];
      browser.windows.create({incognito:true,url:arguments[0]}).then(w=>done({id:w.id,incognito:w.incognito}),e=>done({error:String(e)}));`, `${origin}/incognito-private`);
    assert.equal(privateWindow.incognito, true, JSON.stringify(privateWindow));
    await pause(400);
    assert.equal(JSON.stringify(await stored()).includes('incognito-private'), false);
    passed('Private browsing leaves no raw events or pages');

    await navigate(dashboard);
    await until(async () => (await execute('return document.body.innerText')).includes('Synthetic Firefox smoke test'), 'dashboard archive renders');
    const graph = unwrap(await message({type:'GET_MINDMAP',sessionId:researchId}));
    assert.ok(graph.nodes.filter(node=>node.type==='PAGE').length >= 2, JSON.stringify(graph));
    try {
      await until(async () => (await execute("return document.querySelectorAll('.react-flow__node').length")) >= 3, 'research map nodes render');
    } catch (error) {
      console.log('MAP DIAGNOSTIC', JSON.stringify({graph, page:await execute('return {text:document.body.innerText,html:document.querySelector("main").innerHTML.slice(-6000)}')}));
      await api('POST','/moz/context',{context:'chrome'});
      console.log('BROWSER ERRORS', await execute("return Services.console.getMessageArray().map(m=>m.message).filter(m=>/moz-extension|MindMap|CSP|Content.Security/i.test(m)).slice(-30)"));
      await api('POST','/moz/context',{context:'content'});
      throw error;
    }
    const ui = await execute('return document.body.innerText');
    assert.equal(/something went wrong|could not load|failed to load/i.test(ui), false);
    await api('POST', '/window/rect', { width: 1365, height: 900 });
    const imagePath = path.join(path.dirname(archive), 'firefox-smoke-dashboard.png');
    fs.writeFileSync(imagePath, Buffer.from(await api('GET', '/screenshot'), 'base64'));
    passed('Bundled dashboard renders in Firefox without load errors');

    const beforeRestore = await execute('return browser.tabs.query({}).then(tabs=>tabs.length)');
    const restored = unwrap(await message({ type: 'RESTORE_TABS', urls: [`${origin}/restore-a`, `${origin}/restore-b`], focusUrl: `${origin}/restore-b` }));
    assert.equal(restored.count, 2);
    await until(async () => (await execute('return browser.tabs.query({}).then(tabs=>tabs.length)')) >= beforeRestore + 2, 'restored tabs');
    passed('Research restoration opens the requested tabs');

    unwrap(await message({ type: 'DELETE_SESSION', sessionId: researchId }));
    assert.equal((await message({ type: 'GET_STATE' })).sessionState.isActive, false);
    await switchTo(researchTab);
    await navigate(`${origin}/after-deletion`);
    await switchTo(control);
    assert.deepEqual(unwrap(await message({ type: 'LIST_SESSIONS' })), []);
    const afterDelete = await stored();
    for (const rows of Object.values(afterDelete)) assert.deepEqual(rows, []);
    passed('Deleting active research stops capture and prevents data reappearing');

    const started = await message({ type: 'START_SESSION', title: 'Blocked deletion test' });
    assert.equal(started.success, true, JSON.stringify(started));
    await switchTo(researchTab);
    await navigate(`${origin}/before-wipe`);
    await switchTo(control);
    await until(async () => unwrap(await message({ type: 'GET_PAGES', sessionId: started.sessionId })).length > 0, 'page before wipe');
    await executeAsync(`const done=arguments[arguments.length-1];const r=indexedDB.open('pariet');r.onsuccess=()=>{window.__parietBlockingDb=r.result;done(true);};r.onerror=()=>done(false);`);
    const blocked = await message({ type: 'DELETE_ALL_DATA' });
    assert.equal(blocked.ok, false, JSON.stringify(blocked));
    assert.match(blocked.error, /blocked/i);
    assert.equal((await message({ type: 'GET_STATE' })).sessionState.isActive, false);
    await execute('window.__parietBlockingDb.close();delete window.__parietBlockingDb;');
    await until(async () => { const r=await message({type:'LIST_SESSIONS'});return r.ok && r.data.length === 0; }, 'unblocked deletion');
    assert.deepEqual((await stored()).events, []);
    passed('Blocked delete-all reports failure and erases data after the blocker closes');

    unwrap(await message({type:'DELETE_ALL_DATA'}));
    const migration = await executeAsync(`const done=arguments[arguments.length-1];
      const request=indexedDB.open('pariet',2);
      request.onupgradeneeded=()=>{
        const db=request.result, now=Date.now(), url='https://example.org/research?q=science&access_token=LEGACY_SECRET#LEGACY_FRAGMENT', id='legacy:'+url;
        const sessions=db.createObjectStore('sessions',{keyPath:'id'});sessions.createIndex('startTime','startTime');sessions.createIndex('status','status');
        sessions.put({id:'legacy',title:'Old research kept by its owner',status:'COMPLETED',startTime:now-365*86400000,endTime:now-364*86400000,windowId:1});
        const events=db.createObjectStore('events',{keyPath:'id',autoIncrement:true});events.createIndex('dedup',['tabId','url','timestamp'],{unique:true});events.createIndex('sessionId','sessionId');events.createIndex('timestamp','timestamp');
        events.put({id:1,eventType:'NAVIGATION',sessionId:'legacy',url,title:url,tabId:5,windowId:1,timestamp:now-365*86400000,pageVisitId:id,referrerUrl:url});
        events.put({id:2,eventType:'NAVIGATION',sessionId:null,url:'https://example.org/ORPHAN_SECRET',tabId:6,timestamp:now});
        const pages=db.createObjectStore('pageVisits',{keyPath:'id'});pages.createIndex('sessionId','sessionId');pages.createIndex('lastVisited','lastVisited');
        pages.put({id,sessionId:'legacy',url,title:url,domain:'example.org',firstVisited:now-365*86400000,lastVisited:now-364*86400000,visitCount:1,durationMs:100});
        const searches=db.createObjectStore('searchQueries',{keyPath:'id'});searches.createIndex('sessionId','sessionId');searches.createIndex('timestamp','timestamp');searches.createIndex('pageVisitId','pageVisitId');
        searches.put({id:'search',sessionId:'legacy',sourceUrl:url,queryText:'science',normalizedQuery:'science',engine:'synthetic',timestamp:now-365*86400000,pageVisitId:id});
        db.createObjectStore('positions',{keyPath:'sessionId'}).put({sessionId:'legacy',positions:{[id]:{x:1,y:2}}});
      };
      request.onsuccess=()=>{request.result.close();done(true);};request.onerror=()=>done({error:String(request.error)});`);
    assert.equal(migration, true);
    const legacy = unwrap(await message({type:'LIST_SESSIONS'}));
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].id, 'legacy');
    const upgraded = await stored();
    assert.equal(/LEGACY_SECRET|LEGACY_FRAGMENT|ORPHAN_SECRET/.test(JSON.stringify(upgraded)), false);
    assert.equal(upgraded.pageVisits[0].url, 'https://example.org/research?q=science');
    assert.equal(upgraded.events[0].pageVisitId, upgraded.pageVisits[0].id);
    assert.equal(upgraded.searchQueries[0].pageVisitId, upgraded.pageVisits[0].id);
    assert.ok(upgraded.positions[0].positions[upgraded.pageVisits[0].id]);
    passed('Real IndexedDB upgrade redacts existing records, keys and layouts and removes orphans');
    passed('Year-old research is retained until the user deletes it');
    unwrap(await message({type:'DELETE_ALL_DATA'}));
    assert.deepEqual(unwrap(await message({type:'LIST_SESSIONS'})), []);
    passed('Unblocked delete-all erases every store');

    const report = { browserVersion: result.capabilities.browserVersion, addon, archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'), checks: checked, dashboardScreenshot: imagePath };
    fs.writeFileSync(path.join(path.dirname(archive), 'firefox-smoke-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(logs.slice(-10000));
    throw error;
  } finally {
    if (session) await command('DELETE', `/session/${session}`).catch(() => {});
    driver.kill();
    await new Promise(resolve => fixture.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
