import asyncio, time, json, wave, re, shutil, os, sys
from playwright.async_api import async_playwright
from narration import N
from slides import TITLE, RESULTS, END
DUR = json.load(open('audio/dur.json'))
OFFS = {}   # key -> start offset (s) in video timeline
CURSOR_JS = """
(() => { const d = document.createElement('div'); d.id='__cur';
 d.style.cssText='position:fixed;z-index:99999;width:22px;height:22px;border-radius:50%;border:3px solid #ffc24b;background:rgba(255,194,75,.25);pointer-events:none;left:-50px;top:-50px;transform:translate(-50%,-50%);transition:transform .08s';
 const add=()=>document.documentElement.appendChild(d); if(document.documentElement) add(); else addEventListener('DOMContentLoaded',add);
 addEventListener('mousemove',e=>{d.style.left=e.clientX+'px';d.style.top=e.clientY+'px'},true);
 addEventListener('mousedown',()=>d.style.transform='translate(-50%,-50%) scale(.6)',true);
 addEventListener('mouseup',()=>d.style.transform='translate(-50%,-50%) scale(1)',true); })();
"""
T0 = None
now = lambda: time.time() - T0

async def move_click(pg, sel, text=None, click=True, steps=25):
    loc = pg.get_by_text(text, exact=True).first if text else pg.locator(sel).first
    await loc.scroll_into_view_if_needed()
    bb = await loc.bounding_box()
    await pg.mouse.move(bb['x'] + bb['width']/2, bb['y'] + bb['height']/2, steps=steps)
    if click: await loc.click()

async def wheel(pg, x, y, dy, n=12, dt=0.12):
    await pg.mouse.move(x, y, steps=8)
    for _ in range(n):
        await pg.mouse.wheel(0, dy/n); await asyncio.sleep(dt)

async def seg(key, actions=None, pad=0.9, min_len=0):
    """Start narration for `key` now; run actions (list of (t, coroutine-factory)); wait for narration end."""
    OFFS[key] = now()
    start = time.time()
    tasks = []
    async def at(t, fn):
        await asyncio.sleep(max(0, t - (time.time() - start))); await fn()
    for t, fn in (actions or []): tasks.append(asyncio.create_task(at(t, fn)))
    await asyncio.sleep(max(DUR[key] + pad, min_len) - (time.time() - start))
    await asyncio.gather(*tasks)

async def main():
    global T0
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--hide-scrollbars'])
        ctx = await b.new_context(viewport={'width': 1600, 'height': 810}, record_video_dir='raw', record_video_size={'width': 1600, 'height': 810}, accept_downloads=True)
        await ctx.add_init_script(CURSOR_JS)
        pg = await ctx.new_page(); T0 = time.time()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        APP, LLM = 'http://localhost:4100/?manual=1', 'http://localhost:4101/'
        # 1 title
        await pg.set_content(TITLE); await asyncio.sleep(0.8)
        await seg('title', pad=1.0)
        # 2 demo mode + click triage
        await pg.goto(APP); await pg.wait_for_selector('#btn-triage'); await asyncio.sleep(0.6)
        async def click_triage(): await move_click(pg, '#btn-triage')
        await seg('demo', [(DUR['demo'] - 3.2, click_triage)], pad=0.5)
        # 3 triage results + AG Grid features
        async def chip(a): await move_click(pg, f'#chips button[data-a={a}]')
        async def typeq(t):
            await move_click(pg, '#qf'); await pg.locator('#qf').type(t, delay=90)
        async def clearq():
            await pg.locator('#qf').fill(''); await pg.locator('#qf').dispatch_event('input')
        async def csv(): await move_click(pg, '#btn-csv')
        async def jc(sel): await move_click(pg, sel)
        await seg('triage', [
            (3.2, lambda: chip('FIGHT')), (6.0, lambda: chip('ACCEPT_CLAIM')), (7.9, lambda: chip('OFFER_REFUND')), (9.0, lambda: chip('HUMAN_REVIEW')),
            (10.4, lambda: chip('ALL')), (11.4, lambda: typeq('Eze')), (13.6, clearq), (14.2, csv)], pad=0.8)
        # 4 case view (LLM app, already triaged)
        await pg.goto(LLM); await pg.wait_for_selector('.ag-row'); await asyncio.sleep(0.8)
        async def row(txt): await move_click(pg, None, text=txt)
        async def scroll_detail(dy, n=10): await wheel(pg, 1250, 480, dy, n=n)
        await seg('why', [(1.5, lambda: row('PP-D-96035')), (6.5, lambda: scroll_detail(260))], pad=0.6)
        async def tabclick(name): await pg.locator('.tabs button', has_text=name).first.click()
        async def evtab():
            bb = await pg.locator('.tabs button', has_text='Evidence').first.bounding_box()
            await pg.mouse.move(bb['x']+bb['width']/2, bb['y']+bb['height']/2, steps=20); await tabclick('Evidence')
        async def top(): await pg.evaluate("document.querySelector('.detail').scrollTo({top:0})")
        await seg('evidence', [(0.3, top), (0.6, evtab), (2.0, lambda: scroll_detail(300, 14)), (5.5, lambda: scroll_detail(300, 14))], pad=0.6)
        async def drafttab():
            await pg.evaluate("document.querySelector('.detail').scrollTo({top:0})")
            bb = await pg.locator('.tabs button', has_text='Response draft').first.bounding_box()
            await pg.mouse.move(bb['x']+bb['width']/2, bb['y']+bb['height']/2, steps=20); await tabclick('Response draft')
        await seg('draft', [(0.4, drafttab), (6.5, lambda: scroll_detail(200, 8))], pad=0.6)
        # 5 injection
        async def inj_row():
            await pg.evaluate("document.querySelector('.detail').scrollTo({top:0})"); await row('PP-D-64479')
        await seg('inject', [(0.5, inj_row), (5.0, lambda: scroll_detail(300, 14)), (11.0, lambda: scroll_detail(300, 14))], pad=0.6)
        # 6 approve
        async def callsel():
            await pg.evaluate("document.querySelector('.detail').scrollTo({top:0})"); await row('PP-D-96035')
        async def calltab():
            bb = await pg.locator('.tabs button', has_text='PayPal call').first.bounding_box()
            await pg.mouse.move(bb['x']+bb['width']/2, bb['y']+bb['height']/2, steps=20); await tabclick('PayPal call')
        async def approve(): await move_click(pg, '#btn-approve')
        async def scrollpage(): await pg.evaluate("window.scrollTo({top: 9999, behavior:'smooth'})")
        async def audit(): await move_click(pg, None, text='Audit log')
        await seg('approve', [(0.4, callsel), (1.8, calltab), (4.5, lambda: scroll_detail(240, 10)), (8.5, approve), (11.5, scrollpage), (16.0, audit)], pad=0.8)
        # 7 results
        await pg.evaluate("window.scrollTo(0,0)")
        await pg.set_content(RESULTS); await asyncio.sleep(0.5)
        await seg('results', pad=1.0)
        await pg.set_content(END); OFFS['end'] = now(); await asyncio.sleep(4.5)
        OFFS['_end'] = now()
        print('errors', errs, file=sys.stderr)
        vpath = await pg.video.path()
        await ctx.close(); await b.close()
    shutil.copy(vpath, 'raw.webm'); json.dump(OFFS, open('offs.json', 'w'), indent=1); print(OFFS)

asyncio.run(main())
