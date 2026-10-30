import re
G='#e04e14'; G2='#a53207'
def wrap(inner):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="{G}"/>{inner}</svg>'
V={}
V['1']=wrap('<circle cx="50" cy="50" r="27" fill="none" stroke="#fff" stroke-width="9"/><polygon points="44,40 66,50 44,60" fill="#fff"/>')
V['2']=wrap(''.join(f'<circle cx="{50+27*__import__("math").cos(__import__("math").radians(a))}" cy="{50+27*__import__("math").sin(__import__("math").radians(a))}" r="5.5" fill="#fff"/>' for a in range(0,360,45))+'<circle cx="50" cy="50" r="10" fill="#fff"/>')
V['3']=wrap('<path d="M50 50 L50 18" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M50 50 L78 34" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M50 50 L78 66" stroke="#fff" stroke-width="8" stroke-linecap="round"/><circle cx="50" cy="50" r="10" fill="#fff"/><circle cx="50" cy="18" r="6" fill="#fff"/><circle cx="78" cy="34" r="6" fill="#fff"/><circle cx="78" cy="66" r="6" fill="#fff"/>')
V['4']=wrap('<path d="M30 68a26 26 0 0 1 40 0" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M38 56a16 16 0 0 1 24 0" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="50" cy="72" r="7" fill="#fff"/>')
V['5']=wrap(''.join(f'<circle cx="{22+c*12}" cy="{50 - (abs(c)*6)}" r="{5-abs(c)*0.6}" fill="#fff" opacity="{1-abs(c)*0.18}"/>' for c in range(-2,3))+'<circle cx="74" cy="30" r="6" fill="#fff"/>')
V['6']=wrap('<path d="M62 30a24 24 0 1 0 0 40" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/><polygon points="46,42 66,50 46,58" fill="#fff"/>')
for k,v in V.items(): open(f'lg/v{k}.svg','w').write(v)
html='''<!doctype html><meta charset="utf-8"><title>Omnicast logo variants</title>
<body style="margin:0;font-family:ui-monospace,monospace;background:#f4f1ec;color:#1b1814">
<div style="max-width:840px;margin:0 auto;padding:48px 24px">
<h1 style="font-size:20px;margin:0 0 4px">Omnicast — logo concepts</h1>
<p style="color:#5d564d;font-size:13px;margin:0 0 32px">Pick a number. Each is a different geometry of the same idea: one station broadcasting out.</p>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
'''+"\n".join(f'''<div style="background:#faf9f6;border:1px solid #eae6de;padding:20px">
<img src="v{k}.svg" style="width:100%;display:block">
<div style="margin-top:14px;font-size:12px;color:#5d564d"><b style="color:#1b1814">V{k}</b> — {d}</div></div>''' for k,d in [
 ('1','ring + play — station broadcasting content'),
 ('2','O of satellite nodes around a hub'),
 ('3','hub fans out to three channels'),
 ('4','broadcast arcs rising from a signal dot'),
 ('5','dot-matrix wave traveling outward'),
 ('6','open ring (C-notch) + play — transmission break'),
]])+'''</div></div>'''
open('lg/index.html','w').write(html)
print('generated', len(V))
